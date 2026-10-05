"""Daily price history (close + volume) for the universe and the NIFTY 50 benchmark."""

from __future__ import annotations

import logging
from typing import Callable, Dict, List, Optional

import pandas as pd

from baskets.config import BENCHMARK_SYMBOL, PRICE_CHUNK_SIZE, PRICE_HISTORY_PERIOD
from baskets.db import Price, bulk_upsert, session_scope

logger = logging.getLogger(__name__)


def _yf_symbol(symbol: str) -> str:
    return symbol if symbol.startswith("^") else f"{symbol}.NS"


def _frame_for(df: pd.DataFrame, ticker: str) -> Optional[pd.DataFrame]:
    """Pull one ticker's Close/Volume out of a (possibly multi-index) yfinance download."""
    try:
        if isinstance(df.columns, pd.MultiIndex):
            if ticker not in df.columns.get_level_values(0):
                return None
            sub = df[ticker]
        else:
            sub = df
        sub = sub[["Close", "Volume"]] if "Volume" in sub.columns else sub[["Close"]].assign(Volume=0.0)
        sub = sub.dropna(subset=["Close"])
        return sub if not sub.empty else None
    except Exception:
        return None


def _rows_from_frame(symbol: str, sub: pd.DataFrame) -> List[dict]:
    rows = []
    for idx, r in sub.iterrows():
        d = idx.date() if hasattr(idx, "date") else idx
        vol = r.get("Volume")
        rows.append({"symbol": symbol, "date": d, "close": float(r["Close"]),
                     "volume": float(vol) if vol == vol and vol is not None else 0.0})
    return rows


def _have_history() -> bool:
    with session_scope() as s:
        return s.query(Price.symbol).filter(Price.symbol == BENCHMARK_SYMBOL).count() > 200


def refresh_prices(symbols: List[str], progress: Optional[Callable[[int, int], None]] = None) -> Dict[str, int]:
    """
    Bulk-download price history. First run pulls ~2 years; later runs only top up the last month.
    Returns {"symbols_ok": n, "symbols_failed": n, "rows": n}.
    """
    import yfinance as yf

    period = "1mo" if _have_history() else PRICE_HISTORY_PERIOD
    tickers = [BENCHMARK_SYMBOL] + [s for s in symbols if s != BENCHMARK_SYMBOL]
    total = len(tickers)
    ok = failed = rows_written = 0

    for i in range(0, total, PRICE_CHUNK_SIZE):
        chunk = tickers[i:i + PRICE_CHUNK_SIZE]
        df = None
        for attempt in range(3):
            try:
                df = yf.download([_yf_symbol(t) for t in chunk], period=period, interval="1d", auto_adjust=True,
                                 progress=False, threads=True, group_by="ticker")
                if df is not None and not df.empty:
                    break
            except Exception as exc:
                logger.warning("[Baskets] price chunk %d attempt %d failed: %s", i // PRICE_CHUNK_SIZE, attempt + 1, exc)
        payload: List[dict] = []
        for t in chunk:
            sub = _frame_for(df, _yf_symbol(t)) if df is not None and not df.empty else None
            if sub is None:
                failed += 1
                continue
            ok += 1
            payload.extend(_rows_from_frame(t, sub))
        if payload:
            with session_scope() as s:
                bulk_upsert(s, Price, payload, ["symbol", "date"])
            rows_written += len(payload)
        if progress:
            progress(min(i + PRICE_CHUNK_SIZE, total), total)
    logger.info("[Baskets] prices: %d ok, %d failed, %d rows", ok, failed, rows_written)
    return {"symbols_ok": ok, "symbols_failed": failed, "rows": rows_written}


def load_close_frame(symbols: List[str], min_date=None) -> pd.DataFrame:
    """Wide DataFrame (date x symbol) of closes, forward-filled over holidays/suspensions."""
    if not symbols:
        return pd.DataFrame()
    with session_scope() as s:
        q = s.query(Price.symbol, Price.date, Price.close).filter(Price.symbol.in_(symbols))
        if min_date is not None:
            q = q.filter(Price.date >= min_date)
        data = q.all()
    if not data:
        return pd.DataFrame()
    df = pd.DataFrame(data, columns=["symbol", "date", "close"])
    wide = df.pivot(index="date", columns="symbol", values="close").sort_index()
    wide.index = pd.to_datetime(wide.index)
    return wide.ffill()


def load_series(symbol: str) -> pd.DataFrame:
    """Close/volume for one symbol, ascending by date."""
    with session_scope() as s:
        rows = s.query(Price.date, Price.close, Price.volume).filter(Price.symbol == symbol).order_by(Price.date).all()
    if not rows:
        return pd.DataFrame(columns=["close", "volume"])
    df = pd.DataFrame(rows, columns=["date", "close", "volume"]).set_index("date")
    df.index = pd.to_datetime(df.index)
    return df
