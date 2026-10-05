import datetime
import logging
from typing import Any, Dict, List
from .base import SourceAdapter, AdapterResult
from web.cyro_engine.models import EvidenceItem

logger = logging.getLogger(__name__)

class MarketDataAdapter(SourceAdapter):
    def __init__(self):
        super().__init__(name="NSE India", default_quality="official_market_data", timeout=5, cache_ttl=60)
        
    def _fetch_primary(self, symbol: str, **kwargs) -> Any:
        from market.nse_client import nse_client
        raw = nse_client.get_quote(symbol)
        if raw and isinstance(raw, dict):
            price = (
                raw.get("lastPrice") or raw.get("priceInfo", {}).get("lastPrice")
                or raw.get("ltp")
            )
            if price:
                meta = raw.get("priceInfo") or raw
                wk = raw.get("priceInfo", {}).get("weekHighLow") or {}
                
                # Helper for safe float parsing
                def _safe_float(val):
                    try:
                        return float(str(val).replace(",", "")) if val is not None else None
                    except (ValueError, TypeError):
                        return None
                        
                def _safe_int(val):
                    try:
                        return int(str(val).replace(",", "")) if val is not None else None
                    except (ValueError, TypeError):
                        return None

                return {
                    "ltp": float(str(price).replace(",", "")),
                    "previous_close": _safe_float(meta.get("previousClose") or meta.get("close")),
                    "volume": _safe_int(raw.get("totalTradedVolume") or meta.get("totalTradedVolume")),
                    "market_cap": None,
                    "high_52w": _safe_float(wk.get("max")),
                    "low_52w": _safe_float(wk.get("min")),
                    "pct_change": _safe_float(meta.get("pChange") or meta.get("change")),
                }
        raise ValueError("Invalid or empty response from NSE")

    def _fetch_fallback(self, symbol: str, **kwargs) -> tuple[Any, str]:
        # Try Fyers
        try:
            from agent.tools import build_registry
            reg = build_registry()
            fyers_q = reg.execute("get_quote", {"symbol": symbol})
            if fyers_q and not fyers_q.get("error"):
                return {
                    "ltp": fyers_q.get("ltp") or fyers_q.get("price"),
                    "previous_close": fyers_q.get("close") or fyers_q.get("prev_close"),
                    "volume": fyers_q.get("volume"),
                    "market_cap": fyers_q.get("market_cap"),
                    "high_52w": fyers_q.get("high_52w"),
                    "low_52w": fyers_q.get("low_52w"),
                }, "Fyers Market Feed"
        except Exception as e:
            logger.warning(f"[{self.name}] Fyers fallback failed for {symbol}: {e}")

        # Try yfinance
        import yfinance as yf # type: ignore
        tk = yf.Ticker(f"{symbol}.NS")
        info = tk.fast_info
        
        # Need to safely access fast_info since it might throw exceptions if missing
        ltp = getattr(info, "last_price", None)
        if ltp is None:
            raise ValueError("yfinance failed to return a price")
            
        return {
            "ltp": ltp,
            "previous_close": getattr(info, "previous_close", None),
            "volume": getattr(info, "three_month_average_volume", None),
            "market_cap": getattr(info, "market_cap", None),
            "high_52w": getattr(info, "year_high", None),
            "low_52w": getattr(info, "year_low", None),
        }, "Yahoo Finance"

    def _build_evidence(self, symbol: str, research_id: str, result: AdapterResult) -> List[Dict[str, Any]]:
        if not result.data:
            return []
            
        market_snapshot = result.data
        ev_id = f"ev_{symbol.lower()}_quote"
        excerpt = (
            f"LTP: {market_snapshot.get('ltp')}, "
            f"Prev Close: {market_snapshot.get('previous_close')}, "
            f"Volume: {market_snapshot.get('volume')}, "
            f"52w H/L: {market_snapshot.get('high_52w')}/{market_snapshot.get('low_52w')}"
        )
        
        return [
            EvidenceItem(
                id=ev_id, 
                research_id=research_id, 
                ticker=symbol,
                type="official_market_data", 
                source_quality=result.source_quality,
                source_name=result.source_name,
                title=f"Market Quote — {symbol}",
                fetched_at=result.fetched_at, 
                excerpt=excerpt,
                facts=[{"price": market_snapshot.get("ltp")}],
                freshness=result.freshness,
            ).model_dump()
        ]
