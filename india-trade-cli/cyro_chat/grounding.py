"""
Numeric grounding for answers built from tool data.

Every figure in an answer must trace back to the DATA the model was given (or to the user's own message).
Ungrounded numbers are detected, the answer is regenerated once with the offenders listed, and anything that
still isn't grounded is scrubbed sentence by sentence. This is what keeps a chat model from "remembering" a
peer's debt ratio that was never in the data.
"""

from __future__ import annotations

import json
import re
from typing import Any, Iterable, List, Set

_NUM = re.compile(r"(?<![\w.])[-+]?\d[\d,]*(?:\.\d+)?")
_CORR = (1.0, 100.0, 0.01, 0.001, 1e-7, 1e7, 1000.0)


def numbers_in(text: str) -> List[float]:
    out = []
    for m in _NUM.findall(text or ""):
        try:
            out.append(float(m.replace(",", "")))
        except ValueError:
            pass
    return out


def collect_numbers(obj: Any, into: Set[float]) -> Set[float]:
    """All numeric values (and numbers inside strings) in a JSON-able structure."""
    if isinstance(obj, bool) or obj is None:
        return into
    if isinstance(obj, (int, float)):
        into.add(float(obj))
    elif isinstance(obj, str):
        into.update(numbers_in(obj))
    elif isinstance(obj, dict):
        for k, v in obj.items():
            collect_numbers(k, into)
            collect_numbers(v, into)
    elif isinstance(obj, (list, tuple, set)):
        for v in obj:
            collect_numbers(v, into)
    return into


def _matches(n: float, d: float) -> bool:
    """True if n is d as quoted (rounded) or d rescaled (x100 for a ratio shown as %, /1e7 for rupees -> crore...)."""
    for k in _CORR:
        v = d * k
        a = abs(v)
        if k == 1.0:
            tol = max(0.051 if a >= 1 else 0.0051, 0.012 * a)      # one-decimal rounding
        else:
            tol = 0.012 * a + 1e-9                                # rescaled: must be relatively close
        if abs(n - v) <= tol:
            return True
        if float(n).is_integer() and a >= 1 and abs(n - v) <= 0.5:   # "about 10%" for 10.5
            return True
    return False


def ungrounded(answer: str, allowed: Set[float], extra_text: Iterable[str] = ()) -> List[float]:
    """Numbers in `answer` that cannot be traced to `allowed` or to any of `extra_text`."""
    pool = set(allowed)
    for t in extra_text:
        pool.update(numbers_in(t))
    bad: List[float] = []
    for n in numbers_in(answer):
        a = abs(n)
        if a <= 10 and float(a).is_integer():              # counts / ordinals / "top 3", "5 rows"
            continue
        if 1990 <= a <= 2100 and float(a).is_integer():     # years
            continue
        if any(_matches(a, abs(d)) for d in pool):
            continue
        if n not in bad:
            bad.append(n)
    return bad


def scrub(text: str, bad: List[float]) -> str:
    """Drop the sentences / bullets / table rows that contain an ungrounded number."""
    if not bad:
        return text
    badset = {abs(b) for b in bad}
    kept: List[str] = []
    for line in text.split("\n"):
        if not any(abs(n) in badset for n in numbers_in(line)):
            kept.append(line)
            continue
        if line.lstrip().startswith(("-", "*", "|", "•")):
            continue                                         # whole bullet / table row
        protected = line
        for ab in ("e.g.", "i.e.", "vs.", "etc.", "approx.", "Rs.", "Cr.", "No."):
            protected = protected.replace(ab, ab.replace(".", "\u2024"))
        parts = [p.replace("\u2024", ".") for p in re.split(r"(?<=[.!?])\s+(?=[A-Z(*_\"'])", protected)]
        ok = [p for p in parts if not any(abs(n) in badset for n in numbers_in(p))]
        if ok:
            kept.append(" ".join(ok))
    return re.sub(r"\n{3,}", "\n\n", "\n".join(kept)).strip()


_TAIL_Q = re.compile(r"^(?:want me to|would you like|should we|should i|do you want|shall i|let me know|if you'd like|"
                     r"i can also|happy to)\b", re.I)


def tidy(text: str, max_bold: int = 3) -> str:
    """House style: few bold phrases, no engagement-bait closing question (suggestion chips cover follow-ups)."""
    t = (text or "").strip()
    # the model likes to append its own follow-up menu and horizontal rules: the UI shows chips instead
    t = re.sub(r"\n+\s*[-*_]{3,}\s*(?=\n|$)", "\n", t)
    t = re.sub(r"(?is)\n+\s*(?:\*\*)?(?:suggested )?(?:follow[- ]?ups?|next steps|what to explore next|you (?:might|could) also)"
               r"[^\n]*\n.*$", "", t)
    paras = t.split("\n\n")
    if len(paras) > 1 and _TAIL_Q.match(paras[-1].strip().lstrip("*_ ")) and len(paras[-1]) < 220:
        paras = paras[:-1]
    t = "\n\n".join(paras)
    count = 0

    def repl(m: re.Match) -> str:
        nonlocal count
        count += 1
        return m.group(0) if count <= max_bold else m.group(1)

    return re.sub(r"\*\*(.+?)\*\*", repl, t).strip()


def data_numbers(data: Any) -> Set[float]:
    try:
        return collect_numbers(json.loads(json.dumps(data, default=str)), set())
    except Exception:
        return set()
