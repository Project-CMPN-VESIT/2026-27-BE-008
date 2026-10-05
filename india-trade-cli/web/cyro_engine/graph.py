"""
web/cyro_engine/graph.py
─────────────────────────
LangGraph StateGraph orchestration for CYRO.

Implements the 10-role evidence-first investment committee architecture:
1. Intent Router (Role 1)
2. Context Builder (Role 2)
3. Quality Gate (Role 3)
4-8. Specialist Analysts in parallel via Send API (Roles 4-8)
9. Risk & Bear-Case Analyst (Role 9)
10. Investment Committee (Role 10)
11. Post-Committee Citation Validator & Audit Gate

Uses LangGraph's get_stream_writer() to emit SSE event streams.
"""

import json
import uuid
import operator
import time
from typing import List, Dict, Any, Optional, TypedDict, Annotated

from langgraph.graph import StateGraph, START, END
from langgraph.types import Send
from langgraph.config import get_stream_writer
from langgraph.checkpoint.memory import InMemorySaver

from web.cyro_engine.models import (
    ResearchRequest,
    StockResearchContext,
    AnalystClaim,
    AgentReport,
    FinalResearchReport,
)
from web.cyro_engine.mistral_client import MistralClient
from web.cyro_engine.context_builder import ContextBuilder
from web.cyro_engine.quality_gate import QualityGate
from web.cyro_engine.agents import CyroAgents
from web.cyro_engine.context_views import build_user_content
from web.cyro_engine import cyro_logger

try:
    from web.cyro_engine.models import IntentRoute
except ImportError:
    pass


# ── State Schema ──────────────────────────────────────────────

class CyroGraphState(TypedDict):
    request: Dict[str, Any]
    research_id: str
    request_id: str
    resolved_ticker: str
    intent_route: Optional[Dict[str, Any]]
    raw_context: Optional[Dict[str, Any]]
    quality_result: Optional[Dict[str, Any]]
    verified_context: Optional[Dict[str, Any]]
    specialist_reports: Annotated[List[Dict[str, Any]], operator.add]
    risk_report: Optional[Dict[str, Any]]
    final_report: Optional[Dict[str, Any]]


class AnalystWorkerInput(TypedDict):
    role: str
    research_id: str
    request_id: str
    horizon: str
    context_dict: Dict[str, Any]
    intent_route_dict: Dict[str, Any]


class CyroPipelineError(RuntimeError):
    """A typed, user-safe failure at a CYRO graph contract boundary."""

    def __init__(self, error_type: str, message: str):
        self.error_type = error_type
        self.user_message = message
        super().__init__(message)


# ── Helper Functions ──────────────────────────────────────────

def _to_clean_dict(obj: Any) -> Any:
    """Converts any Pydantic model or dict containing numpy scalars into pure JSON-safe primitives."""
    if obj is None:
        return None
    if hasattr(obj, "model_dump"):
        obj = obj.model_dump()
    return json.loads(json.dumps(obj, default=str))


def _safe_emit(event: dict):
    """Safely stream custom event via LangGraph stream writer if active."""
    try:
        writer = get_stream_writer()
        if writer:
            writer(_to_clean_dict(event))
    except Exception:
        pass


def require_intent_route(state: Dict[str, Any], boundary: str) -> "IntentRoute":
    """Validate and deserialize the one canonical Agent 1 state contract."""
    route_value = state.get("intent_route")
    if route_value is None:
        raise CyroPipelineError(
            "INTENT_ROUTE_MISSING",
            f"IntentRoute is missing before {boundary}; Agent 1 did not produce a route.",
        )
    try:
        route = route_value if isinstance(route_value, IntentRoute) else IntentRoute.model_validate(route_value)
    except Exception as exc:
        raise CyroPipelineError("INTENT_ROUTE_ERROR", f"Invalid IntentRoute before {boundary}.") from exc
    if not route.entity.security_id:
        raise CyroPipelineError(
            "INTENT_ROUTE_ERROR",
            f"IntentRoute has no resolved security before {boundary}.",
        )
    if not route.intent.research_horizon or not route.routing.agents:
        raise CyroPipelineError(
            "INTENT_ROUTE_ERROR",
            f"IntentRoute is incomplete before {boundary}.",
        )
    return route


# ── Node Definitions ──────────────────────────────────────────

