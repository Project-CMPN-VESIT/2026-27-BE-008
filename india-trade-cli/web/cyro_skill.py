"""
web/cyro_skill.py
─────────────────
CYRO — Conversational Research Orchestrator for FinPilot.

SSE endpoint:
    GET  /skills/cyro/stream?message=...&ticker=INFY&mode=normal&session_id=...

Two research modes:
    normal    — Fast (≈15-30s). Single FundamentalAnalyst + quick Mistral synthesis.
    reasoning — Deep (≈2-4min). All 7 analysts + Bull/Bear debate + synthesis.
                Equivalent to the existing /skills/analyze/stream endpoint but
                with CYRO-specific prompts, XAI source citations, and FinPilot UI events.

SSE event types (sent as `data: <json>\n\n`):
    started         → analysis begun, stream_id assigned
    ticker_resolved → which NSE ticker is being analysed
    analyst_start   → an analyst has begun collecting data
    source_captured → a tool call was made (XAI citation)
    analyst_done    → analyst finished, with verdict + confidence + key_points
    phase           → phase change: "debate" | "synthesis"
    debate_round    → one bull/bear exchange
    final_decision  → BUY/HOLD/SELL signal + trade plans
    done            → stream finished (no more events)
    error           → something went wrong

Run with the existing server:
    uvicorn web.api:app --host 127.0.0.1 --port 8765
"""

from __future__ import annotations

import asyncio
import json
import os
import re
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

router = APIRouter(prefix="/skills/cyro", tags=["CYRO"])

# ── Active stream registry (for future hint injection) ──────────
_active_cyro_streams: dict[str, object] = {}


# ── Request model for POST fallback ────────────────────────────

class CyroRequest(BaseModel):
    message: str
    ticker: Optional[str] = None       # pre-resolved ticker from @ mention
    mode: str = "normal"               # "normal" | "reasoning"
    session_id: str = "default"


# ── Company → ticker fuzzy resolver ────────────────────────────

# Fast lookup first; rapidfuzz fallback for natural language queries
_TICKER_MAP: dict[str, str] = {
    "reliance": "RELIANCE", "reliance industries": "RELIANCE",
    "tcs": "TCS", "tata consultancy": "TCS", "tata consultancy services": "TCS",
    "infosys": "INFY", "infy": "INFY", "infosys limited": "INFY",
    "hdfc bank": "HDFCBANK", "hdfcbank": "HDFCBANK", "hdfc bank limited": "HDFCBANK",
    "icici bank": "ICICIBANK", "icicibank": "ICICIBANK",
    "wipro": "WIPRO",
    "hcl": "HCLTECH", "hcltech": "HCLTECH",
    "bharti airtel": "BHARTIARTL", "airtel": "BHARTIARTL",
    "kotak": "KOTAKBANK", "kotak mahindra": "KOTAKBANK",
    "axis bank": "AXISBANK", "axisbank": "AXISBANK",
    "larsen": "LT", "l&t": "LT", "lt": "LT",
    "maruti": "MARUTI", "maruti suzuki": "MARUTI",
    "asian paints": "ASIANPAINT",
    "bajaj finance": "BAJFINANCE",
    "titan": "TITAN",
    "ntpc": "NTPC",
    "ongc": "ONGC",
    "sun pharma": "SUNPHARMA", "sunpharma": "SUNPHARMA",
    "adani": "ADANIENT", "adani enterprises": "ADANIENT",
    "sbi": "SBIN", "state bank": "SBIN", "state bank of india": "SBIN", "sbi stock": "SBIN",
    "itc": "ITC",
    "dr reddy": "DRREDDY", "drreddy": "DRREDDY",
    "cipla": "CIPLA",
    "tata motors": "TATAMOTORS",
    "tata steel": "TATASTEEL",
    "hindalco": "HINDALCO",
    "coal india": "COALINDIA",
    "jswsteel": "JSWSTEEL", "jsw steel": "JSWSTEEL",
    "ultracem": "ULTRACEMCO", "ultratech": "ULTRACEMCO",
    "nestle": "NESTLEIND",
    "tech mahindra": "TECHM", "techm": "TECHM",
    "mahindra": "M&M", "m&m": "M&M",
    "eicher": "EICHERMOT", "royal enfield": "EICHERMOT",
    "hero motocorp": "HEROMOTOCO",
    "bajaj auto": "BAJAJ-AUTO",
    "divis": "DIVISLAB",
    "apollo": "APOLLOHOSP",
    "ltimindtree": "LTIM", "lti": "LTIM",
    "bpcl": "BPCL",
    "grasim": "GRASIM",
    "britannia": "BRITANNIA",
    "hdfc life": "HDFCLIFE",
    "sbi life": "SBILIFE",
    "upl": "UPL",
    "adani ports": "ADANIPORTS",
    "tata consumer": "TATACONSUM",
    "indusind": "INDUSINDBK",
    "bajaj finserv": "BAJAJFINSV",
    "power grid": "POWERGRID",
}

import logging
logger = logging.getLogger(__name__)

_SYMBOL_CACHE: dict[str, str] = {}
_SYMBOL_CACHE_LOCK = asyncio.Lock()

