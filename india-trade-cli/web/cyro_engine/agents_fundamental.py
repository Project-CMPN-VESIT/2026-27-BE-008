"""
web/cyro_engine/agents_fundamental.py
─────────────────────────────────────
CYRO Agent 4 — Fundamental & Valuation Analyst
Deterministic-first, evidence-bound fundamental analysis.
"""
import json
import logging
from typing import Dict, Any, Optional

from web.cyro_engine.models import (
    StockResearchContext,
    AgentReport,
    AnalystClaim,
    EvidenceItem
)
from web.cyro_engine.mistral_client import LangChainClient
from web.cyro_engine.agents import LLMReport

from analysis.fundamental import FundamentalSnapshot
from analysis.financial_health import (
    piotroski_f_score,
    altman_z_score,
    dupont_decomposition,
    cfo_to_ebitda
)
logger = logging.getLogger(__name__)


def _extract_metric(evidence_dict: Dict[str, EvidenceItem], keys_to_try: list) -> Optional[float]:
    """Helper to extract a metric deterministically from accepted evidence."""
    for ev in evidence_dict.values():
        if not ev.facts:
            continue
        for fact_dict in ev.facts:
            for key in keys_to_try:
                if key in fact_dict:
                    val = fact_dict[key]
                    try:
                        return float(val)
                    except (ValueError, TypeError):
                        pass
    return None