def intent_router_node(state: CyroGraphState) -> dict:
    """Role 1: Resolve ticker and generate horizon-aware research plan using IntentRouter."""
    req_dict = state["request"]
    session_id = req_dict.get("session_id", "default")
    message = req_dict.get("message", "")
    ticker_input = req_dict.get("ticker")
    mode = req_dict.get("mode", "normal")
    research_id = state.get("research_id") or f"cyro_{session_id}_{uuid.uuid4().hex[:8]}"
    request_id = state.get("request_id", "unknown")

    _safe_emit({
        "type": "started",
        "research_id": research_id,
        "request_id": request_id,
        "symbol": ticker_input or "UNRESOLVED",
        "mode": mode
    })

    _safe_emit({"type": "analyst_start", "research_id": research_id, "request_id": request_id, "analyst": "IntentRouter"})
    t0_intent = time.time()
    
    from web.cyro_engine.intent_router.router import IntentRouter
    from web.cyro_engine.models import ResearchRequest
    
    cyro_logger.intent_started(research_id)
    router = IntentRouter(client=MistralClient())
    req = ResearchRequest(
        message=message,
        ticker=ticker_input,
        session_id=session_id,
        request_id=request_id,
        research_id=research_id,
        mode=mode
    )
    
    intent_route = router.route(req)
    resolved_ticker = intent_route.entity.nse_symbol
    if not resolved_ticker:
        raise CyroPipelineError(
            "SECURITY_RESOLUTION_ERROR",
            "CYRO could not resolve a single NSE security for this request. Please provide a ticker or company name.",
        )
    exchange = intent_route.entity.exchange or "NSE"
    routed_agents = list(intent_route.routing.agents) if intent_route.routing else []

    _safe_emit({
        "type": "ticker_resolved",
        "research_id": research_id,
        "request_id": request_id,
        "ticker": resolved_ticker,
        "exchange": exchange
    })

    _safe_emit({"type": "intent_resolved", "research_id": research_id, "request_id": request_id, "intent_route": intent_route.model_dump()})
    _safe_emit({"type": "analyst_done", "research_id": research_id, "request_id": request_id, "analyst": "IntentRouter", "verdict": intent_route.intent.research_horizon})
    
    intent_ms = int((time.time() - t0_intent) * 1000)
    cyro_logger.intent_completed(research_id, resolved_ticker,
                                  intent_route.intent.research_horizon,
                                  routed_agents, intent_ms)
    cyro_logger.state_event(
        research_id, "intent", "agent_1", "intent_route_created", "success",
        security_id=intent_route.entity.security_id or resolved_ticker,
        intent_route_present=True,
        request_id=intent_route.request_id, ticker=resolved_ticker,
        horizon=intent_route.intent.research_horizon,
        routing_agents=routed_agents, report_present=False,
    )

    return {
        "research_id": research_id,
        "resolved_ticker": resolved_ticker,
        "intent_route": _to_clean_dict(intent_route),
    }


def context_builder_node(state: CyroGraphState) -> dict:
    """Role 2: Fetch multi-source financial and market context in parallel."""
    research_id = state["research_id"]
    request_id = state.get("request_id", "unknown")
    intent_route = require_intent_route(state, "Agent 2")
    route_dict = _to_clean_dict(intent_route)
    cyro_logger.state_event(
        research_id, "context", "agent_2", "intent_route_received", "started",
        security_id=intent_route.entity.security_id or "", intent_route_present=True,
        request_id=request_id, ticker=intent_route.entity.nse_symbol or "",
        horizon=intent_route.intent.research_horizon,
        routing_agents=list(intent_route.routing.agents),
    )

    _safe_emit({"type": "analyst_start", "research_id": research_id, "request_id": request_id, "analyst": "ContextBuilder"})
    _safe_emit({"type": "context_module_started", "research_id": research_id, "request_id": request_id, "module": "all_modules"})

    cyro_logger.context_started(research_id, route_dict.get("entity", {}).get("nse_symbol", ""))
    t0_ctx = time.time()
    builder = ContextBuilder(research_id)
    raw_context = builder.build_context(intent_route)

    for ev_id, ev in raw_context.evidence_registry.items():
        _safe_emit({"type": "evidence_captured", "research_id": research_id, "request_id": request_id, "evidence": ev.model_dump()})

    _safe_emit({"type": "context_module_done", "research_id": research_id, "request_id": request_id, "module": "all_modules", "status": "done"})
    _safe_emit({"type": "analyst_done", "research_id": research_id, "request_id": request_id, "analyst": "ContextBuilder", "verdict": "Retrieved"})
    
    ctx_ms = int((time.time() - t0_ctx) * 1000)
    cyro_logger.context_completed(research_id,
                                   route_dict.get("entity", {}).get("nse_symbol", ""),
                                   len(raw_context.evidence_registry),
                                   [], ctx_ms)

    return {
        "raw_context": _to_clean_dict(raw_context),
    }


