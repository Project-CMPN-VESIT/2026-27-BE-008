"""
web/cyro_engine/context_builder.py
────────────────────────────────────
CYRO Agent 2: Context Builder

Assembles StockResearchContext by resolving IntentRoute via FetchPlan.
Executes SourceAdapters in parallel, normalizes evidence, and stores 
structured data into Neon PostgreSQL.
"""

import time
import logging
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor
from typing import Dict, List, Any, Optional

from web.cyro_engine.models import (
    StockResearchContext,
    EvidenceItem,
    DataQualityFlag,
    IntentRoute
)
from web.cyro_engine.evidence_store import EvidenceStore

from web.cyro_engine.adapters import (
    FetchPlan,
    MarketDataAdapter,
    TechnicalAdapter,
    FinancialsAdapter,
    ShareholdingAdapter,
    NewsAdapter,
    EventsAdapter,
    MacroAdapter,
    PeerAdapter,
    FilingsAdapter,
    InsiderAdapter,
    LitigationAdapter,
    RagAdapter
)

logger = logging.getLogger(__name__)

class ContextBuilder:
    def __init__(self, research_id: str):
        self.research_id = research_id
        self.store = EvidenceStore()
        
        # Instantiate adapters
        self.adapters = {
            "market_data": MarketDataAdapter(),
            "technical": TechnicalAdapter(),
            "financials": FinancialsAdapter(),
            "shareholding": ShareholdingAdapter(),
            "news": NewsAdapter(),
            "events": EventsAdapter(),
            "macro": MacroAdapter(),
            "peer": PeerAdapter(),
            "filings": FilingsAdapter(),
            "insider": InsiderAdapter(),
            "litigation": LitigationAdapter(),
            "rag": RagAdapter(),
        }

    def build_context(self, route: IntentRoute) -> StockResearchContext:
        """
        Main Agent 2 Orchestration:
        1. Resolve Fetch Plan.
        2. Execute Adapters in parallel for required securities.
        3. Store Evidence Idempotently.
        4. Return compact Context for LLM.
        """
        fetched_at = datetime.utcnow().isoformat() + "Z"
        plan = FetchPlan(route)
        
        # Output registry
        evidence_registry: Dict[str, EvidenceItem] = {}
        data_quality_flags: List[DataQualityFlag] = []
        
        # Run fetches concurrently for all securities in the plan
        for symbol in plan.securities:
            logger.info(f"[ContextBuilder] Executing fetch plan for {symbol}")
            
            futures = {}
            with ThreadPoolExecutor(max_workers=max(8, len(plan.required_adapters))) as ex:
                for adapter_name in plan.required_adapters:
                    adapter = self.adapters.get(adapter_name)
                    if adapter:
                        futures[adapter_name] = ex.submit(adapter.fetch, symbol=symbol)
                        
            results = {name: future.result() for name, future in futures.items()}
            
            # Process results and convert to EvidenceItems
            new_evidence_dicts = []
            
            for adapter_name, result in results.items():
                if result.error:
                    logger.warning(f"[ContextBuilder] Adapter {adapter_name} failed: {result.error}")
                    data_quality_flags.append(DataQualityFlag(
                        module=adapter_name,
                        status="unavailable",
                        message=result.error,
                        code="SOURCE_UNAVAILABLE",
                        severity="WARNING",
                    ))
                    continue

                if result.freshness == "empty":
                    data_quality_flags.append(DataQualityFlag(
                        module=adapter_name,
                        status="empty",
                        message=f"{result.source_name} returned no usable data after fallback.",
                        code="EMPTY_SOURCE_RESULT",
                        severity="WARNING",
                    ))
                    
                adapter = self.adapters[adapter_name]
                items = adapter.to_evidence_items(symbol, self.research_id, result)
                # Adapters know the ticker, but Agent 3 scopes by the canonical
                # security-master ID resolved by Agent 1.
                for item in items:
                    item["security_id"] = route.entity.security_id
                new_evidence_dicts.extend(items)
                
            # Persist immutable, run-scoped keys. In-memory evidence IDs used by
            # analyst citations stay unchanged, while another run cannot overwrite
            # this run's stored provenance.
            if new_evidence_dicts:
                persisted = [
                    {**item, "id": f"{self.research_id}:{item['id']}"}
                    for item in new_evidence_dicts
                ]
                if not self.store.store_evidence_batch(persisted):
                    logger.warning(
                        "[ContextBuilder] Evidence persistence failed for %s; continuing with in-memory evidence",
                        self.research_id,
                    )
                
            # Populate the Context dictionary with Pydantic Models for Agent 3
            for item_dict in new_evidence_dicts:
                evidence_registry[item_dict["id"]] = EvidenceItem(**item_dict)
                
        # Build the final StockResearchContext
        # Note: We keep the response compact by handing off the evidence registry.
        # Agent 3 (Quality Gate) and specialist analysts will use this registry.
        
        primary_symbol = plan.securities[0] if plan.securities else "UNKNOWN"
        identity = {
            "symbol": primary_symbol, 
            "exchange": route.entity.exchange or "NSE",
            "company_name": route.entity.company_name or primary_symbol,
            "sector": "Unknown" 
        }

        context = StockResearchContext(
            security_id=route.entity.security_id,
            identity=identity,
            evidence_registry=evidence_registry,
            # We omit stuffing full raw dicts into technical_market_data, etc. 
            # because the evidence_registry now holds the structured, compact facts.
        )
        
        return context
