"""
Long-term user memory for CYRO.

A small, explicit schema: only whitelisted keys with validated values are ever stored, so a hallucinating model
cannot fill the profile with junk. Everything remembered is visible to (and editable by) the user.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple

from cyro_chat import store

SCALARS: Dict[str, Tuple[str, ...]] = {
    "risk_appetite": ("conservative", "moderate", "aggressive"),
    "investment_horizon": ("short_term", "medium_term", "long_term"),
    "report_preference": ("auto", "prefer_chat", "prefer_reports"),
    "answer_style": ("concise", "balanced", "detailed"),
    "experience_level": ("beginner", "intermediate", "expert"),
}
FREE_TEXT = ("name", "goals")
LISTS = ("interests", "watchlist", "holdings", "avoid")
MAX_LIST = 25

LABELS = {
    "risk_appetite": "Risk appetite", "investment_horizon": "Investment horizon", "report_preference": "Report style",
    "answer_style": "Answer style", "experience_level": "Experience", "name": "Name", "goals": "Goals",
    "interests": "Interests", "watchlist": "Watchlist", "holdings": "Holdings", "avoid": "Avoids",
}

_ALIASES: Dict[str, Dict[str, str]] = {      # per key, so "short" means different things for horizon vs answer style
    "investment_horizon": {
        "short": "short_term", "short-term": "short_term", "shortterm": "short_term", "intraday": "short_term",
        "swing": "short_term", "medium": "medium_term", "medium-term": "medium_term", "mid": "medium_term",
        "long": "long_term", "long-term": "long_term", "longterm": "long_term", "long term": "long_term",
    },
    "risk_appetite": {
        "low": "conservative", "safe": "conservative", "cautious": "conservative", "high": "aggressive",
        "risky": "aggressive", "medium": "moderate", "balanced": "moderate", "moderate risk": "moderate",
    },
    "answer_style": {
        "short": "concise", "brief": "concise", "quick": "concise", "detail": "detailed", "deep": "detailed",
        "thorough": "detailed", "normal": "balanced", "medium": "balanced",
    },
    "report_preference": {
        "always_report": "prefer_reports", "reports": "prefer_reports", "report": "prefer_reports",
        "chat": "prefer_chat", "conversational": "prefer_chat", "no_reports": "prefer_chat", "default": "auto",
    },
    "experience_level": {"novice": "beginner", "new": "beginner", "advanced": "expert", "pro": "expert",
                         "intermediate": "intermediate"},
}

_TICKER = re.compile(r"^[A-Z0-9&\-]{1,20}$")


def _norm_choice(key: str, raw: Any) -> Optional[str]:
    v = str(raw or "").strip().lower().replace(" ", "_")
    allowed = SCALARS[key]
    if v in allowed:
        return v
    table = _ALIASES.get(key, {})
    mapped = table.get(v) or table.get(v.replace("_", " ")) or table.get(v.replace("_", "-"))
    if mapped in allowed:
        return mapped
    # horizon words inside longer phrases ("2-3 years" => long term)
    if key == "investment_horizon":
        if re.search(r"\b(year|years|decade|retire)", str(raw).lower()):
            return "long_term"
        if re.search(r"\b(week|weeks|day|days|month)", str(raw).lower()):
            return "short_term"
    return None


def clean_update(key: str, value: Any) -> Optional[Any]:
    """Validate one proposed memory fact; returns the normalised value, or None to reject it."""
    key = (key or "").strip().lower()
    if key in SCALARS:
        return _norm_choice(key, value)
    if key in FREE_TEXT:
        text = re.sub(r"\s+", " ", str(value or "")).strip()
        return text[:160] if 1 < len(text) else None
    if key in LISTS:
        items = value if isinstance(value, (list, tuple)) else re.split(r"[,;]", str(value or ""))
        out: List[str] = []
        for it in items:
            t = re.sub(r"\s+", " ", str(it)).strip()
            if key in ("watchlist", "holdings"):
                t = t.upper().replace(".NS", "").replace("NSE:", "")
                if not _TICKER.match(t):
                    continue
            elif not (1 < len(t) <= 40):
                continue
            if t and t not in out:
                out.append(t)
        return out[:MAX_LIST] or None
    return None


def apply_updates(user_id: str, updates: List[Dict[str, Any]], source: str = "chat") -> List[Dict[str, Any]]:
    """Merge validated updates into stored memory. Lists are unioned, scalars replaced. Returns what changed."""
    current = store.get_memory(user_id)
    changed: List[Dict[str, Any]] = []
    for u in updates or []:
        key = str(u.get("key", "")).strip().lower()
        action = str(u.get("action", "set")).lower()
        if key in LISTS and action == "remove":
            existing = list(current.get(key) or [])
            gone = clean_update(key, u.get("value")) or []
            kept = [x for x in existing if x not in gone]
            if kept != existing:
                store.set_memory(user_id, key, kept, source)
                current[key] = kept
                changed.append({"key": key, "label": LABELS.get(key, key), "value": kept, "action": "remove"})
            continue
        val = clean_update(key, u.get("value"))
        if val is None:
            continue
        if key in LISTS:
            merged = list(current.get(key) or [])
            for x in val:
                if x not in merged:
                    merged.append(x)
            val = merged[-MAX_LIST:]
        if current.get(key) == val:
            continue
        store.set_memory(user_id, key, val, source)
        current[key] = val
        changed.append({"key": key, "label": LABELS.get(key, key), "value": val, "action": "set"})
    return changed


def describe(memory: Dict[str, Any]) -> str:
    """Compact profile text for prompts."""
    if not memory:
        return "Nothing is known about this user yet."
    lines = []
    for key in (*SCALARS, *FREE_TEXT, *LISTS):
        v = memory.get(key)
        if v in (None, "", []):
            continue
        shown = ", ".join(v) if isinstance(v, list) else str(v).replace("_", " ")
        lines.append(f"- {LABELS.get(key, key)}: {shown}")
    return "\n".join(lines) or "Nothing is known about this user yet."


def public_view(memory: Dict[str, Any]) -> List[Dict[str, Any]]:
    """What the UI shows in the memory panel."""
    out = []
    for key in (*SCALARS, *FREE_TEXT, *LISTS):
        if memory.get(key) in (None, "", []):
            continue
        out.append({"key": key, "label": LABELS.get(key, key), "value": memory[key],
                    "kind": "choice" if key in SCALARS else "list" if key in LISTS else "text",
                    "options": list(SCALARS.get(key, ()))})
    return out