def quality_gate_node(state: CyroGraphState) -> dict:
    """Role 3: Deterministic validation, freshness checking, and deduplication."""
    research_id = state["research_id"]
    request_id = state.get("request_id", "unknown")
    
    intent_route = require_intent_route(state, "Agent 3")
    cyro_logger.state_event(
        research_id, "quality", "agent_3", "intent_route_received", "started",
        security_id=intent_route.entity.security_id or "", intent_route_present=True,
        request_id=request_id, ticker=intent_route.entity.nse_symbol or "",
        horizon=intent_route.intent.research_horizon,
        routing_agents=list(intent_route.routing.agents),
    )
    
    raw_context_dict = state["raw_context"]
    raw_context = StockResearchContext.model_validate(raw_context_dict)

    _safe_emit({"type": "analyst_start", "research_id": research_id, "request_id": request_id, "analyst": "QualityGate"})
    cyro_logger.quality_started(research_id)
    t0_q = time.time()
    
    qgate = QualityGate()
    quality_result = qgate.verify(intent_route, raw_context)
    
    # Isolate downstream LLM context strictly to accepted evidence
    verified_context = raw_context.model_copy(deep=True)
    verified_context.evidence_registry = quality_result.accepted_evidence

    # Persist the quality gate results idempotently
    from web.cyro_engine.quality_store import QualityStore
    store = QualityStore()
    store.store_result(research_id, quality_result)

    _safe_emit({
        "type": "evidence_verified",
        "research_id": research_id,
        "request_id": request_id,
        "accepted": quality_result.evidence_summary.get("accepted", 0),
        "rejected": quality_result.evidence_summary.get("rejected", 0),
        "warnings": quality_result.evidence_summary.get("warnings", 0),
        "status": quality_result.gate_status
    })
    
    _safe_emit({"type": "analyst_done", "research_id": research_id, "request_id": request_id, "analyst": "QualityGate", "verdict": quality_result.gate_status})
    q_ms = int((time.time() - t0_q) * 1000)
    cyro_logger.quality_completed(research_id,
                                   quality_result.evidence_summary.get("accepted", 0),
                                   quality_result.evidence_summary.get("rejected", 0),
                                   quality_result.evidence_summary.get("warnings", 0),
                                   quality_result.gate_status, q_ms)

    return {
        "quality_result": _to_clean_dict(quality_result),
        "verified_context": _to_clean_dict(verified_context),
        "specialist_reports": [],
    }


def fan_out_analysts(state: CyroGraphState) -> List[Send]:
    """Conditional Edge: Fan-out eligible specialist analysts in parallel via Send API."""
    intent_route = require_intent_route(state, "Agents 4-8")
    route_dict = _to_clean_dict(intent_route)
    req_dict = state.get("request") or {}
    context_dict = state["verified_context"]
    research_id = state["research_id"]
    request_id = state.get("request_id", "unknown")
    horizon = intent_route.intent.research_horizon
    run_agents = list(intent_route.routing.agents)
    mode = req_dict.get("mode", "normal")

    candidate_roles = ["fundamental", "filings_governance", "technical", "news_catalyst"]
    
    # Sector & Macro runs in deep mode or if explicitly selected
    if mode == "deep" or "sector_peer_macro" in run_agents:
        candidate_roles.append("sector_peer_macro")

    active_roles = [r for r in candidate_roles if r in run_agents]
    if not active_roles:
        active_roles = ["fundamental", "technical"]

    sends = []
    for role in active_roles:
        sends.append(Send("analyst_worker", {
            "role": role,
            "research_id": research_id,
            "request_id": request_id,
            "horizon": horizon,
            "context_dict": context_dict,
            "intent_route_dict": route_dict,
        }))
    cyro_logger.state_event(
        research_id, "specialists", "cyro", "fan_out", "success",
        security_id=intent_route.entity.security_id or "", intent_route_present=True,
        specialist_count=len(sends),
        request_id=request_id, ticker=intent_route.entity.nse_symbol or "",
        horizon=intent_route.intent.research_horizon,
        routing_agents=list(intent_route.routing.agents),
    )
    return sends


