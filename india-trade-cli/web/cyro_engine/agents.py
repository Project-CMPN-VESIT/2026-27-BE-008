"""
web/cyro_engine/agents.py
──────────────────────────
CYRO Specialist Agent Workers — LangGraph ReAct implementation.

Each specialist receives the StockResearchContext (verified, immutable snapshot)
and a domain-specific toolset. They run tool-calling loops via create_react_agent
before submitting their final structured AgentReport.

Evidence integrity contract:
  - Tools return JSON with 'evidence_type' and 'source' keys
  - Tool outputs captured as 'calculated' or 'trusted_secondary' EvidenceItems
  - Agents MUST only cite evidence_ids from the context registry or their tools
  - No material claim without cited evidence (core CYRO principle)

Architecture:
  CyroAgents.run_<role>() → create_react_agent loop → LLMReport → AgentReport
"""

from __future__ import annotations

import json
import logging
from typing import List, Dict, Any, Optional

from pydantic import BaseModel, Field, field_validator

from web.cyro_engine.models import (
    StockResearchContext,
    AgentReport,
    AnalystClaim,
)
from web.cyro_engine.mistral_client import LangChainClient
from web.cyro_engine.context_views import build_user_content
from web.cyro_engine.tools import (
    FUNDAMENTAL_TOOLS,
    FILINGS_GOVERNANCE_TOOLS,
    TECHNICAL_TOOLS,
    SECTOR_PEER_TOOLS,
    NEWS_CATALYST_TOOLS,
    RISK_BEAR_TOOLS,
)

logger = logging.getLogger(__name__)


def coerce_confidence(v, default: int = 70) -> int:
    """LLMs return confidence as 85, 85.5, "85%", "high" or 0.85 — accept all instead of failing validation."""
    if isinstance(v, bool):
        return default
    if isinstance(v, str):
        t = v.strip().rstrip("%").lower()
        v = {"high": 85, "medium": 60, "moderate": 60, "low": 30}.get(t, t)
        try:
            v = float(v)
        except (TypeError, ValueError):
            return default
    if isinstance(v, (int, float)):
        f = float(v) * 100 if 0 < float(v) <= 1 else float(v)
        return int(max(0, min(100, round(f))))
    return default


# ── LLM Output Schemas ────────────────────────────────────────────────────────


class LLMClaim(BaseModel):
    id: str = "claim"
    text: str = ""
    category: str = "general"
    stance: str = "neutral"          # positive, negative, neutral
    importance: str = "medium"      # high, medium, low
    evidence_ids: List[str] = Field(default_factory=list)
    confidence: int = 70
    limitations: List[str] = Field(default_factory=list)

    @field_validator("confidence", mode="before")
    @classmethod
    def _coerce_conf(cls, v):
        return coerce_confidence(v)


class LLMReport(BaseModel):
    agent_name: str = "Analyst"
    claims: List[LLMClaim] = Field(default_factory=list)
    summary: str = ""
    limitations: List[str] = Field(default_factory=list)


# ── ReAct Agent Factory ───────────────────────────────────────────────────────


def _build_react_agent(client: LangChainClient, tools: list, system_prompt: str):
    """
    Build a LangGraph create_react_agent with domain-specific tools.

    Falls back gracefully to None if langgraph.prebuilt is unavailable,
    so existing graph.py can keep working even without the upgrade.
    """
    try:
        from langgraph.prebuilt import create_react_agent

        llm = client.get_llm()
        agent = create_react_agent(
            model=llm,
            tools=tools,
            prompt=system_prompt,
        )
        return agent
    except ImportError as e:
        logger.warning("[CyroAgents] create_react_agent unavailable: %s", e)
        return None
    except Exception as e:
        logger.error("[CyroAgents] Failed to build ReAct agent: %s", e)
        return None


