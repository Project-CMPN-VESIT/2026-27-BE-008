"""Price-derived factors (momentum, trend, leadership, liquidity). Pure functions: easy to test offline."""

from __future__ import annotations

import math
from typing import Dict, Optional

import pandas as pd

TRADING_DAYS = {"1m": 21, "3m": 63, "6m": 126, "12m": 252}


def _ret(closes: pd.Series, n: int) -> Optional[float]:
    if len(closes) <= n:
        return None
    base = float(closes.iloc[-1 - n])
    if base <= 0:
        return None
    return (float(closes.iloc[-1]) / base - 1.0) * 100.0


def price_factors(closes: pd.Series, volumes: Optional[pd.Series] = None,
                  bench: Optional[pd.Series] = None) -> Dict[str, object]:
    """
    closes / volumes / bench: date-indexed, ascending. Any factor that lacks enough history is omitted
    (left to the scorer's coverage logic) rather than guessed.
    """
    closes = closes.dropna().astype(float)
    out: Dict[str, object] = {}
    if len(closes) < 30:
        return out
    last = float(closes.iloc[-1])

    for label, n in TRADING_DAYS.items():
        v = _ret(closes, n)
        if v is not None:
            out[f"ret_{label}"] = round(v, 2)

    window = closes.iloc[-252:]
    high52 = float(window.max())
    if high52 > 0:
        out["high_52w"] = round(high52, 2)
        out["dist_high_pct"] = round((1.0 - last / high52) * 100.0, 2)

    if len(closes) >= 200:
        sma200 = float(closes.iloc[-200:].mean())
        out["sma200"] = round(sma200, 2)
        out["above_200dma"] = bool(last > sma200)
    if len(closes) >= 50:
        out["sma50"] = round(float(closes.iloc[-50:].mean()), 2)

    if bench is not None and "ret_12m" in out:
        b = bench.dropna().astype(float)
        bret = _ret(b, TRADING_DAYS["12m"])
        if bret is not None:
            out["rel_strength_12m"] = round(out["ret_12m"] - bret, 2)

    rets = closes.pct_change().dropna().iloc[-252:]
    if len(rets) >= 60:
        out["volatility_pct"] = round(float(rets.std()) * math.sqrt(252) * 100.0, 2)

    if volumes is not None:
        v = volumes.reindex(closes.index).fillna(0.0).astype(float)
        if len(v) >= 252 and v.iloc[-252:].mean() > 0:
            out["vol_surge"] = round(float(v.iloc[-63:].mean() / v.iloc[-252:].mean()), 3)
        if len(v) >= 20:
            traded = (closes.iloc[-20:] * v.iloc[-20:]).mean()          # Rs per day
            out["avg_value_cr"] = round(float(traded) / 1e7, 3)
    out["last_close"] = round(last, 2)
    out["bars"] = int(len(closes))              # trading sessions of history (used to keep brand-new IPOs out)
    return out
