"""Feature-gated bridge from conversational chat to evidence-backed research.

V2 reuses the existing CYRO research graph rather than exposing arbitrary
research tools to the conversational model. It is read-only and returns
ordinary chat text plus the existing chat source shape.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional, Tuple

from cyro_chat.agent import Plan

@dataclass(frozen=True)
class Capability:
    name: str
    kind: str
    inputs: str
    output: str
    authentication: str
    provenance: str
    freshness: str
    readiness: str


# A discoverable inventory. App-only caches are intentionally absent: they are
# not exposed until a stable backend interface is available.
CAPABILITY_REGISTRY: Tuple[Capability, ...] = (
    Capability("chat.stock_snapshot", "chat_tool", "NSE ticker", "snapshot dict", "public", "market adapters", "provider-defined", "ready"),
    Capability("chat.stock_news", "chat_tool", "NSE ticker", "news list", "public", "canonical news", "published timestamp", "ready"),
    Capability("chat.stock_alerts", "chat_tool", "NSE ticker", "alert list", "public", "market adapters", "provider-defined", "ready"),
    Capability("chat.discover", "chat_tool", "screen filters", "ranked ticker list", "public", "basket/screener", "provider-defined", "ready"),
    Capability("chat.sector_overview", "chat_tool", "sector", "overview dict", "public", "sector data", "provider-defined", "ready"),
    Capability("chat.compare", "chat_tool", "NSE tickers", "comparison list", "public", "market adapters", "provider-defined", "ready"),
    Capability("chat.frameworks", "chat_tool", "question", "educational text", "public", "CYRO framework content", "not applicable", "ready"),
    Capability("chat.basket_info", "chat_tool", "basket query", "basket data", "public", "basket service", "provider-defined", "ready"),
    Capability("chat.portfolio_review", "chat_tool", "authenticated UID", "portfolio summary", "Firebase UID scoped", "paper-trading PostgreSQL", "live database state", "ready; read-only"),
    Capability("chat.market_pulse", "chat_tool", "market query", "market summary", "public", "market/macro providers", "provider-defined", "ready"),
    Capability("research.company_graph", "research_graph", "ticker + horizon", "verified research report", "public", "12 context adapters + evidence registry", "quality-gated per evidence item", "ready; existing graph"),
    Capability("research.market_data", "adapter", "NSE ticker", "quote evidence", "public", "NSE with configured fallback", "adapter timestamp", "ready"),
    Capability("research.technical", "adapter", "NSE ticker", "technical evidence", "public", "technical data providers", "adapter timestamp", "ready"),
    Capability("research.financials", "adapter", "NSE ticker", "fundamental evidence", "public", "fundamental data providers", "adapter timestamp", "ready"),
    Capability("research.shareholding", "adapter", "NSE ticker", "ownership evidence", "public", "exchange/pipeline data", "reporting period", "ready"),
    Capability("research.news", "adapter", "NSE ticker", "relevant news evidence", "public", "pipeline/live/RSS", "published timestamp", "ready; fallback improved"),
    Capability("research.events", "adapter", "NSE ticker", "event evidence", "public", "exchange/pipeline data", "event date", "ready"),
    Capability("research.macro", "adapter", "NSE ticker", "macro evidence", "public", "macro providers", "provider timestamp", "ready"),
    Capability("research.peer", "adapter", "NSE ticker", "peer evidence", "public", "market/fundamental providers", "provider timestamp", "ready"),
    Capability("research.filings", "adapter", "NSE ticker", "filing evidence", "public", "NSE/BSE/pipeline", "filing date", "ready"),
    Capability("research.insider", "adapter", "NSE ticker", "insider evidence", "public", "exchange/pipeline data", "reporting date", "ready"),
    Capability("research.litigation", "adapter", "NSE ticker", "litigation evidence", "public", "configured data providers", "provider timestamp", "verify per result"),
    Capability("research.rag", "adapter", "NSE ticker + query", "document excerpts", "public", "ChromaDB research corpus", "document date when available", "ready; corpus-dependent"),
)

_DEEP_SIGNALS = re.compile(
    r"\b(risks?|risk[- ]reward|valuation|fundamentals?|technicals?|governance|"
    r"investment case|long[- ]term|short[- ]term|medium[- ]term|catalysts?|"
    r"analyse|analyze|research|deep[- ]dive|should i (?:buy|invest)|worth (?:buying|investing))\b",
    re.IGNORECASE,
)


def enabled() -> bool:
    """The new route remains off unless explicitly enabled by the operator."""
    return os.getenv("CYRO_AGENTIC_V2_ENABLED", "").strip().lower() in {"1", "true", "yes", "on"}


def should_research(message: str, plan: Plan) -> bool:
    """Select only complex, single-company chat questions; reports keep their route."""
    return plan.intent == "stock_qa" and not plan.wants_report and len(plan.tickers) == 1 and bool(_DEEP_SIGNALS.search(message))


def _report_dict(value: Any) -> Dict[str, Any]:
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json")
    if isinstance(value, dict):
        return value
    return {}


def summarize_report(report: Dict[str, Any]) -> Tuple[str, List[Dict[str, str]]]:
    """Build a compact, cited chat answer from the graph's validated report."""
    symbol = str(report.get("symbol") or "the company")
    parts: List[str] = []
    summary = str(report.get("summary") or "").strip()
    if summary:
        parts.append(summary)

    conclusion = str(report.get("conclusion") or "").strip()
    confidence = report.get("confidence")
    if conclusion:
        suffix = f" (research confidence: {confidence}%)" if isinstance(confidence, (int, float)) else ""
        parts.append(f"**CYRO view on {symbol}: {conclusion}{suffix}.**")

    claims = report.get("claims") or []
    selected = [c for c in claims if isinstance(c, dict) and c.get("text") and c.get("evidence_ids")][:4]
    if selected:
        findings = []
        for claim in selected:
            evidence_ids = ", ".join(str(eid) for eid in claim["evidence_ids"])
            findings.append(f"- {str(claim['text']).strip()} [Evidence: {evidence_ids}]")
        parts.append("Key evidence-backed findings:\n" + "\n".join(findings))

    limitations = report.get("data_limitations") or []
    if limitations:
        parts.append("Data limitations: " + "; ".join(str(x) for x in limitations[:3]))
    if not parts:
        raise ValueError("The research graph returned no usable report content")

    sources: List[Dict[str, str]] = []
    citation_map = report.get("citation_map") or {}
    source_records = []
    if isinstance(citation_map, dict):
        for evidence_id, evidence in citation_map.items():
            if isinstance(evidence, dict):
                source_records.append(({**evidence, "evidence_id": evidence_id}))
    if not source_records:
        source_records = [source for source in (report.get("sources") or []) if isinstance(source, dict)]
    for source in source_records[:20]:
        if not isinstance(source, dict):
            continue
        label = str(source.get("title") or source.get("source_name") or source.get("name") or "Research source")
        detail_parts = [str(source[k]) for k in ("evidence_id", "source_quality", "freshness", "as_of", "fetched_at", "published_at") if source.get(k)]
        item: Dict[str, str] = {"label": label, "type": str(source.get("type") or "research"), "detail": " · ".join(detail_parts)}
        if source.get("url"):
            item["url"] = str(source["url"])
        sources.append(item)
    return "\n\n".join(parts), sources


