"""
Universe = Nifty 100 (large) + Nifty Midcap 150 (mid) + Nifty Smallcap 250 (small), straight from NSE.

NSE reconstitutes these indices twice a year, so the cap segment of every stock updates automatically
and no symbol list is hard-coded anywhere.
"""

from __future__ import annotations

import logging
from typing import Dict, List

from baskets.config import CAP_INDICES
from baskets.db import Stock, bulk_upsert, session_scope, utcnow

logger = logging.getLogger(__name__)


def _rows_of(result) -> List[dict]:
    rows = result.get("data") if isinstance(result, dict) else result
    return list(rows or [])


def _is_equity_row(row: dict) -> bool:
    sym = str(row.get("symbol") or "").strip().upper()
    if not sym or sym.startswith("NIFTY"):          # the first row of an NSE index list is the index itself
        return False
    return True


def fetch_universe() -> List[dict]:
    """Return one dict per stock: symbol, cap_class, last_price, year_high, year_low, mcap_cr (free-float proxy)."""
    from market.nse_client import nse_client

    if not nse_client._init():
        raise RuntimeError("NSE client unavailable (is the `nse` package installed?)")
    nse = nse_client._nse

    out: Dict[str, dict] = {}
    # Large first so a stock present in two lists keeps its larger segment.
    for cap, index_name in CAP_INDICES.items():
        rows = None
        for attempt in range(3):
            try:
                rows = _rows_of(nse.list_equity_stocks_by_index(index_name))
                if rows:
                    break
            except Exception as exc:
                logger.warning("[Baskets] %s attempt %d failed: %s", index_name, attempt + 1, exc)
        if not rows:
            raise RuntimeError(f"Could not load constituents of {index_name}")
        for r in rows:
            if not _is_equity_row(r):
                continue
            sym = str(r["symbol"]).strip().upper()
            if sym in out:
                continue
            ffmc = r.get("ffmc")
            out[sym] = {
                "symbol": sym,
                "cap_class": cap,
                "last_price": r.get("lastPrice"),
                "year_high": r.get("yearHigh"),
                "year_low": r.get("yearLow"),
                "mcap_cr": (float(ffmc) / 1e7) if ffmc else None,
            }
        logger.info("[Baskets] %s -> %d stocks", index_name, sum(1 for v in out.values() if v["cap_class"] == cap))
    return list(out.values())


def refresh_universe() -> int:
    """Pull the latest constituents into the DB; stocks that left the indices are flagged out of the universe."""
    rows = fetch_universe()
    now = utcnow()
    with session_scope() as s:
        payload = [{**r, "in_universe": True, "updated_at": now} for r in rows]
        # Keep Yahoo-derived market cap if we already have it (NSE's number is only a free-float proxy).
        existing = {x.symbol: x for x in s.query(Stock).all()}
        for p in payload:
            old = existing.get(p["symbol"])
            if old is not None and old.sector:           # fundamentals stage already filled richer data
                p["mcap_cr"] = old.mcap_cr or p["mcap_cr"]
        bulk_upsert(s, Stock, payload, ["symbol"])
        live = {r["symbol"] for r in rows}
        for sym, old in existing.items():
            if sym not in live and old.in_universe:
                old.in_universe = False
    return len(rows)


def universe_symbols(cap_classes=None) -> List[str]:
    with session_scope() as s:
        q = s.query(Stock.symbol).filter(Stock.in_universe.is_(True))
        if cap_classes:
            q = q.filter(Stock.cap_class.in_(list(cap_classes)))
        return [r[0] for r in q.order_by(Stock.symbol)]
