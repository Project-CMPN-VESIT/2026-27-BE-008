import logging
from typing import Any, Dict, List
from .base import SourceAdapter, AdapterResult
from web.cyro_engine.models import EvidenceItem

logger = logging.getLogger(__name__)

class EventsAdapter(SourceAdapter):
    def __init__(self):
        super().__init__(name="Corporate Events API", default_quality="primary", timeout=10, cache_ttl=3600)
        
    def _fetch_primary(self, symbol: str, **kwargs) -> Any:
        try:
            from web.cyro_engine.equity_db_reader import get_corporate_events
            corp_ev = get_corporate_events(symbol)
            if corp_ev and corp_ev.get("available") and corp_ev.get("events"):
                return {"type": "upstox", "data": corp_ev["events"]}
        except Exception as e:
            logger.warning(f"[EventsAdapter] equity.db failed for {symbol}: {e}")
            
        raise ValueError("Primary events (equity.db) failed or unavailable")

    def _fetch_fallback(self, symbol: str, **kwargs) -> tuple[Any, str]:
        events: dict = {}
        try:
            from market.nse_client import nse_client
            actions = nse_client.get_actions(symbol)
            if actions:
                events["corporate_actions"] = actions
            meetings = nse_client.get_board_meetings(symbol)
            if meetings:
                events["board_meetings"] = meetings
                
            if events:
                return {"type": "nse", "data": events}, "NSE India"
        except Exception as e:
            logger.warning(f"[EventsAdapter] NSE events fallback failed for {symbol}: {e}")
            
        # yfinance earnings calendar fallback
        try:
            from agent.tools import build_registry
            reg = build_registry()
            events["earnings"] = reg.execute("get_earnings_calendar", {"symbol": symbol})
            events["upcoming"] = reg.execute("get_upcoming_events", {"symbol": symbol})
            if events.get("earnings") or events.get("upcoming"):
                return {"type": "yfinance", "data": events}, "Yahoo Finance"
        except Exception:
            pass
            
        raise Exception("All event fallbacks failed")

    def _build_evidence(self, symbol: str, research_id: str, result: AdapterResult) -> List[Dict[str, Any]]:
        if not result.data:
            return []
            
        payload = result.data.get("data")
        source_type = result.data.get("type")
        
        if source_type == "upstox":
            events_data = payload
            ev_id = f"ev_{symbol.lower()}_upstox_corp_events"
            recent = events_data[0] if events_data else {}
            
            return [EvidenceItem(
                id=ev_id, research_id=research_id, ticker=symbol,
                type="exchange_filing", category="corporate_event", source_quality="primary",
                source_name="Upstox Corporate Actions (via equity.db)",
                title=f"Corporate Events — {symbol}",
                fetched_at=result.fetched_at,
                excerpt=f"Latest: {recent.get('event_type')} on {recent.get('event_date')} — {recent.get('title')}",
                facts=events_data[:10],
                freshness=result.freshness,
            ).model_dump()]
            
        elif source_type in ["nse", "yfinance"]:
            ev_id = f"ev_{symbol.lower()}_fallback_events"
            return [EvidenceItem(
                id=ev_id, research_id=research_id, ticker=symbol,
                type="official_market_data" if source_type == "nse" else "trusted_secondary", category="corporate_event",
                source_quality="official_market_data" if source_type == "nse" else "trusted_secondary",
                source_name=result.source_name,
                title=f"Corporate Events & Meetings — {symbol}",
                fetched_at=result.fetched_at,
                excerpt="Corporate actions and board meetings fallback",
                facts=[payload],
                freshness=result.freshness,
            ).model_dump()]
            
        return []