def analyst_worker_node(input_data: AnalystWorkerInput) -> dict:
    """Generic Specialist Worker Node: Executes a specialized domain analyst."""
    role = input_data["role"]
    research_id = input_data["research_id"]
    request_id = input_data.get("request_id", "unknown")
    horizon = input_data["horizon"]
    context_dict = input_data["context_dict"]
    context = StockResearchContext.model_validate(context_dict)

    role_to_analyst_name = {
        "fundamental": "FundamentalAnalyst",
        "filings_governance": "FilingsGovernanceAnalyst",
        "technical": "TechnicalAnalyst",
        "sector_peer_macro": "SectorPeerMacroAnalyst",
        "news_catalyst": "NewsCatalystAnalyst",
    }
    analyst_name = role_to_analyst_name.get(role, role.capitalize())

    _safe_emit({"type": "analyst_start", "research_id": research_id, "request_id": request_id, "analyst": analyst_name})
    role_to_agent_id = {
        "fundamental": "agent_4",
        "filings_governance": "agent_5",
        "technical": "agent_6",
        "sector_peer_macro": "agent_7",
        "news_catalyst": "agent_8",
    }
    agent_id = role_to_agent_id.get(role, "agent_4")
    security_id = context.security_id or ""
    cyro_logger.analyst_started(research_id, security_id, analyst_name, agent_id)
    t0_analyst = time.time()

    intent_route = require_intent_route(
        {"intent_route": input_data.get("intent_route_dict")},
        f"specialist {role}",
    )
    cyro_logger.state_event(
        research_id, f"specialist_{role}", role_to_analyst_name.get(role, role),
        "intent_route_received", "started",
        security_id=intent_route.entity.security_id or "", intent_route_present=True,
        request_id=request_id, ticker=intent_route.entity.nse_symbol or "",
        horizon=intent_route.intent.research_horizon,
        routing_agents=list(intent_route.routing.agents),
        accepted_count=len((context_dict or {}).get("evidence_registry", {})),
    )

    if role == "fundamental":
        from web.cyro_engine.agents_fundamental import run_fundamental_analyst
        report = run_fundamental_analyst(intent_route, context)
    elif role == "filings_governance":
        from web.cyro_engine.agents_filings_governance import run_filings_governance_analyst
        report = run_filings_governance_analyst(intent_route, context)
    elif role == "technical":
        from web.cyro_engine.agents_technical import run_technical_analyst
        report = run_technical_analyst(intent_route, context)
    elif role == "sector_peer_macro":
        from web.cyro_engine.agents_sector_peer_macro import run_sector_peer_macro_analyst
        report = run_sector_peer_macro_analyst(intent_route, context)
    elif role == "news_catalyst":
        from web.cyro_engine.agents_news_catalyst import run_news_catalyst_analyst
        report = run_news_catalyst_analyst(intent_route, context)
    else:
        raise CyroPipelineError("SPECIALIST_ERROR", f"Unsupported specialist role: {role}.")

    analyst_ms = int((time.time() - t0_analyst) * 1000)
    cyro_logger.analyst_completed(research_id, security_id, analyst_name, agent_id,
                                   "completed", analyst_ms)
    cyro_logger.state_event(
        research_id, f"specialist_{role}", agent_id, "report_created", "success",
        security_id=intent_route.entity.security_id or "", intent_route_present=True,
        request_id=request_id, ticker=intent_route.entity.nse_symbol or "",
        horizon=intent_route.intent.research_horizon,
        routing_agents=list(intent_route.routing.agents),
        accepted_count=len(context.evidence_registry), report_present=True,
        claim_count=len(report.claims),
    )

    _safe_emit({
        "type": "agent_claims_ready",
        "research_id": research_id,
        "request_id": request_id,
        "agent": analyst_name,
        "claims": [c.model_dump() for c in report.claims]
    })
    # The activity panel must distinguish an analyst that completed with an
    # evidence gap from one that produced an actionable specialist report.
    verdict = "Unavailable" if report.summary.upper().startswith("UNAVAILABLE:") else "Completed"
    _safe_emit({"type": "analyst_done", "research_id": research_id, "request_id": request_id, "analyst": analyst_name, "verdict": verdict})

    return {"specialist_reports": [_to_clean_dict(report)]}