async def _refresh_symbol_universe():
    while True:
        try:
            from market.nse_client import nse_client
            if nse_client._init():
                new_cache = {}
                # Include standard names first
                new_cache.update(_TICKER_MAP)
                
                indices = ["NIFTY 50", "NIFTY NEXT 50", "NIFTY MIDCAP 150"]
                for idx in indices:
                    # Execute in a thread to not block event loop
                    data = await asyncio.to_thread(nse_client._nse.listEquityStocksByIndex, idx)
                    if data and isinstance(data, dict) and "data" in data:
                        for row in data["data"]:
                            sym = row.get("symbol")
                            if sym:
                                # We only get symbol, so map lower(symbol) -> symbol
                                new_cache[sym.lower()] = sym
                
                if new_cache:
                    async with _SYMBOL_CACHE_LOCK:
                        _SYMBOL_CACHE.clear()
                        _SYMBOL_CACHE.update(new_cache)
                    logger.info(f"[Intent Router] Refreshed symbol universe cache: {len(_SYMBOL_CACHE)} entries")
        except Exception as e:
            logger.error(f"[Intent Router] Failed to refresh symbol universe: {e}")
            
        await asyncio.sleep(86400) # 24h

@router.on_event("startup")
async def startup_event():
    asyncio.create_task(_refresh_symbol_universe())

def _resolve_ticker(message: str, tagged_ticker: Optional[str] = None) -> str:
    """
    Resolve a ticker from:
      1. Explicit entity in the message text (highest priority)
      2. Explicit @ tag from UI (UI context fallback)
      3. Return no symbol when the request cannot be resolved
    """
    # 1. Parse user message for explicit target entity
    low = message.lower()
    
    # Check for ALL-CAPS word that looks like a ticker (3-10 chars)
    caps = re.findall(r'\b([A-Z]{2,10})\b', message)
    _SKIP = {"I", "IT", "IN", "AT", "IS", "BE", "BY", "OR", "IF", "OF",
              "TO", "ON", "AN", "AS", "DO", "GO", "NO", "SO", "UP", "US",
              "BUY", "SELL", "HOLD", "NSE", "BSE", "IPO", "FII", "DII",
              "ROE", "ROI", "EPS", "PE", "PB", "AI"}
    
    resolved_from_text = None
    for cap in caps:
        if cap not in _SKIP and len(cap) >= 2:
            logger.info(f"[Ticker Resolution] Found ALL-CAPS ticker in message: {cap}")
            resolved_from_text = cap
            break

    if not resolved_from_text:
        try:
            cache_to_use = dict(_TICKER_MAP)
            if _SYMBOL_CACHE:
                cache_to_use.update(_SYMBOL_CACHE)
        except Exception as e:
            logger.warning(f"[Ticker Resolution] Error building cache copy: {e}. Using hardcoded map.")
            cache_to_use = dict(_TICKER_MAP)
        
        # Direct substring match (longest first)
        for name, ticker in sorted(cache_to_use.items(), key=lambda x: -len(x[0])):
            if name in low:
                logger.info(f"[Ticker Resolution] Direct substring match in message: '{name}' -> {ticker}")
                resolved_from_text = ticker
                break
        
        # Try rapidfuzz if available
        if not resolved_from_text:
            try:
                from rapidfuzz import process, fuzz
                choices = list(cache_to_use.keys())
                matches = process.extract(low, choices, scorer=fuzz.partial_ratio, limit=3)
                if matches:
                    high_matches = [m for m in matches if m[1] > 85]
                    if len(high_matches) > 1:
                        ambiguous_tickers = ','.join([cache_to_use[m[0]] for m in high_matches])
                        logger.warning(f"[Ticker Resolution] Ambiguous match for '{message}': {ambiguous_tickers}")
                        # If ambiguous, do not fallback to tagged_ticker, fail explicitly
                        return f"AMBIGUOUS_TICKER:{ambiguous_tickers}"
                        
                    if matches[0][1] >= 70:
                        resolved_from_text = cache_to_use[matches[0][0]]
                        logger.info(f"[Ticker Resolution] Fuzzy match in message: '{matches[0][0]}' -> {resolved_from_text} (score: {matches[0][1]})")
            except ImportError:
                pass

    if resolved_from_text:
        return resolved_from_text

    # 2. Otherwise, use tagged_ticker/UI context if present
    if tagged_ticker:
        resolved = tagged_ticker.upper().strip()
        logger.info(f"[Ticker Resolution] Fallback to UI explicit tag: {resolved}")
        return resolved

    # 3. Otherwise, return missing-target state
    logger.info(f"[Ticker Resolution] No match found for '{message}' and no UI tag provided.")
    return ""


