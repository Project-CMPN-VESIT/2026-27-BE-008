from typing import List, Dict, Any, Set
import logging
from web.cyro_engine.models import IntentRoute

logger = logging.getLogger(__name__)

class FetchPlan:
    """
    Derives which sources to fetch based on Agent 1's IntentRoute.
    Enforces scope and prevents unnecessary over-fetching.
    """
    def __init__(self, route: IntentRoute):
        self.route = route
        self.securities = self._derive_securities()
        self.required_adapters = self._derive_required_adapters()
        
    def _derive_securities(self) -> List[str]:
        """
        Determines the strict list of primary securities to fetch.
        Currently handles single-stock scopes based on the resolved entity.
        Explicit multi-stock handling can be expanded here based on IntentRoute.
        """
        # Strictly scope to the resolved ticker
        ticker = self.route.entity.nse_symbol
        if not ticker:
            raise ValueError("FetchPlan requires a resolved NSE symbol; no default ticker is permitted.")
            
        return [ticker]

    def _derive_required_adapters(self) -> Set[str]:
        """
        Map intent horizon, focus, and routing to necessary adapters.
        Adapters: market_data, technical, financials, shareholding, events, news, macro, rag
        """
        adapters = set(["market_data"]) # Market data is always baseline for identity/quote
        
        horizon = self.route.intent.research_horizon
        agents = self.route.routing.agents
        
        # Technicals & Short-term
        if horizon in ["intraday", "short_term", "swing"] or "technical" in agents:
            adapters.add("technical")
            
        # News/Catalyst
        if horizon in ["short_term", "swing"] or "news_catalyst" in agents or "news" in self.route.intent.focus:
            adapters.add("news")
            adapters.add("events")
            adapters.add("filings")
            adapters.add("insider")
            
        # Fundamentals & Filings
        if horizon in ["swing", "medium_term", "long_term"] or "fundamental" in agents or "filings_governance" in agents:
            adapters.add("financials")
            adapters.add("shareholding")
            adapters.add("events")
            adapters.add("filings")
            adapters.add("insider")
            adapters.add("litigation")
            
        # Risk
        if "risk" in agents:
            adapters.add("litigation")

        # Sector/Peer/Macro
        if horizon in ["medium_term", "long_term"] or "sector_peer_macro" in agents:
            adapters.add("macro")
            adapters.add("peer")

        # RAG for long-form contextual documents (Annual Reports, Filings, Transcripts)
        if horizon in ["medium_term", "long_term"] or "fundamental" in agents or "filings_governance" in agents:
            adapters.add("rag")
            
        logger.info(f"[FetchPlan] Derived adapters for {self.route.entity.nse_symbol}: {adapters}")
        return adapters

    def should_fetch(self, adapter_name: str) -> bool:
        """Check if an adapter should be run."""
        return adapter_name in self.required_adapters