def _run_react_loop(
    agent,
    user_message: str,
    max_iterations: int = 8,
) -> Optional[str]:
    """
    Invoke a ReAct agent and collect the final text response.

    Returns the final assistant message content or None on failure.
    """
    if agent is None:
        return None
    try:
        if len(user_message) > 60_000:
            user_message = user_message[:60_000] + "\n...[Context truncated]"

        result = agent.invoke(
            {"messages": [("user", user_message)]},
            config={"recursion_limit": max_iterations},
        )
        messages = result.get("messages", [])
        # Find the last AI message with content
        for msg in reversed(messages):
            content = getattr(msg, "content", "")
            if content and hasattr(msg, "type") and msg.type == "ai":
                return content
            elif content and msg.__class__.__name__ in ("AIMessage", "HumanMessage"):
                if msg.__class__.__name__ == "AIMessage":
                    return content
        return None
    except Exception as e:
        logger.error("[CyroAgents] ReAct loop error: %s", e)
        return None


# ── Agent Base Class ──────────────────────────────────────────────────────────


class CyroAgents:
    def __init__(self, client: LangChainClient):
        self.client = client

    def _convert_report(
        self,
        llm_report: LLMReport,
        verified_evidence_ids: List[str],
    ) -> AgentReport:
        """Filter claims to only cite verified evidence IDs, then build AgentReport."""
        claims = []
        for idx, c in enumerate(llm_report.claims):
            filtered_ev = [ev_id for ev_id in c.evidence_ids if ev_id in verified_evidence_ids]
            claims.append(AnalystClaim(
                id=f"claim_{llm_report.agent_name.lower()}_{idx}",
                text=c.text or "Claim verified.",
                category=c.category or "general",
                stance=c.stance or "neutral",
                importance=c.importance or "medium",
                evidence_ids=filtered_ev,
                confidence=c.confidence or 70,
                limitations=c.limitations or [],
            ))
        return AgentReport(
            agent_name=llm_report.agent_name,
            claims=claims,
            summary=llm_report.summary or f"{llm_report.agent_name} completed.",
            limitations=llm_report.limitations or [],
        )

    def _query_with_tools(
        self,
        agent_name: str,
        system_prompt: str,
        context: StockResearchContext,
        context_key: str,
        tools: list,
        upstream_claims: Optional[List[AgentReport]] = None,
    ) -> AgentReport:
        """
        Core execution: build ReAct agent → run tool loop → parse LLMReport → AgentReport.

        Falls back to single-shot LLM call if ReAct agent setup fails.
        """
        verified_ids = list(context.evidence_registry.keys())

        # Append explicit format instruction to system prompt
        format_instruction = (
            f"\n\nFINAL RESPONSE INSTRUCTION:\n"
            f"When you have finished calling tools and completed your analysis, you MUST output a JSON object in this exact schema:\n"
            f'{{"agent_name": "{agent_name}", "summary": "Detailed summary...", "claims": [{{"text": "...", "category": "{context_key}", "stance": "positive|negative|neutral", "importance": "high|medium|low", "evidence_ids": ["ev_..."], "confidence": 80, "limitations": []}}], "limitations": []}}'
        )
        full_system_prompt = system_prompt + format_instruction

        try:
            user_content_dict = build_user_content(context_key, context, upstream_claims=upstream_claims)
            user_content = json.dumps(user_content_dict, default=str)
        except Exception as e:
            return AgentReport(
                agent_name=agent_name,
                summary=f"Context build failed: {e}",
                limitations=[str(e)],
            )

        # ── Phase 1: Try ReAct tool-calling loop ──────────────────────────────
        react_agent = _build_react_agent(self.client, tools, full_system_prompt)
        raw_response = _run_react_loop(
            react_agent,
            user_message=user_content,
        )

        # ── Phase 2: Parse response into structured LLMReport ────────────────
        if raw_response:
            try:
                # Try to extract JSON from the response
                json_start = raw_response.find("{")
                json_end = raw_response.rfind("}") + 1
                if json_start != -1 and json_end > json_start:
                    json_str = raw_response[json_start:json_end]
                    parsed = json.loads(json_str)
                    if isinstance(parsed, dict):
                        # Unwrap nested models if present
                        for wrapper_key in ("LLMReport", "llmreport", "report", "analysis", "data", "result"):
                            if wrapper_key in parsed and isinstance(parsed[wrapper_key], dict):
                                inner = parsed[wrapper_key]
                                for k in ("claims", "summary", "limitations", "agent_name"):
                                    if k in inner:
                                        parsed[k] = inner[k]
                                if "summary" not in parsed and "overview" in inner:
                                    parsed["summary"] = str(inner["overview"])
                        if "agent_name" not in parsed:
                            parsed["agent_name"] = agent_name
                        if "summary" not in parsed or not parsed["summary"]:
                            parsed["summary"] = parsed.get("conclusion") or parsed.get("verdict") or f"{agent_name} analysis completed."
                        if "claims" not in parsed:
                            parsed["claims"] = []

                        report = LLMReport.model_validate(parsed)
                        return self._convert_report(report, verified_ids)
            except Exception as parse_err:
                logger.warning(
                    "[CyroAgents] %s: JSON parse from ReAct response failed: %s",
                    agent_name, parse_err,
                )

        # ── Phase 3: Fallback — structured output without tool loop ──────────
        logger.info("[CyroAgents] %s: Falling back to structured output call", agent_name)
        report = self.client.query(full_system_prompt, user_content, LLMReport)

        if not report:
            return AgentReport(
                agent_name=agent_name,
                summary="LLM prompt completed with default output.",
                limitations=["LLM fallback used"],
            )

        return self._convert_report(report, verified_ids)

    # ── Role 4: Fundamental & Valuation Analyst ───────────────────────────────

    def run_fundamental_analyst(
        self,
        context: StockResearchContext,
        horizon: str,
    ) -> AgentReport:
        """Role 4: Fundamental & Valuation Analyst — DCF, PE premium, financial health."""
        verified_ids = list(context.evidence_registry.keys())
        symbol = context.identity.get("symbol", "?")

        system_prompt = (
            f"You are the CYRO Fundamental & Valuation Analyst. Research horizon: {horizon}.\n"
            f"Analyze the financials and business quality for {symbol}.\n"
            "AVAILABLE TOOLS: Use run_dcf_valuation, compute_graham_number, compute_pe_premium, "
            "get_fundamental_snapshot, compute_financial_health to run deterministic computations. "
            "Call tools FIRST, then reason from tool outputs.\n"
            "Analyze financials based ONLY on the provided context and tool outputs.\n"
            "Return a structured JSON object matching the LLMReport schema.\n"
            "CRITICAL: Do NOT invent evidence IDs. Only choose from: "
            + ", ".join(verified_ids[:30])
        )

        return self._query_with_tools(
            agent_name="FundamentalAnalyst",
            system_prompt=system_prompt,
            context=context,
            context_key="fundamental",
            tools=FUNDAMENTAL_TOOLS,
        )

    # ── Role 5: Filings & Governance Analyst ─────────────────────────────────

    def run_filings_governance_analyst(
        self,
        context: StockResearchContext,
        horizon: str,
    ) -> AgentReport:
        """Role 5: Filings & Governance Analyst — disclosures, pledges, auditors, RPTs."""
        verified_ids = list(context.evidence_registry.keys())
        symbol = context.identity.get("symbol", "?")

        system_prompt = (
            f"You are the CYRO Filings & Governance Analyst. Research horizon: {horizon}.\n"
            f"Analyze disclosures, auditors, pledges, and related parties for {symbol}.\n"
            "AVAILABLE TOOLS: Use get_corporate_filings, get_shareholding_pattern, "
            "get_bulk_block_deals, get_governance_report, search_annual_reports to retrieve "
            "governance and filing evidence. Call tools FIRST.\n"
            "Analyze based ONLY on the provided evidence registry and tool outputs.\n"
            "Return a structured JSON object matching the LLMReport schema.\n"
            "CRITICAL: Only choose from: " + ", ".join(verified_ids[:30])
        )

        return self._query_with_tools(
            agent_name="FilingsGovernanceAnalyst",
            system_prompt=system_prompt,
            context=context,
            context_key="filings_governance",
            tools=FILINGS_GOVERNANCE_TOOLS,
        )

    # ── Role 6: Technical & Price-Action Analyst ──────────────────────────────

    def run_technical_analyst(
        self,
        context: StockResearchContext,
        horizon: str,
    ) -> AgentReport:
        """Role 6: Technical & Price-Action Analyst — trend, RS, momentum, options positioning."""
        verified_ids = list(context.evidence_registry.keys())
        symbol = context.identity.get("symbol", "?")

        system_prompt = (
            f"You are the CYRO Technical & Price-Action Analyst. Research horizon: {horizon}.\n"
            f"Analyse trend, relative strength, momentum, support/resistance, volume, "
            f"moving averages, RSI, MACD, and options positioning for {symbol}.\n"
            "AVAILABLE TOOLS: Use get_live_quote, get_option_chain_summary to retrieve "
            "current market data. Call tools FIRST to get fresh price/options context.\n"
            "Align analysis to the requested horizon. Short-term needs immediate catalysts; "
            "long-term uses structural trends.\n"
            "Do NOT output broker execution tips, personalised stop losses or guaranteed targets.\n"
            "Return a structured JSON object matching the LLMReport schema.\n"
            "CRITICAL: Only choose from: " + ", ".join(verified_ids[:30])
        )

        return self._query_with_tools(
            agent_name="TechnicalAnalyst",
            system_prompt=system_prompt,
            context=context,
            context_key="technical",
            tools=TECHNICAL_TOOLS,
        )

    # ── Role 7: Sector, Peer & Macro Analyst ─────────────────────────────────

    def run_sector_peer_analyst(
        self,
        context: StockResearchContext,
        horizon: str,
    ) -> AgentReport:
        """Role 7: Sector, Peer & Macro Analyst — relative valuation, industry drivers."""
        verified_ids = list(context.evidence_registry.keys())
        symbol = context.identity.get("symbol", "?")

        system_prompt = (
            f"You are the CYRO Sector, Peer & Macro Analyst. Research horizon: {horizon}.\n"
            f"Analyze relative valuation, industry drivers, and macro linkages for {symbol}.\n"
            "AVAILABLE TOOLS: Use get_sector_peers for peer comparison, get_fii_dii_flows for "
            "institutional flow context, get_macro_snapshot for current macro levels, "
            "get_stock_macro_sensitivity for company-specific macro exposure. Call tools FIRST.\n"
            "Return a structured JSON object matching the LLMReport schema.\n"
            "CRITICAL: Only choose from: " + ", ".join(verified_ids[:30])
        )

        return self._query_with_tools(
            agent_name="SectorPeerMacroAnalyst",
            system_prompt=system_prompt,
            context=context,
            context_key="sector_peer_macro",
            tools=SECTOR_PEER_TOOLS,
        )

    # ── Role 8: News & Catalyst Analyst ──────────────────────────────────────

    def run_news_catalyst_analyst(
        self,
        context: StockResearchContext,
        horizon: str,
    ) -> AgentReport:
        """Role 8: News & Catalyst Analyst — catalysts, event risks, sentiment."""
        verified_ids = list(context.evidence_registry.keys())
        symbol = context.identity.get("symbol", "?")

        system_prompt = (
            f"You are the CYRO News & Catalyst Analyst. Research horizon: {horizon}.\n"
            f"Identify catalysts, announcements, and risks for {symbol}.\n"
            "AVAILABLE TOOLS: Use get_news_for_ticker for recent news, get_corporate_filings "
            "for exchange announcements, get_earnings_calendar for upcoming earnings dates, "
            "search_earnings_transcripts for management commentary. Call tools FIRST.\n"
            "Identify near-term catalysts (earnings, order wins, policy) and event risks.\n"
            "Return a structured JSON object matching the LLMReport schema.\n"
            "CRITICAL: Only choose from: " + ", ".join(verified_ids[:30])
        )

        return self._query_with_tools(
            agent_name="NewsCatalystAnalyst",
            system_prompt=system_prompt,
            context=context,
            context_key="news_catalyst",
            tools=NEWS_CATALYST_TOOLS,
        )


