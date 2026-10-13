"""
AI "Read Summary" for a stock through one investor's lens.

The model only sees the computed metrics (never raw web text), is told not to invent facts or give advice, and
its output is checked. If the LLM is unavailable, rate-limited or misbehaves, a deterministic summary built from
the same metrics is returned, so the feature always works. Results are cached in the DB.
"""

from __future__ import annotations

import datetime as dt
import json
import logging
import re
import threading
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeout
from typing import Callable, List, Optional

from pydantic import BaseModel, Field

from baskets.config import DISCLAIMER
from baskets.db import Summary, bulk_upsert, session_scope, utcnow
from baskets.insight import stock_insight
from baskets.scoring import MODELS

logger = logging.getLogger(__name__)

SUMMARY_TTL_DAYS = 7
FALLBACK_RETRY_MINUTES = 30
SCORE_DRIFT = 5.0                 # regenerate when the score moved by more than this since the note was written
LLM_TIMEOUT_SECONDS = 45

_ADVICE = re.compile(r"\b(buy|sell|target price|price target|guaranteed|will (?:rise|fall|double))\b", re.I)


_locks: dict = {}
_locks_guard = threading.Lock()


def _key_lock(sym: str, model: str) -> threading.Lock:
    """One lock per (stock, investor): identical concurrent requests wait for the first instead of each calling the LLM."""
    with _locks_guard:
        return _locks.setdefault((sym, model), threading.Lock())


class LegendSummary(BaseModel):
    summary: str = ""
    positives: List[str] = Field(default_factory=list)
    negatives: List[str] = Field(default_factory=list)


def _facts_for_prompt(insight: dict, model: str) -> dict:
    sc = next(s for s in insight["scores"] if s["model"] == model)
    return {
        "company": insight["name"] or insight["symbol"], "symbol": insight["symbol"], "sector": insight["sector"],
        "industry": insight["industry"], "size_segment": f"{insight['cap_class']} cap",
        "market_cap_cr": insight["mcap_cr"],
        "investor_lens": {"name": sc["label"], "style": sc["investor"], "looks_for": sc["philosophy"]},
        "score_out_of_100": sc["score"], "rating_band": sc["band"],
        "measured": [{"metric": b["label"], "value": b["display"], "rule_score_0_100": b["subscore"], "weight": b["weight"]}
                     for b in sc["breakdown"] if b["subscore"] is not None],
        "flagged_strengths": sc["tags_pos"], "flagged_weaknesses": sc["tags_neg"],
    }


def fallback_summary(insight: dict, model: str) -> LegendSummary:
    """Deterministic note from the same metrics (used when the LLM is unavailable)."""
    sc = next(s for s in insight["scores"] if s["model"] == model)
    name = insight["name"] or insight["symbol"]
    rated = [b for b in sc["breakdown"] if b["subscore"] is not None and b["display"]]
    strong = sorted((b for b in rated if b["subscore"] >= 70), key=lambda b: -b["weight"] * b["subscore"])[:4]
    weak = sorted((b for b in rated if b["subscore"] <= 30), key=lambda b: -b["weight"] * (100 - b["subscore"]))[:4]
    pos = [f"{b['label']}: {b['display']}" for b in strong]
    neg = [f"{b['label']}: {b['display']}" for b in weak]
    score = sc["score"]
    head = (f"Through the {sc['label']} lens ({sc['philosophy']}), {name} scores "
            f"{score:.0f}/100, rated {sc['band'].lower()}." if score is not None
            else f"{name} could not be scored under the {sc['label']} lens yet.")
    tail = ""
    if pos and neg:
        tail = f" It is helped by {pos[0].split(':')[0].lower()} but held back by {neg[0].split(':')[0].lower()}."
    elif pos:
        tail = f" Its main strength is {pos[0].split(':')[0].lower()}."
    elif neg:
        tail = f" The main drag is {neg[0].split(':')[0].lower()}."
    return LegendSummary(summary=head + tail, positives=pos, negatives=neg)


_SYSTEM = (
    "You are an equity research assistant. Write a short note on how the {investor} investing lens would view the "
    "company, using ONLY the metrics supplied in the user message.\n"
    "Rules:\n"
    "1. Use only the supplied numbers; never invent facts, events, forecasts or figures.\n"
    "2. Do NOT give buy/sell/hold advice, price targets or predictions.\n"
    "3. `summary`: 2-4 plain sentences on how well the company fits the lens and why.\n"
    "4. `positives` / `negatives`: up to 4 short bullet strings each, each citing a supplied metric and its value.\n"
    "5. If a metric is missing, do not mention it.\n"
    "6. Plain text only: no markdown, no asterisks, no bold."
)


