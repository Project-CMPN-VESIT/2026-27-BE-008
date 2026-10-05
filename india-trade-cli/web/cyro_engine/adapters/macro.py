import logging
from typing import Any, Dict, List
from .base import SourceAdapter, AdapterResult
from web.cyro_engine.models import EvidenceItem

logger = logging.getLogger(__name__)

class MacroAdapter(SourceAdapter):
    def __init__(self):
        super().__init__(name="CYRO Macro Engine", default_quality="calculated", timeout=15, cache_ttl=300)
        
    def _fetch_primary(self, symbol: str, **kwargs) -> Any:
        from market.cyro_macro import get_macro_context
        from market.macro import get_stock_macro_linkages
        
        # Get baseline macro snapshot
        macro_ctx = get_macro_context()
        
        # Get stock specific linkages
        linkages = get_stock_macro_linkages(symbol)
        
        # Determine if we actually have data
        has_data = any(
            macro_ctx.get(k) is not None 
            for k in ["usd_inr", "brent_crude_usd", "repo_rate_pct"]
        )
        
        if not has_data:
            raise ValueError("All core macro fetchers failed or returned None")
            
        return {
            "snapshot": macro_ctx,
            "linkages": linkages
        }

    def _fetch_fallback(self, symbol: str, **kwargs) -> tuple[Any, str]:
        raise Exception("No fallback configured for macro engine")

    def _build_evidence(self, symbol: str, research_id: str, result: AdapterResult) -> List[Dict[str, Any]]:
        if not result.data:
            return []
            
        snapshot = result.data.get("snapshot", {})
        linkages = result.data.get("linkages", {})
        
        ev_id = f"ev_{symbol.lower()}_macro"
        
        # Format a short excerpt for the LLM
        summary = linkages.get("summary", "No significant macro impact today.")
        excerpt = f"Macro context for {symbol}: {summary}. "
        if snapshot.get("usd_inr"):
            excerpt += f"USD/INR: {snapshot['usd_inr']}. "
        if snapshot.get("brent_crude_usd"):
            excerpt += f"Brent: ${snapshot['brent_crude_usd']}. "
        if snapshot.get("repo_rate_pct"):
            excerpt += f"Repo: {snapshot['repo_rate_pct']}%. "
            
        return [
            EvidenceItem(
                id=ev_id, 
                research_id=research_id, 
                ticker=symbol,
                type="macro",
                category="macro",
                source_quality=result.source_quality,
                source_name=result.source_name,
                title=f"Macroeconomic Indicators & Sensitivity — {symbol}",
                fetched_at=result.fetched_at, 
                excerpt=excerpt,
                facts=[snapshot],
                freshness=result.freshness,
            ).model_dump()
        ]