def risk_eval_node(state: CyroGraphState) -> dict:
    """Role 9: Deterministic Risk & Contradiction Engine."""
    research_id = state["research_id"]
    request_id = state.get("request_id", "unknown")
    
    intent_route = require_intent_route(state, "Agent 9")
    
    # Define context BEFORE using it in logging
    context_dict = state["verified_context"]
    context = StockResearchContext.model_validate(context_dict) if context_dict else None
    
    cyro_logger.state_event(
        research_id, "risk", "agent_9", "intent_route_received", "started",
        security_id=intent_route.entity.security_id or "", intent_route_present=True,
        specialist_count=len(state.get("specialist_reports") or []),
        request_id=request_id, ticker=intent_route.entity.nse_symbol or "",
        horizon=intent_route.intent.research_horizon,
        routing_agents=list(intent_route.routing.agents),
        accepted_count=len(context.evidence_registry) if context else 0,
    )
    
    specialist_report_dicts = state.get("specialist_reports") or []
    specialist_reports = [AgentReport.model_validate(r) for r in specialist_report_dicts]

    _safe_emit({"type": "analyst_start", "research_id": research_id, "request_id": request_id, "analyst": "RiskContradictionEngine"})
    cyro_logger.risk_started(research_id)
    t0_risk = time.time()

    from web.cyro_engine.agents_risk_contradiction import run_risk_contradiction_engine
    risk_rep = run_risk_contradiction_engine(intent_route, context, specialist_reports)

    risk_ms = int((time.time() - t0_risk) * 1000)
    risk_count = len(risk_rep.claims) if risk_rep else 0
    cyro_logger.risk_completed(research_id, risk_count, 0, risk_ms)
    cyro_logger.state_event(
        research_id, "risk", "agent_9", "report_created", "success",
        security_id=intent_route.entity.security_id or "", intent_route_present=True,
        request_id=request_id, ticker=intent_route.entity.nse_symbol or "",
        horizon=intent_route.intent.research_horizon,
        routing_agents=list(intent_route.routing.agents),
        specialist_count=len(specialist_reports), accepted_count=len(context.evidence_registry),
        report_present=True, claim_count=len(risk_rep.claims),
    )

    _safe_emit({
        "type": "agent_claims_ready",
        "research_id": research_id,
        "request_id": request_id,
        "agent": "RiskContradictionEngine",
        "claims": [c.model_dump() for c in risk_rep.claims]
    })
    _safe_emit({"type": "analyst_done", "research_id": research_id, "request_id": request_id, "analyst": "RiskContradictionEngine", "verdict": "Completed"})
    _safe_emit({"type": "risk_gate_ready", "research_id": research_id, "request_id": request_id, "bear_case": risk_rep.summary})

    return {"risk_report": _to_clean_dict(risk_rep)}


def committee_node(state: CyroGraphState) -> dict:
    """Role 10: Horizon-weighted investment synthesis and research conclusion."""
    research_id = state["research_id"]
    request_id = state.get("request_id", "unknown")
    _safe_emit({"type": "analyst_update", "research_id": research_id, "request_id": request_id, "analyst": "InvestmentCommittee", "status": "synthesizing"})
    cyro_logger.committee_started(research_id)
    t0_committee = time.time()

    intent_route = require_intent_route(state, "Agent 10")
    cyro_logger.state_event(
        research_id, "committee", "agent_10", "intent_route_received", "started",
        security_id=intent_route.entity.security_id or "", intent_route_present=True,
        specialist_count=len(state.get("specialist_reports") or []),
        request_id=request_id, ticker=intent_route.entity.nse_symbol or "",
        horizon=intent_route.intent.research_horizon,
        routing_agents=list(intent_route.routing.agents),
        accepted_count=len((state.get("verified_context") or {}).get("evidence_registry", {})),
    )

    context_dict = state.get("verified_context")
    context = StockResearchContext.model_validate(context_dict) if context_dict else None

    specialist_report_dicts = state.get("specialist_reports") or []
    specialist_reports = [AgentReport.model_validate(r) for r in specialist_report_dicts]

    risk_rep_dict = state.get("risk_report")
    if risk_rep_dict:
        specialist_reports.append(AgentReport.model_validate(risk_rep_dict))

    valid_evidence_map = context.evidence_registry if context else {}

    from web.cyro_engine.agents_investment_committee import run_investment_committee
    final_report = run_investment_committee(
        intent_route, specialist_reports, valid_evidence_map, research_id=research_id
    )

    committee_ms = int((time.time() - t0_committee) * 1000)
    specialist_count = len(specialist_report_dicts)
    risk_count = len(state.get("risk_report", {}).get("claims", [])) if state.get("risk_report") else 0
    cyro_logger.committee_completed(research_id, str(final_report.conclusion), specialist_count, risk_count, committee_ms)
    cyro_logger.state_event(
        research_id, "committee", "agent_10", "report_created", "success",
        security_id=intent_route.entity.security_id or "", intent_route_present=True,
        request_id=request_id, ticker=intent_route.entity.nse_symbol or "",
        horizon=intent_route.intent.research_horizon,
        routing_agents=list(intent_route.routing.agents), specialist_count=specialist_count,
        accepted_count=len(valid_evidence_map), report_present=True,
        claim_count=len(final_report.claims),
    )

    _safe_emit({"type": "analyst_done", "research_id": research_id, "request_id": request_id, "analyst": "InvestmentCommittee", "verdict": final_report.conclusion})

    return {"final_report": _to_clean_dict(final_report)}


