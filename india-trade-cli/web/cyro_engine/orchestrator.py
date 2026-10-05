"""
web/cyro_engine/orchestrator.py
───────────────────────────────
LangGraph Adapter for CYRO Orchestration.

Exposes the backward-compatible CyroOrchestrator interface that delegates
execution to the compiled LangGraph StateGraph (web.cyro_engine.graph),
streaming events through callback or custom stream mode.
"""

import uuid
from typing import Callable, Optional
from web.cyro_engine.models import ResearchRequest, FinalResearchReport
from web.cyro_engine.mistral_client import MistralClient
from web.cyro_engine.graph import build_cyro_graph


class CyroOrchestrator:
    def __init__(self, client: Optional[MistralClient] = None):
        self.client = client or MistralClient()
        self.graph = build_cyro_graph(client=self.client)

    def run(self, req: ResearchRequest, cb: Callable[[dict], None]) -> FinalResearchReport:
        """
        Executes the CYRO LangGraph workflow and emits SSE events via callback.
        
        Preserves the signature: orchestrator.run(req, cb) -> FinalResearchReport
        
        Every request gets a unique request_id for SSE event correlation with frontend.
        """
        session_id = req.session_id or "default"
        research_id = f"cyro_{session_id}_{uuid.uuid4().hex[:8]}"
        request_id = f"req_{uuid.uuid4().hex[:12]}"
        config = {"configurable": {"thread_id": research_id}}

        initial_state = {
            "request": req.model_copy(update={"request_id": request_id, "research_id": research_id}).model_dump(),
            "research_id": research_id,
            "request_id": request_id,
            "resolved_ticker": req.ticker or "",
            "intent_route": None,
            "raw_context": None,
            "quality_result": None,
            "verified_context": None,
            "specialist_reports": [],
            "risk_report": None,
            "final_report": None,
        }

        # Stream custom events directly from LangGraph stream writer
        for custom_event in self.graph.stream(
            initial_state,
            config=config,
            stream_mode="custom"
        ):
            if isinstance(custom_event, dict):
                cb(custom_event)

        # Retrieve final state from checkpointer
        final_state = self.graph.get_state(config)
        final_report_dict = final_state.values.get("final_report")
        if final_report_dict:
            if isinstance(final_report_dict, dict):
                final_report = FinalResearchReport.model_validate(final_report_dict)
            else:
                final_report = final_report_dict
        else:
            final_report = FinalResearchReport(
                research_id=research_id,
                symbol=req.ticker or "UNRESOLVED",
                horizon="long_term",
                conclusion="Neutral",
                confidence=50,
                summary="Graph execution completed.",
                sections=[],
                claims=[],
                citation_map={},
                data_quality={},
                data_limitations=[],
                sources=[]
            )
        # Identity Guard: verify final report identity against request identity
        req_sym = req.ticker.upper() if req.ticker else ""
        rep_sym = final_report.symbol.upper() if final_report.symbol else ""
        
        # Also check security_id if available from intent route
        req_sec_id = ""
        rep_sec_id = final_report.security_id or ""
        intent_route = final_state.values.get("intent_route")
        if intent_route and getattr(intent_route, "entity", None):
            req_sec_id = intent_route.entity.security_id or ""
            if not req_sym:
                req_sym = (intent_route.entity.nse_symbol or "").upper()
        
        if (rep_sym and req_sym and rep_sym != req_sym) or (rep_sec_id and req_sec_id and rep_sec_id != req_sec_id):
            from web.cyro_engine.graph import CyroPipelineError
            raise CyroPipelineError(
                "IDENTITY_MISMATCH",
                f"CYRO pipeline intercepted a mismatched identity: expected {req_sym} ({req_sec_id}), got {rep_sym} ({rep_sec_id}). Request aborted for safety."
            )
            
        return final_report