def _is_research_query(message: str) -> bool:
    """
    Detect whether a message is asking for financial research.
    
    Returns True if the message contains research-related keywords.
    Returns False for general conversational queries.
    
    This gates non-research queries like "who are you" or "hello"
    from entering the CYRO financial research pipeline.
    """
    message_lower = message.lower().strip()
    
    # Non-research patterns (conversational)
    non_research_patterns = [
        r"\b(who\s+are\s+you|who\s+r\s+you|what\s+are\s+you|hello|hi|hey|thanks|thank\s+you|bye|goodbye)\b",
        r"\bwhat\s+can\s+you\s+do\b",
        r"\bexplain\s+(cyro|this|that)\b",
        r"\b(i\s+need\s+help|help|assist|support)\b",
    ]
    
    # Research patterns (financial/analysis keywords)
    research_patterns = [
        r"\b(analyse|analyze|research|study|check|look\s+at)\b",
        r"\b(stocks?|shares?|equity|equities|tickers?|company|companies|security|securities)\b",
        r"\b(buy|sell|hold|bullish|bearish|positive|negative|strong|weak)\b",
        r"\b(fundamental|technical|valuation|price|pe\s+ratio|roe|debt|cash\s+flow)\b",
        r"\b(long\s+term|short\s+term|intraday|swing|momentum|trend)\b",
        r"\b(catalysts?|news|events?|guidance|earnings|quarters?|ipo|splits?|bonus)\b",
        r"\b(compare|peers?|sectors?|macro|economic|gdp|inflation|rates?|policy)\b",
        r"\b(risks?|concerns?|challenges?|threats?|opportunity|opportunities|upside|downside)\b",
        r"\binfy\b|btcs\b|reliance\b|hdfc\b|icici\b|wipro\b|tcs\b",  # major stock names
    ]
    
    import re
    
    # If message explicitly uses research keywords, it's research
    for pattern in research_patterns:
        if re.search(pattern, message_lower):
            return True
    
    # If message explicitly uses non-research patterns, it's NOT research
    for pattern in non_research_patterns:
        if re.search(pattern, message_lower):
            return False
    
    # Heuristic: if message has a ticker symbol (3+ digit CAPS), it's research
    caps = re.findall(r'\b([A-Z]{2,10})\b', message)
    _SKIP = {"I", "IT", "IN", "AT", "IS", "BE", "BY", "OR", "IF", "OF",
              "TO", "ON", "AN", "AS", "DO", "GO", "NO", "SO", "UP", "US",
              "BUY", "SELL", "HOLD", "NSE", "BSE", "IPO", "FII", "DII",
              "ROE", "ROI", "EPS", "PE", "PB", "AI"}
    if any(cap not in _SKIP and len(cap) >= 2 for cap in caps):
        return True
    
    # Default: if no clear signal, assume it's NOT research
    # (safer to fail/fallback than to launch research on "hello")
    return False


def _comparison_symbols(message: str) -> list[str]:
    """Return distinct known symbols named in an explicit comparison request."""
    lower = message.lower()
    matches = {symbol for name, symbol in _TICKER_MAP.items() if name in lower}
    matches.update(
        cap for cap in re.findall(r"\b([A-Z]{2,10})\b", message)
        if cap in set(_TICKER_MAP.values())
    )
    return sorted(matches)


# ── Normal mode: quick single-analyst summary ───────────────────

def _run_normal_analysis(symbol: str, message: str, cb) -> None:
    """
    Normal mode: runs FundamentalAnalyst + one Mistral call.
    Pushes SSE events via cb(event_dict).
    Runs in a background thread.
    """
    os.environ.setdefault("_CLI_BATCH_MODE", "1")

    try:
        from agent.source_tracker import TrackedToolRegistry
        from agent.tools import build_registry
        from agent.core import build_provider_from_env

        # ── Build tracked registry ─────────────────────────────
        base = build_registry()
        registry = TrackedToolRegistry()
        # Copy all registered tools from the default registry
        registry._tools = base._tools  # type: ignore[attr-defined]

        registry.set_agent("FundamentalAnalyst")

        cb({"type": "analyst_start", "analyst": "FundamentalAnalyst"})

        # ── Run fundamental analysis ───────────────────────────
        try:
            from analysis.fundamental import analyse as fundamental_analyse
            snap = fundamental_analyse(symbol)
        except Exception as exc:
            snap = None
            cb({"type": "analyst_start", "analyst": "FundamentalAnalyst",
                "note": f"Screener fallback: {exc}"})

        # Emit any citations collected so far
        for citation in registry.get_citations_as_dicts():
            cb({"type": "source_captured", "citation": citation})
        registry.clear_citations()

        # Build a compact context string from the snapshot
        ctx_lines = []
        if snap:
            ctx_lines = [
                f"Symbol: {symbol}",
                f"Name: {getattr(snap, 'name', symbol)}",
                f"P/E: {getattr(snap, 'pe', 'N/A')}",
                f"ROE: {getattr(snap, 'roe', 'N/A')}%",
                f"ROCE: {getattr(snap, 'roce', 'N/A')}%",
                f"Debt/Equity: {getattr(snap, 'debt_equity', 'N/A')}",
                f"Sales Growth (3Y): {getattr(snap, 'sales_growth', 'N/A')}%",
                f"Profit Growth (3Y): {getattr(snap, 'profit_growth', 'N/A')}%",
                f"Promoter Holding: {getattr(snap, 'promoter_holding', 'N/A')}%",
                f"Pledged %: {getattr(snap, 'pledged_pct', 'N/A')}%",
                f"Fundamental Score: {getattr(snap, 'score', 'N/A')}/100",
                f"Verdict: {getattr(snap, 'verdict', 'NEUTRAL')}",
            ]
            if hasattr(snap, 'flags') and snap.flags:
                ctx_lines.append("Key flags:")
                for f in snap.flags[:5]:
                    ctx_lines.append(f"  [{f.verdict}] {f.metric}: {f.value} — {f.detail}")

        ctx = "\n".join(ctx_lines) if ctx_lines else f"No fundamental data available for {symbol}."

        cb({
            "type": "analyst_done",
            "analyst": "FundamentalAnalyst",
            "verdict": getattr(snap, 'verdict', 'NEUTRAL') if snap else "UNAVAILABLE",
            "confidence": getattr(snap, 'score', 50) if snap else 50,
            "key_points": [f.detail for f in getattr(snap, 'flags', [])[:4]] if snap else [],
        })

        # ── RAG context retrieval (augments fundamental data) ────
        rag_context = ""
        try:
            from rag.retriever import search_financial_docs, format_for_llm
            rag_results = search_financial_docs(
                query=message, symbol=symbol, top_k=3, score_threshold=0.35
            )
            if rag_results and rag_results[0].score > 0.35:
                rag_context = format_for_llm(rag_results, max_chars=2000)
                # Emit source citations from RAG
                for r in rag_results:
                    cb({"type": "source_captured", "citation": r.to_citation_dict()})
        except Exception:
            pass  # RAG not configured — proceed without it

        # ── LLM synthesis ───────────────────────────────────────
        cb({"type": "phase", "phase": "synthesis"})

        rag_section = f"\n\nRelevant document extracts from S3:\n{rag_context}" if rag_context else ""
        prompt = (
            f"You are CYRO, FinPilot's AI research analyst for Indian equities.\n"
            f"The user asked: \"{message}\"\n\n"
            f"Here is the fundamental data for {symbol} (NSE):\n"
            f"{ctx}"
            f"{rag_section}\n\n"
            f"Provide a concise, structured research answer (4-6 bullet points) with:\n"
            f"• Current valuation assessment\n"
            f"• Key strengths and risks\n"
            f"• A clear BUY / HOLD / SELL signal with reasoning\n"
            f"Use INR values. Reference the actual numbers above. Be direct and opinionated."
        )

        registry.set_agent("Synthesis")
        provider = build_provider_from_env(registry=registry)
        response = provider.chat(
            [{"role": "user", "content": prompt}],
            stream=False,
        )

        cb({
            "type": "final_decision",
            "signal": _extract_signal(response),
            "summary": response,
            "sources_used": registry.get_citations_as_dicts(),
        })

    except Exception as exc:
        cb({"type": "error", "message": str(exc)})