async def run_research(
    report_runner: Callable[..., Any],
    ticker: str,
    horizon: Optional[str],
    session_id: str,
    cancel_event: Any,
) -> Tuple[str, List[Dict[str, str]], Dict[str, Any]]:
    """Run the existing graph without forwarding report events into the chat UI."""
    canon = f"Analyse {ticker}" + (f" for {horizon.replace('_', ' ')}" if horizon else "")
    response = await report_runner(message=canon, ticker=ticker, mode="normal", session_id=session_id)
    report: Optional[Dict[str, Any]] = None
    errors: List[str] = []
    async for chunk in response.body_iterator:
        if cancel_event.is_set():
            raise InterruptedError("Research cancelled")
        text = chunk.decode() if isinstance(chunk, (bytes, bytearray)) else str(chunk)
        for line in text.splitlines():
            if not line.startswith("data:"):
                continue
            try:
                event = json.loads(line[5:].strip())
            except (ValueError, TypeError):
                continue
            if event.get("type") == "final_report":
                report = _report_dict(event.get("report"))
            elif event.get("type") == "error":
                errors.append(str(event.get("message") or "Research graph error"))
    if cancel_event.is_set():
        raise InterruptedError("Research cancelled")
    if not report:
        raise RuntimeError("Research graph did not return a final report" + (f": {errors[-1]}" if errors else ""))
    answer, sources = summarize_report(report)
    return answer, sources, report