def citation_validator_node(state: CyroGraphState) -> dict:
    """Post-committee validation: strictly verifies inline evidence IDs and emits closing events."""
    research_id = state["research_id"]
    request_id = state.get("request_id", "unknown")
    final_report_dict = state["final_report"]
    final_report = FinalResearchReport.model_validate(final_report_dict)
    context_dict = state.get("verified_context")
    context = StockResearchContext.model_validate(context_dict) if context_dict else None
    security_id = context.security_id if context else ""

    # Validate citations against verified evidence registry
    if context and context.evidence_registry:
        registry_keys = set(context.evidence_registry.keys())
        for claim in final_report.claims:
            claim.evidence_ids = [ev_id for ev_id in claim.evidence_ids if ev_id in registry_keys]

    # Log final report completion
    # Estimate total elapsed from research_started (use zero if unavailable)
    cyro_logger.final_report_completed(research_id, security_id, str(final_report.conclusion), 0)
    cyro_logger.state_event(
        research_id, "final", "cyro", "final_report_created", "success",
        security_id=security_id, intent_route_present=bool(state.get("intent_route")),
        request_id=request_id, ticker=final_report.symbol,
        horizon=final_report.horizon, evidence_count=len(context.evidence_registry) if context else 0,
        accepted_count=len(context.evidence_registry) if context else 0,
        report_present=True, claim_count=len(final_report.claims),
    )

    # Emit final report
    _safe_emit({
        "type": "final_report",
        "research_id": research_id,
        "request_id": request_id,
        "report": final_report.model_dump()
    })

    # Emit final decision
    _safe_emit({
        "type": "final_decision",
        "research_id": research_id,
        "request_id": request_id,
        "signal": final_report.conclusion,
        "summary": final_report.summary,
        "sources_used": [ev.model_dump() for ev in final_report.sources]
    })

    # Emit done event (fixing missing done event)
    _safe_emit({
        "type": "done",
        "research_id": research_id,
        "request_id": request_id,
        "conclusion": final_report.conclusion,
    })

    return {"final_report": _to_clean_dict(final_report)}


# ── Graph Builder ─────────────────────────────────────────────

def build_cyro_graph(client: Optional[MistralClient] = None, checkpointer=None):
    """Factory creating the compiled LangGraph StateGraph."""
    if checkpointer is None:
        checkpointer = InMemorySaver()

    builder = StateGraph(CyroGraphState)

    # Add Nodes
    builder.add_node("intent_router", intent_router_node)
    builder.add_node("context_builder", context_builder_node)
    builder.add_node("quality_gate", quality_gate_node)
    builder.add_node("analyst_worker", analyst_worker_node)
    builder.add_node("risk_analyst", risk_eval_node)
    builder.add_node("committee", committee_node)
    builder.add_node("citation_validator", citation_validator_node)

    # Edges
    builder.add_edge(START, "intent_router")
    builder.add_edge("intent_router", "context_builder")
    builder.add_edge("context_builder", "quality_gate")

    # Fan-Out to parallel specialist analysts via Send
    builder.add_conditional_edges("quality_gate", fan_out_analysts, ["analyst_worker"])
    builder.add_edge("analyst_worker", "risk_analyst")

    # Committee & Final Validation
    builder.add_edge("risk_analyst", "committee")
    builder.add_edge("committee", "citation_validator")
    builder.add_edge("citation_validator", END)

    return builder.compile(checkpointer=checkpointer)
