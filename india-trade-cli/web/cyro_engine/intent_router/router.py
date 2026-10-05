import datetime
import uuid
import logging
from typing import Dict, Any, List, Optional
from pydantic import BaseModel, Field

from web.cyro_engine.models import (
    ResearchRequest, IntentRoute, EntityData, ResolutionData,
    IntentData, RoutingData, ConstraintsData, RouterMetadata
)
from web.cyro_engine.mistral_client import MistralClient
from web.cyro_engine.intent_router.security_master import SecurityMaster

logger = logging.getLogger(__name__)

class LLMIntentExtraction(BaseModel):
    research_horizon: str = Field(description="intraday, short_term, medium_term, long_term, or unspecified")
    focus: List[str] = Field(description="List of focuses: fundamental, valuation, technical, news, governance, risk, sector_macro, general")
    requested_areas: List[str] = Field(description="List of requested areas")
    routing_agents: List[str] = Field(description="List of downstream agents: fundamental, filings_governance, technical, sector_peer_macro, news_catalyst, risk, committee")
    wants_buy_sell: bool = Field(description="True if the user is asking for a buy/sell recommendation")
    selected_candidate_id: Optional[str] = Field(description="If ambiguous, the security_id chosen by Mistral from the candidates provided. Null otherwise.")
    requires_clarification: bool = Field(description="True if the user intent is still ambiguous even after Mistral disambiguation.")

class IntentRouter:
    """
    CYRO Agent 1 - Intent Router
    Responsibilities: Entity resolution, Intent understanding, Horizon classification, Agent routing.
    Minimizes LLM usage by prioritizing deterministic security master lookups.
    """
    def __init__(self, client: Optional[MistralClient] = None, db_path: str = "cyro_security_master.db"):
        self.client = client or MistralClient()
        self.security_master = SecurityMaster(db_path=db_path)

    def route(self, request: ResearchRequest) -> IntentRoute:
        """
        Main routing function.
        Returns a structured IntentRoute contract.
        """
        start_time = datetime.datetime.utcnow()
        # A session identifies a conversation; this ID identifies one request.
        request_id = request.request_id or str(uuid.uuid4())
        
        # 1. Deterministic Security Resolution
        query = request.ticker if request.ticker else request.message
        res = self.security_master.resolve(query)
        
        candidates = res["candidates"]
        status = res["status"]
        method = res["method"]
        
        entity = EntityData()
        requires_clarification = False
        
        # 2. Ambiguity Handling via Mistral
        if status == "ambiguous" and len(candidates) > 1:
            logger.info(f"[IntentRouter] Ambiguous resolution for {query}. Asking Mistral to disambiguate.")
            method = "mistral_disambiguation"
            # Send ONLY the candidates
        elif status == "unresolved":
            logger.warning(f"[IntentRouter] Unresolved query: {query}")
            requires_clarification = True
        elif status == "resolved":
            c = candidates[0]
            entity = EntityData(
                security_id=c["security_id"],
                company_name=c["company_name"],
                nse_symbol=c["nse_symbol"],
                bse_code=c["bse_code"],
                exchange=c["exchange"]
            )
            
        # 3. Mistral Intent, Horizon, Focus Classification
        system_prompt = (
            "You are CYRO Agent 1 - Intent Router.\n"
            "Your job is to understand what the user wants to research without performing the research.\n"
            "Extract the horizon, focus areas, required downstream agents, and whether the user is asking for a direct buy/sell recommendation.\n"
            "Downstream agents available: fundamental, filings_governance, technical, sector_peer_macro, news_catalyst, risk, committee.\n"
            "Valid horizons: intraday, short_term, medium_term, long_term, unspecified.\n"
            "Valid focuses: fundamental, valuation, technical, news, governance, risk, sector_macro, general.\n"
        )
        
        if status == "ambiguous":
            system_prompt += (
                "\nThe query matches multiple securities. You must pick the MOST LIKELY one based on the context of the user's message, "
                "or set requires_clarification=true if it's impossible to tell.\n"
                f"CANDIDATES (Select exactly one by security_id, or none): {candidates}\n"
            )
        else:
            system_prompt += "\nThe security is already resolved. Do NOT guess the security."

        llm_out = None
        try:
            llm_out = self.client.query(
                system_prompt,
                request.message,
                LLMIntentExtraction,
                research_id=request.research_id or "",
            )
        except Exception as e:
            logger.error(f"[IntentRouter] Mistral query failed: {e}")

        # Fallback to sensible defaults if LLM fails
        if not llm_out:
            llm_out = LLMIntentExtraction(
                research_horizon="long_term",
                focus=["general"],
                requested_areas=["general"],
                routing_agents=[
                    "fundamental", 
                    "filings_governance", 
                    "technical", 
                    "sector_peer_macro", 
                    "news_catalyst",
                    "risk", 
                    "committee"
                ],
                wants_buy_sell=False,
                selected_candidate_id=None,
                requires_clarification=requires_clarification
            )

        # Handle Mistral's disambiguation choice
        if status == "ambiguous":
            if llm_out.selected_candidate_id:
                chosen = next((c for c in candidates if c["security_id"] == llm_out.selected_candidate_id), None)
                if chosen:
                    status = "resolved"
                    entity = EntityData(
                        security_id=chosen["security_id"],
                        company_name=chosen["company_name"],
                        nse_symbol=chosen["nse_symbol"],
                        bse_code=chosen["bse_code"],
                        exchange=chosen["exchange"]
                    )
                else:
                    requires_clarification = True
            else:
                requires_clarification = True

        if requires_clarification or llm_out.requires_clarification:
            status = "unresolved" if status == "unresolved" else "ambiguous"
            llm_out.requires_clarification = True

        resolution = ResolutionData(
            status=status,
            method=method,
            confidence=1.0 if status == "resolved" else 0.5,
            candidates_considered=len(candidates)
        )
        
        intent = IntentData(
            research_horizon=llm_out.research_horizon,
            focus=llm_out.focus,
            requested_areas=llm_out.requested_areas
        )
        
        routing = RoutingData(
            agents=llm_out.routing_agents
        )
        
        constraints = ConstraintsData(
            wants_buy_sell=llm_out.wants_buy_sell,
            requires_clarification=llm_out.requires_clarification
        )
        
        latency_ms = int((datetime.datetime.utcnow() - start_time).total_seconds() * 1000)
        
        metadata = RouterMetadata(
            created_at=datetime.datetime.utcnow().isoformat(),
            latency_ms=latency_ms
        )

        return IntentRoute(
            request_id=request_id,
            raw_query=request.message,
            entity=entity,
            resolution=resolution,
            intent=intent,
            routing=routing,
            constraints=constraints,
            metadata=metadata
        )