def _call_llm(insight: dict, model: str) -> Optional[LegendSummary]:
    from web.cyro_engine.mistral_client import LangChainClient

    spec = MODELS[model]
    client = LangChainClient()
    return client.query(_SYSTEM.format(investor=f"{spec.label} ({spec.investor})"), json.dumps(_facts_for_prompt(insight, model), default=str),
                        LegendSummary, retries=1, research_id=f"baskets_summary_{insight['symbol']}")


def _plain(text: str) -> str:
    """Strip markdown the model sometimes adds (**bold**, bullets) so the UI shows clean text."""
    t = re.sub(r"[*_`#]+", "", text or "")
    return re.sub(r"^\s*[-•]\s*", "", t).strip()


def _valid(s: Optional[LegendSummary]) -> bool:
    if s is None or len(s.summary.strip()) < 40:
        return False
    text = " ".join([s.summary, *s.positives, *s.negatives])
    return not _ADVICE.search(text)


def _llm_with_timeout(insight: dict, model: str, llm: Callable) -> Optional[LegendSummary]:
    pool = ThreadPoolExecutor(max_workers=1)
    try:
        return pool.submit(llm, insight, model).result(timeout=LLM_TIMEOUT_SECONDS)
    except FuturesTimeout:
        logger.warning("[Baskets] summary LLM timed out for %s/%s", insight["symbol"], model)
    except Exception as exc:
        logger.warning("[Baskets] summary LLM failed for %s/%s: %s", insight["symbol"], model, exc)
    finally:
        pool.shutdown(wait=False, cancel_futures=True)
    return None


def get_summary(symbol: str, model: str, llm: Optional[Callable] = None) -> Optional[dict]:
    """Cached AI summary (generated on demand). None if the stock is unknown; raises KeyError for a bad model."""
    if model not in MODELS:
        raise KeyError(model)
    sym = symbol.strip().upper()
    with _key_lock(sym, model):
        return _get_summary_locked(sym, model, llm)


def _get_summary_locked(sym: str, model: str, llm: Optional[Callable]) -> Optional[dict]:
    insight = stock_insight(sym, with_peers=False)
    if insight is None:
        return None
    score = next(s["score"] for s in insight["scores"] if s["model"] == model)

    with session_scope() as s:
        row = s.get(Summary, (sym, model))
        cached = None if row is None else {"content": row.content, "score": row.score, "source": row.source,
                                           "at": row.generated_at}
    if cached:
        age = utcnow() - cached["at"]
        drift = abs((score or 0) - (cached["score"] or 0))
        ttl = dt.timedelta(days=SUMMARY_TTL_DAYS) if cached["source"] == "llm" else dt.timedelta(minutes=FALLBACK_RETRY_MINUTES)
        if age < ttl and drift <= SCORE_DRIFT:
            return _payload(insight, model, cached["content"], cached["source"], cached["at"])

    result = _llm_with_timeout(insight, model, llm or _call_llm)
    source = "llm"
    if not _valid(result):
        result, source = fallback_summary(insight, model), "fallback"
    content = {"summary": _plain(result.summary), "positives": [_plain(x) for x in result.positives[:4]],
               "negatives": [_plain(x) for x in result.negatives[:4]]}
    now = utcnow()
    with session_scope() as s:
        bulk_upsert(s, Summary, [{"symbol": sym, "model": model, "content": content, "score": score,
                                  "source": source, "generated_at": now}], ["symbol", "model"])
    return _payload(insight, model, content, source, now)


def _payload(insight: dict, model: str, content: dict, source: str, at: dt.datetime) -> dict:
    spec = MODELS[model]
    sc = next(s for s in insight["scores"] if s["model"] == model)
    return {"symbol": insight["symbol"], "name": insight["name"], "model": model, "label": spec.label,
            "investor": spec.investor, "score": sc["score"], "band": sc["band"], **content,
            "source": source, "generated_at": at.isoformat(), "disclaimer": DISCLAIMER,
            "note": "AI-generated from the metrics shown; it adds no outside information." if source == "llm"
                    else "Auto-generated from the metrics shown (AI summary temporarily unavailable)."}