def run_fundamental_analyst(intent_route, context: StockResearchContext) -> AgentReport:
    """
    Run Agent 4 deterministic fundamental analysis and Mistral interpretation.
    """
    target_security = intent_route.entity.security_id
    horizon = intent_route.intent.research_horizon

    # 1. Scope Enforcement
    # The context.evidence_registry was already filtered by Agent 3 (Quality Gate).
    # We do a secondary defensive check to ensure no cross-contamination.
    accepted_evidence = {}
    for ev_id, ev in context.evidence_registry.items():
        if ev.security_id == target_security:
            accepted_evidence[ev_id] = ev
            
    if not accepted_evidence:
        return AgentReport(
            agent_name="FundamentalAnalyst",
            summary="UNAVAILABLE: No validated fundamental evidence accepted by Quality Gate.",
            claims=[],
            limitations=["No valid evidence available for analysis."]
        )
    research_id = next(iter(accepted_evidence.values())).research_id

    # 2. Deterministic Snapshot Construction
    # We map facts from accepted_evidence into a synthetic FundamentalSnapshot.
    # No values are invented or estimated.
    snap = FundamentalSnapshot(
        symbol=getattr(intent_route.entity, "nse_symbol", None)
        or getattr(intent_route.entity, "ticker", None)
        or "UNKNOWN",
        name=intent_route.entity.company_name or "UNKNOWN"
    )
    
    # Example mapping - in a real system we would map specific facts to snapshot fields
    snap.pe = _extract_metric(accepted_evidence, ["pe_ratio", "pe", "trailingPE"])
    snap.pb = _extract_metric(accepted_evidence, ["pb_ratio", "pb", "priceToBook"])
    snap.ev_ebitda = _extract_metric(accepted_evidence, ["ev_ebitda", "enterpriseToEbitda"])
    snap.roe = _extract_metric(accepted_evidence, ["roe", "returnOnEquity"])
    snap.roce = _extract_metric(accepted_evidence, ["roce", "returnOnCapitalEmployed"])
    snap.npm = _extract_metric(accepted_evidence, ["npm", "netProfitMargin"])
    snap.sales_growth = _extract_metric(accepted_evidence, ["sales_growth", "revenueGrowth"])
    snap.profit_growth = _extract_metric(accepted_evidence, ["profit_growth", "earningsGrowth"])
    snap.debt_equity = _extract_metric(accepted_evidence, ["debt_equity", "debtToEquity"])
    snap.current_ratio = _extract_metric(accepted_evidence, ["current_ratio", "currentRatio"])
    snap.free_cash_flow = _extract_metric(accepted_evidence, ["free_cash_flow", "freeCashflow"])
    snap.promoter_holding = _extract_metric(accepted_evidence, ["promoter_holding", "heldPercentInsiders"])
    snap.total_debt_cr = _extract_metric(accepted_evidence, ["total_debt", "totalDebt"])
    snap.total_cash_cr = _extract_metric(accepted_evidence, ["total_cash", "totalCash"])
    
    # 3. Deterministic Engines
    # We run the engines safely with our derived snapshot.
    piot_res = piotroski_f_score(snap.symbol, snap=snap)
    altman_res = altman_z_score(snap.symbol, snap=snap)
    dupont_res = dupont_decomposition(snap.symbol, snap=snap)
    cfo_res = cfo_to_ebitda(snap.symbol, snap=snap)
    
    # The legacy DCF helper enriches missing inputs through yfinance. CYRO must
    # not fetch after the quality gate, so omit DCF rather than silently filling
    # missing shares, beta, growth, or live price from an external provider.
    dcf_res = {
        "error": "DCF unavailable: accepted evidence does not provide the complete valuation inputs."
    }
    
    # 4. Context Package Assembly
    context_package = {
        "security": {
            "security_id": target_security,
            "ticker": snap.symbol
        },
        "research_horizon": horizon,
        "metrics": {
            "pe": snap.pe,
            "pb": snap.pb,
            "roe": snap.roe,
            "roce": snap.roce,
            "debt_equity": snap.debt_equity,
            "free_cash_flow": snap.free_cash_flow
        },
        "financial_health": {
            "piotroski": piot_res.score if piot_res else "UNAVAILABLE",
            "piotroski_notes": piot_res.notes if piot_res else [],
            "altman_z": altman_res.z_score if altman_res else "UNAVAILABLE",
            "dupont_roe": dupont_res.roe if dupont_res else "UNAVAILABLE",
            "cash_flow_quality": cfo_res.ratio if cfo_res else "UNAVAILABLE"
        },
        "dcf_valuation": dcf_res if not dcf_res.get("error") else "UNAVAILABLE",
        "evidence_ids_provided": list(accepted_evidence.keys())
    }
    
    # 5. Single Mistral LLM Call
    system_prompt = f"""You are CYRO Agent 4: Fundamental & Valuation Analyst.
Your task is to analyze the following deterministic Context Package derived strictly from accepted evidence.
Do NOT invent any metrics, valuations, or evidence citations.
Every claim you make MUST cite one or more 'evidence_ids_provided' from the Context Package.
If DCF valuation is UNAVAILABLE, state so. Distinguish facts from DCF assumptions clearly.

Context Package:
{json.dumps(context_package, indent=2)}

Output JSON ONLY conforming to this schema (do not wrap in markdown):
{{
  "summary": "High level fundamental view (Constructive|Neutral|Cautious|Insufficient Evidence)",
  "claims": [
    {{
      "id": "claim_1",
      "text": "Specific factual or interpretive claim",
      "category": "profitability|valuation|health|growth",
      "stance": "positive|negative|neutral",
      "importance": "high|medium|low",
      "evidence_ids": ["ev_id_1"],
      "confidence": 90,
      "limitations": []
    }}
  ],
  "limitations": ["Any missing data or conflicting evidence limitations"]
}}
"""
    try:
        client = LangChainClient()
        response = client.query(system_prompt, "", LLMReport, research_id=research_id)
        if response is None:
            raise RuntimeError("Mistral structured output unavailable")
        data = response.model_dump()
        
        # 6. Claim Validation
        claims = []
        valid_ev_ids = set(accepted_evidence.keys())
        for c_data in data.get("claims", []):
            # Validate citations
            cited_ids = c_data.get("evidence_ids", [])
            valid_cited = [eid for eid in cited_ids if eid in valid_ev_ids]
            
            claims.append(AnalystClaim(
                id=c_data.get("id", "unknown_claim"),
                text=c_data.get("text", ""),
                category=c_data.get("category", "general"),
                stance=c_data.get("stance", "neutral"),
                importance=c_data.get("importance", "medium"),
                evidence_ids=valid_cited,
                confidence=c_data.get("confidence", 70),
                limitations=c_data.get("limitations", [])
            ))
            
        return AgentReport(
            agent_name="FundamentalAnalyst",
            summary=data.get("summary", "Analysis completed."),
            claims=claims,
            limitations=data.get("limitations", [])
        )
        
    except Exception as e:
        logger.error(f"Mistral LLM call failed in Agent 4: {e}")
        return AgentReport(
            agent_name="FundamentalAnalyst",
            summary="LLM_UNAVAILABLE: Deterministic calculation succeeded but interpretation failed.",
            claims=[],
            limitations=[str(e)]
        )
