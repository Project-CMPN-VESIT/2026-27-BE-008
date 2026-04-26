"""
agent/source_tracker.py
────────────────────────
XAI (Explainable AI) middleware for CYRO.

Subclasses ToolRegistry so that every tool call is transparently recorded
as a SourceCitation — without touching any analyst or provider code.

Usage:
    from agent.source_tracker import TrackedToolRegistry
    registry = TrackedToolRegistry()
    ...run agents...
    citations = registry.get_citations()  # list[SourceCitation]
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field, asdict
from datetime import datetime
from typing import Any

from agent.tools import ToolRegistry


# ── Citation model ─────────────────────────────────────────────


@dataclass
class SourceCitation:
    """A single data-fetch event — every tool call becomes one of these."""

    # Who fetched it
    agent: str                      # e.g. "FundamentalAnalyst"
    tool_name: str                  # e.g. "fundamental_analyse"

    # What was fetched
    source_type: str                # e.g. "screener_yfinance"
    label: str                      # e.g. "Screener.in + Yahoo Finance — INFY"
    input_args: dict = field(default_factory=dict)

    # What was returned (truncated for display)
    excerpt: str = ""               # First 400 chars of result
    full_data_ref: str = ""         # Key for full data lookup (not sent to UI by default)

    # Timing
    timestamp: str = ""             # ISO 8601

    def to_dict(self) -> dict:
        return {
            "agent": self.agent,
            "tool_name": self.tool_name,
            "source_type": self.source_type,
            "label": self.label,
            "input_args": self.input_args,
            "excerpt": self.excerpt,
            "timestamp": self.timestamp,
        }


# ── Tool → source type mapping ──────────────────────────────────

TOOL_SOURCE_MAP: dict[str, tuple[str, str]] = {
    # Live market
    "get_quote":              ("fyers_live",        "Fyers Live Quote"),
    "get_market_snapshot":    ("nse_indices",       "NSE Market Snapshot"),
    "get_vix":                ("nse_vix",           "India VIX"),
    "get_sector_snapshot":    ("nse_sectors",       "NSE Sector Indices"),
    "get_market_breadth":     ("nse_breadth",       "NSE Advance/Decline"),

    # Technicals
    "technical_analyse":      ("technical_engine",  "Technical Analysis Engine"),
    "get_support_resistance":  ("technical_engine", "Support & Resistance Levels"),

    # Fundamentals
    "fundamental_analyse":    ("screener_yfinance", "Screener.in + Yahoo Finance"),
    "get_screener_data":      ("screener_in",       "Screener.in"),

    # Options
    "get_options_chain":      ("nse_options",       "NSE Options Chain"),
    "get_pcr":                ("nse_options",       "NSE Options Chain — PCR"),
    "get_max_pain":           ("nse_options",       "NSE Options Chain — Max Pain"),
    "get_iv_rank":            ("volatility_engine", "IV Rank (52-week realised vol)"),
    "get_oi_profile":         ("nse_oi",            "NSE OI Profile"),

    # Flows
    "get_fii_dii_data":       ("nse_fii_dii",       "NSE FII/DII Flow Data"),
    "get_flow_intelligence":  ("flow_intel",        "FII/DII Flow Intelligence"),
    "get_bulk_deals":         ("nse_deals",         "NSE Bulk/Block Deals"),

    # News
    "get_market_news":        ("rss_feeds",         "ET/MoneyControl/BS News"),
    "get_stock_news":         ("rss_feeds",         "Stock-specific News Feed"),

    # Corporate
    "get_earnings_calendar":  ("nse_earnings",      "NSE Earnings Calendar"),
    "get_upcoming_events":    ("nse_events",        "Market Events Calendar"),

    # RAG
    "search_financial_docs":  ("rag_s3",            "S3 Financial Document RAG"),
}


# ── TrackedToolRegistry ─────────────────────────────────────────


class TrackedToolRegistry(ToolRegistry):
    """
    Drop-in replacement for ToolRegistry that records every tool execution
    as a SourceCitation. Transparent to all analyst code.
    """

    def __init__(self) -> None:
        super().__init__()
        self._citations: list[SourceCitation] = []
        self._current_agent: str = "system"

    # ── Agent context ────────────────────────────────────────────

    def set_agent(self, agent_name: str) -> None:
        """Call before each analyst runs to tag citations with agent name."""
        self._current_agent = agent_name

    def clear_agent(self) -> None:
        self._current_agent = "system"

    # ── Override execute to intercept ────────────────────────────

    def execute(self, name: str, arguments: dict) -> Any:
        result = super().execute(name, arguments)
        self._record(name, arguments, result)
        return result

    # ── Private helpers ──────────────────────────────────────────

    def _record(self, name: str, arguments: dict, result: Any) -> None:
        source_type, base_label = TOOL_SOURCE_MAP.get(name, ("unknown", name))

        # Build a human-readable label including the ticker if present
        ticker = (
            arguments.get("symbol")
            or arguments.get("underlying")
            or arguments.get("stock_a")
            or ""
        )
        label = f"{base_label}{' — ' + ticker.upper() if ticker else ''}"

        # Serialise result to text safely
        try:
            raw = json.dumps(result, default=str)
        except Exception:
            raw = str(result)

        self._citations.append(
            SourceCitation(
                agent=self._current_agent,
                tool_name=name,
                source_type=source_type,
                label=label,
                input_args=arguments,
                excerpt=raw[:500],
                full_data_ref=f"{name}:{ticker}:{datetime.now().strftime('%H%M%S')}",
                timestamp=datetime.now().isoformat(),
            )
        )

    # ── Output ───────────────────────────────────────────────────

    def get_citations(self) -> list[SourceCitation]:
        """Return all recorded citations (in call order)."""
        return list(self._citations)

    def get_citations_as_dicts(self) -> list[dict]:
        """Return citations serialised for JSON/SSE transport."""
        return [c.to_dict() for c in self._citations]

    def clear_citations(self) -> None:
        self._citations.clear()
