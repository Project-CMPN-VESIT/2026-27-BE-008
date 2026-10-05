import logging
from typing import Any, Dict, List
from .base import SourceAdapter, AdapterResult
from web.cyro_engine.models import EvidenceItem

logger = logging.getLogger(__name__)

class TechnicalAdapter(SourceAdapter):
    def __init__(self):
        super().__init__(name="FinPilot Technical Analyzer", default_quality="calculated", timeout=30, cache_ttl=300)
        
    def _fetch_primary(self, symbol: str, **kwargs) -> Any:
        # Agent 2 is the only acquisition boundary. Preserve actual OHLCV bars
        # so Agent 6 can calculate indicators offline from accepted evidence.
        from market.history import get_ohlcv
        df = get_ohlcv(symbol=symbol, exchange="NSE", interval="day", days=260)
        if df is None or df.empty:
            raise ValueError("Historical OHLCV source returned no data")

        candles = []
        for timestamp, row in df.iterrows():
            def value(name: str):
                for key in (name, name.capitalize(), name.upper()):
                    if key in row:
                        return row[key]
                return None
            close = value("close")
            if close is None:
                continue
            candles.append({
                "timestamp": str(timestamp),
                "open": float(value("open") if value("open") is not None else close),
                "high": float(value("high") if value("high") is not None else close),
                "low": float(value("low") if value("low") is not None else close),
                "close": float(close),
                "volume": float(value("volume") or 0),
                "interval": "1D",
            })
        if not candles:
            raise ValueError("Historical OHLCV contained no valid candles")
        return {"interval": "1D", "as_of": candles[-1]["timestamp"], "candles": candles}

    def _fetch_fallback(self, symbol: str, **kwargs) -> tuple[Any, str]:
        # No fallback for internal technical analyzer currently
        raise Exception("No fallback configured for technical analyzer")

    def _build_evidence(self, symbol: str, research_id: str, result: AdapterResult) -> List[Dict[str, Any]]:
        if not result.data:
            return []
            
        technical_market_data = result.data
        
        ev_id = f"ev_{symbol.lower()}_technicals"
        excerpt = (
            f"Daily OHLCV: {len(technical_market_data.get('candles', []))} candles, "
            f"as of {technical_market_data.get('as_of')}"
        )
        
        return [
            EvidenceItem(
                id=ev_id, 
                research_id=research_id, 
                ticker=symbol,
                type="historical_price",
                source_quality=result.source_quality,
                source_name=result.source_name,
                title=f"Technical Indicators & Price Action — {symbol}",
                fetched_at=result.fetched_at, 
                excerpt=excerpt,
                facts=technical_market_data.get("candles", []),
                freshness=result.freshness,
            ).model_dump()
        ]