def _extract_signal(text: str) -> str:
    """Extract BUY/HOLD/SELL from synthesised text."""
    upper = text.upper()
    if "STRONG BUY" in upper or "STRONG_BUY" in upper:
        return "STRONG_BUY"
    if "BUY" in upper:
        return "BUY"
    if "SELL" in upper:
        return "SELL"
    return "HOLD"


# ── Reasoning mode: delegate to existing MultiAgentAnalyzer ─────

def _run_reasoning_analysis(symbol: str, message: str, cb, exchange: str = "NSE") -> None:
    """
    Reasoning mode: full 7-analyst + debate via MultiAgentAnalyzer.

    SSE events emitted (Week 4 complete):
      analyst_start  — before each analyst begins (via patched _run_analysts_parallel)
      analyst_done   — after each analyst finishes (name, verdict, confidence, key_points)
      source_captured — XAI citation for every tool call
      scorecard      — weighted composite score + conflict badges
      debate_round   — Bull/Bear round 1 arguments
      debate_rebuttal — Bull/Bear round 2 rebuttals
      facilitator    — debate summary + winner
      phase          — "debate" | "synthesis"
      final_decision — BUY/HOLD/SELL + 3 risk-profiled trade plans
      memory_stored  — trade stored to session memory
    """
    os.environ.setdefault("_CLI_BATCH_MODE", "1")

    try:
        from agent.source_tracker import TrackedToolRegistry
        from agent.tools import build_registry
        from agent.core import build_provider_from_env
        from agent.multi_agent import MultiAgentAnalyzer, compute_scorecard, DebateResult

        base = build_registry()
        registry = TrackedToolRegistry()
        registry._tools = base._tools  # type: ignore[attr-defined]

        # ── RAG context augmentation for synthesis ────────────────
        rag_context = ""
        try:
            from rag.retriever import search_financial_docs, format_for_llm
            rag_results = search_financial_docs(query=message, symbol=symbol, top_k=3, score_threshold=0.35)
            if rag_results and rag_results[0].score > 0.35:
                rag_context = format_for_llm(rag_results, max_chars=2000)
                for r in rag_results:
                    cb({"type": "source_captured", "citation": r.to_citation_dict()})
        except Exception:
            pass

        # ── Track analyst progress: emit analyst_start before each runs ──
        # We monkey-patch the run-analysts method to emit start events
        _analyst_names = {
            "Technical": "TechnicalAnalyst",
            "Fundamental": "FundamentalAnalyst",
            "Options": "OptionsAnalyst",
            "News & Macro": "NewsMacroAnalyst",
            "Sentiment": "SentimentAnalyst",
            "Sector Rotation": "SectorRotationAnalyst",
            "Risk Manager": "RiskManager",
        }

        def _wrapped_cb(event: dict):
            """Translate MultiAgentAnalyzer events → CYRO SSE event types."""
            t = event.get("type", "")

            if t == "analyst":
                analyst_raw = event.get("name", "")
                analyst_ui = _analyst_names.get(analyst_raw, analyst_raw + "Analyst")
                cb({
                    "type": "analyst_done",
                    "analyst": analyst_ui,
                    "verdict": event.get("verdict", "NEUTRAL"),
                    "confidence": int(event.get("confidence") or 0),
                    "score": event.get("score"),
                    "error": event.get("error"),
                    "key_points": event.get("key_points", []),
                })
                # Flush XAI citations after each analyst completes
                registry.set_agent(analyst_ui)
                citations = registry.get_citations_as_dicts()
                registry.clear_citations()
                for c in citations:
                    cb({"type": "source_captured", "citation": c})

            elif t == "scorecard":
                cb({
                    "type": "scorecard",
                    "weighted_total": event.get("weighted_total"),
                    "verdict": event.get("verdict"),
                    "agreement": event.get("agreement"),
                    "conflicts": event.get("conflicts", []),
                    "scores": event.get("scores", {}),
                })

            elif t == "debate_round":
                cb({
                    "type": "debate_round",
                    "round": event.get("round", 1),
                    "bull": event.get("bull", ""),
                    "bear": event.get("bear", ""),
                })

            elif t == "debate_rebuttal":
                cb({
                    "type": "debate_rebuttal",
                    "round": event.get("round", 2),
                    "bull": event.get("bull", ""),
                    "bear": event.get("bear", ""),
                })

            elif t == "facilitator":
                cb({
                    "type": "facilitator",
                    "winner": event.get("winner", ""),
                    "summary": event.get("summary", ""),
                })

            elif t == "synthesis_text":
                synthesis = event.get("text", "")
                trade_plans = {}
                try:
                    # Attempt to get trade plans from analyzer.last_trade_plans
                    pass
                except Exception:
                    pass
                cb({
                    "type": "final_decision",
                    "signal": _extract_signal(synthesis),
                    "summary": synthesis,
                    "trade_plans": trade_plans,
                    "sources_used": registry.get_citations_as_dicts(),
                    "rag_used": bool(rag_context),
                })

            elif t == "phase":
                cb({"type": "phase", "phase": event.get("phase", "")})

            elif t == "hint_applied":
                cb(event)

            else:
                cb(event)  # pass-through for any future event types

        provider = build_provider_from_env(registry=registry)

        # Patch MultiAgentAnalyzer to emit analyst_start events + scorecard
        class CyroMultiAgentAnalyzer(MultiAgentAnalyzer):
            """Subclass that emits analyst_start + scorecard SSE events."""

            def __init__(self, *args, **kwargs):
                super().__init__(*args, **kwargs)
                self._last_reports: list = []  # saved for scorecard emission

            def _run_analysts_parallel(self, symbol: str, exchange: str):
                import concurrent.futures as _cf
                from agent.multi_agent import AnalystReport

                reports = []
                # Emit analyst_start for all analysts upfront
                for analyst in self.analysts:
                    analyst_ui = _analyst_names.get(analyst.name, analyst.name + "Analyst")
                    cb({"type": "analyst_start", "analyst": analyst_ui})

                with _cf.ThreadPoolExecutor(max_workers=5) as executor:
                    futures = {executor.submit(a.analyze, symbol, exchange): a for a in self.analysts}
                    for future in _cf.as_completed(futures):
                        analyst = futures[future]
                        try:
                            report = future.result(timeout=30)
                            reports.append(report)
                            if self.progress_callback:
                                self.progress_callback({
                                    "type": "analyst",
                                    "name": analyst.name,
                                    "verdict": report.verdict,
                                    "confidence": report.confidence,
                                    "score": getattr(report, "score", 0),
                                    "key_points": getattr(report, "key_points", []),
                                    "error": report.error,
                                })
                        except Exception as e:
                            reports.append(AnalystReport(
                                analyst=analyst.name, verdict="UNKNOWN",
                                confidence=0, score=0, error=str(e),
                            ))
                            if self.progress_callback:
                                self.progress_callback({
                                    "type": "analyst", "name": analyst.name,
                                    "verdict": "UNKNOWN", "confidence": 0,
                                    "score": 0, "error": str(e),
                                })
                # Save for post-analysis scorecard emission
                self._last_reports = reports
                return reports

        analyzer = CyroMultiAgentAnalyzer(
            registry, provider,
            verbose=False,
            progress_callback=_wrapped_cb,
            parallel=True,
            rag_context=rag_context,
        )

        # Emit analyst_start for all 7 analysts
        for analyst_name in _analyst_names.values():
            registry.set_agent(analyst_name)

        report = analyzer.analyze(symbol, exchange)

        # Emit scorecard using the real AnalystReport list saved by our subclass
        try:
            last_reports = getattr(analyzer, "_last_reports", [])
            if last_reports:
                sc = compute_scorecard(last_reports)
                _wrapped_cb({
                    "type": "scorecard",
                    "weighted_total": sc.weighted_total,
                    "verdict": sc.verdict,
                    "agreement": sc.agreement,
                    "conflicts": sc.conflicts,
                    "scores": sc.scores,
                })
        except Exception:
            pass  # scorecard is non-critical

        # Emit final_decision from the full synthesis report
        cb({
            "type": "final_decision",
            "signal": _extract_signal(report),
            "summary": report,
            "trade_plans": getattr(analyzer, "last_trade_plans", {}),
            "sources_used": registry.get_citations_as_dicts(),
            "rag_used": bool(rag_context),
        })

    except Exception as exc:
        import traceback
        cb({"type": "error", "message": str(exc), "trace": traceback.format_exc()[-800:]})




