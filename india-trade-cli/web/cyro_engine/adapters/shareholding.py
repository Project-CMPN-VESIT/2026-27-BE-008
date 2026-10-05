import logging
from typing import Any, Dict, List
from .base import SourceAdapter, AdapterResult
from web.cyro_engine.models import EvidenceItem

logger = logging.getLogger(__name__)

class ShareholdingAdapter(SourceAdapter):
    def __init__(self):
        super().__init__(name="Shareholding Patterns", default_quality="primary", timeout=10, cache_ttl=21600)
        
    def _fetch_primary(self, symbol: str, **kwargs) -> Any:
        try:
            from web.cyro_engine.equity_db_reader import get_shareholding_trend
            shold = get_shareholding_trend(symbol)
            if shold and shold.get("available") and shold.get("trend"):
                return {"type": "upstox", "data": shold}
        except Exception as e:
            logger.warning(f"[ShareholdingAdapter] equity.db failed for {symbol}: {e}")
            
        raise ValueError("Primary shareholding (equity.db) failed or unavailable")

    def _fetch_fallback(self, symbol: str, **kwargs) -> tuple[Any, str]:
        # Try NSE
        from market.nse_client import nse_client
        res = nse_client.get_shareholding(symbol)
        if res:
            return {"type": "nse", "data": res}, "NSE India"
        
        raise ValueError("Fallback shareholding (NSE) failed")

    def _build_evidence(self, symbol: str, research_id: str, result: AdapterResult) -> List[Dict[str, Any]]:
        if not result.data:
            return []
            
        payload = result.data.get("data", {})
        source_type = result.data.get("type")
        
        if source_type == "upstox":
            latest_shold = payload.get("latest", {})
            delta = payload.get("delta_qoq", {})
            excerpt = (
                f"Latest: Promoters {latest_shold.get('promoters_pct')}%, "
                f"FII {latest_shold.get('fii_pct')}%, "
                f"MF {latest_shold.get('mutual_funds_pct')}%, "
                f"Other DII {latest_shold.get('other_dii_pct')}%"
                + (f" | QoQ Δ Promoter: {delta.get('promoters_pct_qoq_change')}pp, "
                   f"FII: {delta.get('fii_pct_qoq_change')}pp" if delta else "")
            )
            ev_id = f"ev_{symbol.lower()}_upstox_shareholding"
            
            return [EvidenceItem(
                id=ev_id, research_id=research_id, ticker=symbol,
                type="exchange_filing", source_quality="primary",
                source_name="Upstox Shareholding Pattern (via equity.db)",
                title=f"Multi-Quarter Shareholding Trend — {symbol}",
                fetched_at=result.fetched_at, excerpt=excerpt,
                facts=payload.get("trend", [])[:6],
                freshness=result.freshness,
            ).model_dump()]
            
        elif source_type == "nse":
            ev_id = f"ev_{symbol.lower()}_nse_shareholding"
            return [EvidenceItem(
                id=ev_id, research_id=research_id, ticker=symbol,
                type="official_market_data", source_quality="official_market_data",
                source_name=result.source_name,
                title=f"Quarterly Shareholding Pattern — {symbol}",
                fetched_at=result.fetched_at,
                excerpt="NSE quarterly promoter / public / FII / DII holding history",
                facts=[payload] if isinstance(payload, dict) else [],
                freshness=result.freshness,
            ).model_dump()]
            
        return []
