"""
Basket performance (value series for the chart + returns). Pure pandas, no DB access.

Two honest kinds of history, kept separate and labelled:
  * LIVE      - tracked forward from the day a basket was created, following every rebalance snapshot.
  * SIMULATED - today's holdings (constant weights) applied to the prior year of prices, so a brand-new
                basket has a chart on day one. It has hindsight bias and must be shown as "simulated".
"""

from __future__ import annotations

import datetime as dt
from typing import Dict, List, Optional, Sequence, Tuple

import pandas as pd

Rebal = Tuple[dt.date, Dict[str, float]]          # (as_of, {symbol: weight})

RANGE_DAYS = {"7D": 7, "1M": 30, "3M": 91, "6M": 182, "1Y": 365}


def compute_live_nav(rebalances: Sequence[Rebal], closes: pd.DataFrame, start_value: float = 100.0) -> pd.Series:
    """
    Buy-and-hold between rebalances. On a rebalance date the portfolio value carries over unchanged and is
    re-allocated to the new weights (symbols without a price that day are dropped and weights renormalised).
    """
    if not rebalances or closes.empty:
        return pd.Series(dtype=float)
    rebs = sorted(rebalances, key=lambda r: r[0])
    idx = closes.index
    first = pd.Timestamp(rebs[0][0])
    dates = idx[idx >= first]
    if len(dates) == 0:
        return pd.Series(dtype=float)

    # map each rebalance to the first trading date on/after its as_of
    reb_at: Dict[pd.Timestamp, Dict[str, float]] = {}
    for as_of, w in rebs:
        pos = idx.searchsorted(pd.Timestamp(as_of))
        if pos < len(idx):
            reb_at[idx[pos]] = w

    units: Dict[str, float] = {}
    value = float(start_value)
    out: Dict[pd.Timestamp, float] = {}
    for t in dates:
        if units:
            value = sum(u * float(closes.at[t, s]) for s, u in units.items() if pd.notna(closes.at[t, s])) or value
        if t in reb_at:
            w = {s: x for s, x in reb_at[t].items() if s in closes.columns and pd.notna(closes.at[t, s]) and closes.at[t, s] > 0}
            tot = sum(w.values())
            if tot > 0:
                units = {s: value * (x / tot) / float(closes.at[t, s]) for s, x in w.items()}
        out[t] = value
    return pd.Series(out, dtype=float)


def constant_weight_nav(weights: Dict[str, float], closes: pd.DataFrame, start_value: float = 100.0) -> pd.Series:
    """Daily-rebalanced constant weights; names without a price on a day are skipped and weights renormalised."""
    cols = [s for s in weights if s in closes.columns]
    if not cols or len(closes) < 2:
        return pd.Series(dtype=float)
    rets = closes[cols].pct_change()
    w = pd.Series({s: weights[s] for s in cols})
    valid = rets.notna()
    wsum = (valid * w).sum(axis=1)
    daily = (rets.fillna(0.0) * w).sum(axis=1) / wsum.where(wsum > 0)
    daily = daily.fillna(0.0)
    daily.iloc[0] = 0.0
    return (1.0 + daily).cumprod() * start_value


def fd_series(index: pd.DatetimeIndex, rate: float, start_value: float = 100.0) -> pd.Series:
    """Fixed-deposit style benchmark: simple interest accrued daily on a 365-day year."""
    if len(index) == 0:
        return pd.Series(dtype=float)
    days = (index - index[0]).days.astype(float)
    return pd.Series(start_value * (1.0 + rate * days / 365.0), index=index)


def _rebase(s: pd.Series, base: float = 100.0) -> pd.Series:
    s = s.dropna()
    if s.empty or s.iloc[0] == 0:
        return s
    return s / s.iloc[0] * base


def build_series(rebalances: Sequence[Rebal], closes: pd.DataFrame, bench: pd.Series, fd_rate: float,
                 sim_days: int = 365) -> pd.DataFrame:
    """
    Columns: basket, nifty, fd (all rebased to 100 at the first date) and live (False before creation).
    Empty frame if there is nothing to chart.
    """
    if not rebalances or closes.empty:
        return pd.DataFrame(columns=["basket", "nifty", "fd", "live"])
    rebs = sorted(rebalances, key=lambda r: r[0])
    created = pd.Timestamp(rebs[0][0])
    latest_w = rebs[-1][1]

    sim_start = max(closes.index[0], created - pd.Timedelta(days=sim_days))
    sim_closes = closes.loc[(closes.index >= sim_start) & (closes.index <= created)]
    sim = constant_weight_nav(latest_w, sim_closes) if len(sim_closes) > 1 else pd.Series(dtype=float)

    carry = float(sim.iloc[-1]) if len(sim) else 100.0
    live = compute_live_nav(rebs, closes.loc[closes.index >= created], start_value=carry)
    basket = pd.concat([sim.iloc[:-1] if len(sim) else sim, live]).sort_index()
    basket = basket[~basket.index.duplicated(keep="last")]
    if basket.empty:
        return pd.DataFrame(columns=["basket", "nifty", "fd", "live"])
    basket = _rebase(basket)

    nifty = _rebase(bench.reindex(basket.index).ffill().dropna()) if bench is not None and len(bench) else pd.Series(dtype=float)
    df = pd.DataFrame({"basket": basket})
    df["nifty"] = nifty.reindex(df.index).ffill()
    df["fd"] = fd_series(df.index, fd_rate)
    df["live"] = df.index >= created
    return df


def slice_range(df: pd.DataFrame, key: str) -> pd.DataFrame:
    """Window the series ('7D'..'1Y' or 'ALL') and rebase every line to 100 at the window start."""
    if df.empty:
        return df
    key = (key or "ALL").upper()
    out = df
    if key in RANGE_DAYS:
        start = df.index[-1] - pd.Timedelta(days=RANGE_DAYS[key])
        out = df[df.index >= start]
        if len(out) < 2:
            out = df.iloc[-2:]
    out = out.copy()
    for col in ("basket", "nifty", "fd"):
        s = out[col].dropna()
        if not s.empty and s.iloc[0] != 0:
            out[col] = out[col] / s.iloc[0] * 100.0
    return out


def pct_return(s: pd.Series) -> Optional[float]:
    s = s.dropna()
    if len(s) < 2 or s.iloc[0] == 0:
        return None
    return float((s.iloc[-1] / s.iloc[0] - 1.0) * 100.0)


def headline_return(df: pd.DataFrame, min_live_days: int = 60) -> Tuple[Optional[float], str]:
    """
    The single "overall return" shown on a basket card, plus its basis:
      'live'          once the basket has >= min_live_days of tracked history (return since creation)
      'simulated_1y'  before that (1y simulated + live so far) - the UI must flag it as simulated
    """
    if df.empty:
        return None, "none"
    live = df[df["live"]]
    if len(live) > 1 and (live.index[-1] - live.index[0]).days >= min_live_days:
        return pct_return(live["basket"]), "live"
    return pct_return(df["basket"]), "simulated_1y"


def to_points(df: pd.DataFrame, notional: float = 100000.0) -> List[dict]:
    """Chart points with values in rupees for a `notional` investment (default Rs 1,00,000, like the reference)."""
    pts = []
    for ts, r in df.iterrows():
        pts.append({
            "date": ts.date().isoformat(),
            "basket": round(float(r["basket"]) / 100.0 * notional, 2),
            "nifty": None if pd.isna(r["nifty"]) else round(float(r["nifty"]) / 100.0 * notional, 2),
            "fd": round(float(r["fd"]) / 100.0 * notional, 2),
            "live": bool(r["live"]),
        })
    return pts