# ── SSE stream endpoint ─────────────────────────────────────────

@router.get("/stream")
async def cyro_stream(
    message: str,
    ticker: Optional[str] = None,
    mode: str = "normal",
    session_id: str = "default",
):
    """
    CYRO SSE stream endpoint.
    Includes research-intent gate to reject non-financial queries.
    """
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()
    stream_id = f"cyro_{session_id}_{uuid4().hex[:8]}"

    # Check if this is actually a financial research query
    if not _is_research_query(message):
        # Not a research query — emit non-research response
        async def _non_research_generator():
            yield f"data: {json.dumps({'type': 'started', 'stream_id': stream_id, 'mode': 'conversation'})}\n\n"
            cyro_response = "I am CYRO, FinPilot's AI research analyst for Indian equities. I can help you analyze stocks, compare companies, evaluate valuations, assess technical trends, and identify catalysts. Try asking me things like: \"Analyse TCS for long term\" or \"Compare INFY and WIPRO fundamentals\"."
            yield f"data: {json.dumps({'type': 'done', 'stream_id': stream_id, 'conclusion': cyro_response})}\n\n"
        
        return StreamingResponse(
            _non_research_generator(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    # CYRO is deliberately single-security until its evidence and quality
    # contracts can preserve independent scopes end-to-end.
    comparison_symbols = _comparison_symbols(message) if "compare" in message.lower() else []
    if len(comparison_symbols) > 1:
        async def _unsupported_comparison_generator():
            yield f"data: {json.dumps({'type': 'error', 'error_type': 'MULTI_STOCK_UNSUPPORTED', 'message': 'CYRO comparison research is not yet supported safely. Please research one security at a time.', 'stream_id': stream_id})}\n\n"
            yield f"data: {json.dumps({'type': 'done', 'stream_id': stream_id})}\n\n"
        return StreamingResponse(
            _unsupported_comparison_generator(), media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    # Resolve ticker
    symbol = _resolve_ticker(message, ticker)
    if not symbol:
        async def _unresolved_security_generator():
            yield f"data: {json.dumps({'type': 'error', 'error_type': 'SECURITY_RESOLUTION_ERROR', 'message': 'CYRO could not resolve a single NSE security. Please provide a ticker or company name.', 'stream_id': stream_id})}\n\n"
            yield f"data: {json.dumps({'type': 'done', 'stream_id': stream_id})}\n\n"
        return StreamingResponse(
            _unresolved_security_generator(), media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )
    if ":" in symbol:
        exchange, symbol = symbol.split(":", 1)
        exchange = exchange.upper()
    else:
        exchange = "NSE"

    def _cb(event: dict):
        event.setdefault("stream_id", stream_id)
        asyncio.run_coroutine_threadsafe(queue.put(event), loop)

    def _run():
        try:
            from web.cyro_engine import CyroOrchestrator, MistralClient, ResearchRequest
            client = MistralClient()
            orchestrator = CyroOrchestrator(client)
            req = ResearchRequest(
                message=message,
                ticker=symbol,
                session_id=session_id,
                mode=mode
            )
            orchestrator.run(req, _cb)
        except Exception as exc:
            # Classify error by source for precise error messaging
            error_type = "CYRO_RESEARCH_ERROR"
            user_message = "CYRO research pipeline encountered an error. Please try again."
            
            # Check for typed exceptions first
            if hasattr(exc, "error_type"):
                error_type = exc.error_type
                user_message = getattr(exc, "user_message", str(exc))
            else:
                # Classify by exception type and message content
                exc_str = str(exc).lower()
                exc_type_name = type(exc).__name__
                
                if "broker" in exc_str or "connection" in exc_str and "refused" in exc_str:
                    error_type = "BROKER_CONNECTION_ERROR"
                    user_message = "Could not connect to broker data service. Please try again."
                elif "timeout" in exc_str or "deadlock" in exc_str:
                    error_type = "TIMEOUT_ERROR"
                    user_message = "Research took too long. Please try again."
                elif "mistral" in exc_str.lower() or "llm" in exc_str.lower():
                    error_type = "LLM_ERROR"
                    user_message = "Language model service unavailable. Please try again."
                elif "database" in exc_str or "sql" in exc_str:
                    error_type = "DATABASE_ERROR"
                    user_message = "Database service unavailable. Please try again."
                elif "intent" in exc_str and "route" in exc_str:
                    error_type = "INTENT_ROUTE_ERROR"
                    user_message = "Could not understand the research request. Please be more specific."
                elif "security" in exc_str or "ticker" in exc_str:
                    error_type = "SECURITY_RESOLUTION_ERROR"
                    user_message = "Could not resolve the security/ticker. Please try a different company name."
                else:
                    error_type = "CYRO_RESEARCH_ERROR"
                    user_message = f"Research pipeline error: {exc_type_name}"
            
            try:
                from web.cyro_engine import cyro_logger
                cyro_logger.error(
                    stream_id, "cyro", user_message, {"error_type": error_type, "exception": str(exc)[:500]}
                )
            except Exception:
                pass
            
            _cb({
                "type": "error",
                "error_type": error_type,
                "message": user_message,
                "stream_id": stream_id
            })
        finally:
            _active_cyro_streams.pop(stream_id, None)
            asyncio.run_coroutine_threadsafe(queue.put(None), loop)  # sentinel

    async def _generator():
        # Launch analysis in background thread
        asyncio.ensure_future(loop.run_in_executor(None, _run))

        while True:
            event = await queue.get()
            if event is None:
                break
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(
        _generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── POST convenience wrapper ────────────────────────────────────

@router.post("/analyze")
async def cyro_analyze(req: CyroRequest):
    """
    Non-streaming CYRO analysis (for quick tests).
    Returns the full report as JSON when done.
    """
    from web.cyro_engine import CyroOrchestrator, MistralClient, ResearchRequest
    client = MistralClient()
    orchestrator = CyroOrchestrator(client)

    results: list[dict] = []
    def _cb(event: dict):
        results.append(event)

    symbol = _resolve_ticker(req.message, req.ticker)
    engine_req = ResearchRequest(
        message=req.message,
        ticker=symbol,
        session_id=req.session_id,
        mode=req.mode
    )

    loop = asyncio.get_running_loop()
    final_report = await loop.run_in_executor(None, orchestrator.run, engine_req, _cb)

    return {
        "status": "ok",
        "data": {
            "symbol": final_report.symbol,
            "exchange": "NSE",
            "mode": req.mode,
            "signal": final_report.conclusion,
            "summary": final_report.summary,
            "sources_used": [s.model_dump() for s in final_report.sources],
            "events": results,
            "report": final_report.model_dump()
        },
    }


# ── RAG index trigger endpoint ──────────────────────────────────


class IndexRequest(BaseModel):
    tickers: list[str]
    force_reindex: bool = False


@router.post("/index")
async def cyro_index(req: IndexRequest):
    """
    Trigger S3 → ChromaDB indexing for one or more tickers.
    This is a background task — returns immediately with a job_id.

    Example:
        POST /skills/cyro/index
        {"tickers": ["INFY", "TCS", "RELIANCE"]}
    """
    import asyncio
    import uuid

    job_id = uuid.uuid4().hex[:12]

    async def _index_job():
        from rag.indexer import index_ticker
        for ticker in req.tickers:
            try:
                loop = asyncio.get_running_loop()
                await loop.run_in_executor(None, lambda t=ticker: index_ticker(t, verbose=True))
            except Exception as e:
                print(f"[rag] indexing failed for {ticker}: {e}")

    asyncio.ensure_future(_index_job())

    return {
        "status": "indexing_started",
        "job_id": job_id,
        "tickers": req.tickers,
        "message": f"Indexing {len(req.tickers)} ticker(s) in background. Check server logs for progress.",
    }



@router.get("/index/stats")
async def cyro_index_stats(ticker: Optional[str] = None):
    """
    Return ChromaDB collection stats.
    Optional ticker filter: GET /skills/cyro/index/stats?ticker=INFY
    """
    try:
        from rag.indexer import get_index_stats
        stats = get_index_stats(symbol=ticker)
        return {"status": "ok", "data": stats}
    except Exception as e:
        return {"status": "error", "message": str(e)}


# ── Week 5 — Right Panel Intelligence Endpoints ─────────────────
#
#   GET /skills/cyro/market/fii-dii?days=5
#   GET /skills/cyro/market/options?ticker=INFY
#   GET /skills/cyro/market/session-memory?ticker=INFY
#   GET /skills/cyro/market/rag-check?ticker=INFY
#   GET /skills/cyro/market/flow?ticker=INFY
# ────────────────────────────────────────────────────────────────


@router.get("/market/fii-dii")
async def cyro_fii_dii(days: int = 5):
    """
    Week 5 — Live FII/DII flow data for the right panel.

    Returns:
        fii_dii_rows   — list of daily FII/DII netflows
        flow_intel     — streak analysis, divergence signals, momentum
        macro_context  — market breadth + VIX snapshot
    """
    loop = asyncio.get_running_loop()

    def _fetch():
        from agent.tools import build_registry
        reg = build_registry()
        result: dict = {}

        # FII/DII daily netflows
        try:
            fii_data = reg.execute("get_fii_dii_data", {"days": days})
            result["fii_dii_rows"] = fii_data if isinstance(fii_data, list) else []
        except Exception as e:
            result["fii_dii_rows"] = []
            result["fii_dii_error"] = str(e)

        # Flow intelligence (streak, divergence, momentum)
        try:
            flow = reg.execute("get_flow_intelligence", {})
            result["flow_intel"] = flow if isinstance(flow, dict) else {}
        except Exception as e:
            result["flow_intel"] = {}
            result["flow_intel_error"] = str(e)

        # Market breadth
        try:
            breadth = reg.execute("get_market_breadth", {})
            result["market_breadth"] = breadth if isinstance(breadth, dict) else {}
        except Exception as e:
            result["market_breadth"] = {}

        # VIX level
        try:
            quote = reg.execute("get_quote", {"symbol": "INDIA VIX", "exchange": "NSE"})
            result["vix"] = quote.get("ltp") if isinstance(quote, dict) else None
        except Exception:
            result["vix"] = None

        return result

    try:
        data = await loop.run_in_executor(None, _fetch)
        return {"status": "ok", "data": data}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@router.get("/market/options")
async def cyro_options(ticker: str = "NIFTY"):
    """
    Week 5 — Live options data for the right panel.

    Returns PCR, max pain, IV rank for the given ticker.
    Falls back gracefully if no F&O data is available.
    """
    symbol = ticker.upper().strip()
    loop = asyncio.get_running_loop()

    def _fetch():
        from agent.tools import build_registry
        reg = build_registry()
        result: dict = {"symbol": symbol}

        # PCR
        try:
            pcr_data = reg.execute("get_pcr", {"underlying": symbol})
            result["pcr"] = pcr_data.get("pcr") if isinstance(pcr_data, dict) else None
            result["pcr_interpretation"] = (
                "Bearish (heavy put writing)" if (result["pcr"] or 0) > 1.2
                else "Bullish (heavy call writing)" if (result["pcr"] or 1) < 0.8
                else "Neutral"
            ) if result.get("pcr") is not None else "Unavailable"
        except Exception as e:
            result["pcr"] = None
            result["pcr_error"] = str(e)

        # Max Pain
        try:
            mp_data = reg.execute("get_max_pain", {"underlying": symbol})
            result["max_pain"] = mp_data.get("max_pain") if isinstance(mp_data, dict) else None
            result["max_pain_strikes"] = mp_data.get("strikes", []) if isinstance(mp_data, dict) else []
        except Exception as e:
            result["max_pain"] = None

        # IV Rank
        try:
            iv_data = reg.execute("get_iv_rank", {"symbol": symbol})
            result["iv_rank"] = iv_data.get("iv_rank") if isinstance(iv_data, dict) else None
            result["iv_interpretation"] = (
                "Elevated — good for selling premium" if (result["iv_rank"] or 0) > 50
                else "Low — good for buying options"
            ) if result.get("iv_rank") is not None else "Unavailable"
        except Exception:
            result["iv_rank"] = None

        return result

    try:
        data = await loop.run_in_executor(None, _fetch)
        return {"status": "ok", "data": data}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@router.get("/market/flow")
async def cyro_flow(ticker: str):
    """
    Week 5 — FII/DII + bulk/block deal flow for a specific ticker.

    Used by the right panel 'Flow Intel' card.
    """
    symbol = ticker.upper().strip()
    loop = asyncio.get_running_loop()

    def _fetch():
        from agent.tools import build_registry
        reg = build_registry()
        result: dict = {"symbol": symbol}

        # Bulk/block deals
        try:
            deals = reg.execute("get_bulk_block_deals", {"symbol": symbol})
            if isinstance(deals, dict):
                result["bulk"] = deals.get("bulk", [])[:5]
                result["block"] = deals.get("block", [])[:5]
            else:
                result["bulk"] = []
                result["block"] = []
        except Exception:
            result["bulk"] = []
            result["block"] = []

        # Stock-specific news headlines
        try:
            news = reg.execute("get_stock_news", {"symbol": symbol, "n": 5})
            result["news"] = news[:5] if isinstance(news, list) else []
        except Exception:
            result["news"] = []

        # Sector snapshot
        try:
            sector = reg.execute("get_sector_snapshot", {})
            result["sector_snapshot"] = sector if isinstance(sector, dict) else {}
        except Exception:
            result["sector_snapshot"] = {}

        return result

    try:
        data = await loop.run_in_executor(None, _fetch)
        return {"status": "ok", "data": data}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@router.get("/market/news")
async def cyro_news(ticker: str):
    """
    Fetch stock specific news and NSE announcements.
    """
    symbol = ticker.upper().strip()
    loop = asyncio.get_running_loop()

    def _fetch():
        from market.news import get_canonical_stock_news
        result = {"symbol": symbol, "news": [], "announcements": [], "provider_audit": {}}
        
        try:
            canonical = get_canonical_stock_news(symbol, n=10)
            result["news"] = [n.to_dict() for n in canonical.get("news", [])]
            result["announcements"] = [a.to_dict() for a in canonical.get("announcements", [])]
            result["provider_audit"] = canonical.get("provider_audit", {})
        except Exception as e:
            result["error"] = str(e)
            
        return result

    try:
        data = await loop.run_in_executor(None, _fetch)
        return {"status": "ok", "data": data}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@router.get("/market/alerts")
async def cyro_alerts(ticker: str):
    """
    Risk, momentum, ownership, event and news alerts for the Right Panel.

    Each check (price action, options PCR, VIX, FII/DII, promoter holding, events,
    bulk deals, news/filings risk) is independent — see market/alerts.py.
    """
    symbol = ticker.upper().strip()
    loop = asyncio.get_running_loop()

    def _fetch():
        from market.alerts import build_alerts
        return build_alerts(symbol)

    try:
        data = await loop.run_in_executor(None, _fetch)
        return {"status": "ok", "data": data}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@router.get("/market/session-memory")
async def cyro_session_memory(ticker: str):
    """
    Week 5 — Session memory injection.

    Returns past CYRO trade decisions for a ticker.
    Used to prime the LLM with historical context.
    """
    symbol = ticker.upper().strip()

    try:
        from engine.memory import trade_memory
        loop = asyncio.get_running_loop()
        history = await loop.run_in_executor(None, lambda: trade_memory.get_recent(symbol, limit=5))
        return {
            "status": "ok",
            "data": {
                "symbol": symbol,
                "history": history if isinstance(history, list) else [],
                "count": len(history) if isinstance(history, list) else 0,
            }
        }
    except Exception as e:
        return {"status": "ok", "data": {"symbol": symbol, "history": [], "count": 0, "note": str(e)}}


@router.get("/market/rag-check")
async def cyro_rag_check(ticker: str):
    """
    Week 5 — RAG freshness check.

    Returns whether the ChromaDB index for this ticker is fresh (< 24h old).
    If stale, the client can show an 'Index Documents' button in the right panel.

    GET /skills/cyro/market/rag-check?ticker=INFY
    """
    symbol = ticker.upper().strip()
    max_age_hours = float(os.environ.get("RAG_INDEX_MAX_AGE_HOURS", "24"))

    try:
        from rag.indexer import get_index_stats
        import datetime

        stats = get_index_stats(symbol=symbol)
        last_indexed = stats.get("last_indexed_at")  # ISO string

        if not last_indexed:
            return {
                "status": "ok",
                "data": {
                    "symbol": symbol,
                    "indexed": False,
                    "fresh": False,
                    "chunk_count": 0,
                    "message": "No index found. Click 'Index Documents' to build the knowledge base.",
                }
            }

        # Parse timestamp and check freshness
        try:
            indexed_at = datetime.datetime.fromisoformat(last_indexed)
            age_hours = (datetime.datetime.now() - indexed_at).total_seconds() / 3600
            fresh = age_hours < max_age_hours
        except Exception:
            fresh = True
            age_hours = 0

        return {
            "status": "ok",
            "data": {
                "symbol": symbol,
                "indexed": True,
                "fresh": fresh,
                "chunk_count": stats.get("total_chunks", 0),
                "last_indexed_at": last_indexed,
                "age_hours": round(age_hours, 1),
                "message": (
                    f"Index is fresh ({stats.get('total_chunks', 0)} chunks, {age_hours:.1f}h old)."
                    if fresh
                    else f"Index is stale ({age_hours:.1f}h old). Consider re-indexing."
                ),
            }
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}

