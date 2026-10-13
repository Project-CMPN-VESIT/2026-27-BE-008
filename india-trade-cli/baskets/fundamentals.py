"""
Fundamental factors from Yahoo Finance statements (+ NSE promoter holding).

Screener.in's JSON API is login-gated now, so Yahoo's annual (4-5y) and quarterly (5q) statements are the
source. `factors_from_statements` is a pure function (DataFrames in, dict out) so it is unit-tested offline.
All growth / return / margin values are in percent.
"""

from __future__ import annotations

import datetime as dt
import logging
import math
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Callable, Dict, List, Optional, Tuple

import pandas as pd

from baskets.config import FUNDAMENTALS_TTL_DAYS, FUNDAMENTALS_WORKERS
from baskets.db import Fundamental, Stock, bulk_upsert, session_scope, utcnow

logger = logging.getLogger(__name__)

Num = Optional[float]


# ── pure helpers ─────────────────────────────────────────────────────────────────────────────────────────
def _f(x) -> Num:
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return None if (math.isnan(v) or math.isinf(v)) else v


def _by_date(df: Optional[pd.DataFrame], *names: str) -> Dict[pd.Timestamp, float]:
    """First matching row of a Yahoo statement as {column_date: value}."""
    if df is None or getattr(df, "empty", True):
        return {}
    for n in names:
        if n in df.index:
            row = df.loc[n]
            return {pd.Timestamp(c): v for c, v in ((c, _f(row[c])) for c in df.columns) if v is not None}
    return {}


def _desc_dates(df: Optional[pd.DataFrame]) -> List[pd.Timestamp]:
    if df is None or getattr(df, "empty", True):
        return []
    return sorted((pd.Timestamp(c) for c in df.columns), reverse=True)


def _cagr(values: List[Num]) -> Num:
    """CAGR in % across the first and last available values of a newest-first list; needs both > 0."""
    idx = [i for i, v in enumerate(values) if v is not None]
    if len(idx) < 2:
        return None
    new, old, years = values[idx[0]], values[idx[-1]], idx[-1] - idx[0]
    if years < 1 or new is None or old is None or new <= 0 or old <= 0:
        return None
    return ((new / old) ** (1.0 / years) - 1.0) * 100.0


def _first(values: List[Num]) -> Num:
    return next((v for v in values if v is not None), None)


def _std(values: List[float]) -> Num:
    if len(values) < 3:
        return None
    m = sum(values) / len(values)
    return math.sqrt(sum((x - m) ** 2 for x in values) / len(values))


def _yoy(df: Optional[pd.DataFrame], names: Tuple[str, ...]) -> Num:
    """
    Latest quarter vs the same quarter a year earlier, in %.
    Yahoo's quarterly columns are NOT always consecutive (a quarter can be missing), so the comparison
    quarter is found by date (350-380 days earlier), never by position.
    """
    dates = _desc_dates(df)
    if len(dates) < 2:
        return None
    series = _by_date(df, *names)
    new = series.get(dates[0])
    old = next((series.get(d) for d in dates[1:] if 350 <= (dates[0] - d).days <= 380), None)
    if new is None or old is None or old <= 0:
        return None
    return (new / old - 1.0) * 100.0


def factors_from_statements(inc, bs, cf, qinc, info: Optional[dict]) -> Dict[str, object]:
    """Turn Yahoo statements + .info into the factor dict the legend models score."""
    info = info or {}
    out: Dict[str, object] = {}
    dates = _desc_dates(inc)[:5]

    rev = _by_date(inc, "Total Revenue", "Operating Revenue")
    ni = _by_date(inc, "Net Income", "Net Income Common Stockholders")
    ebit = _by_date(inc, "EBIT", "Operating Income")
    eq = _by_date(bs, "Stockholders Equity", "Common Stock Equity")
    debt = _by_date(bs, "Total Debt")
    assets = _by_date(bs, "Total Assets")
    cur_liab = _by_date(bs, "Current Liabilities")
    cfo = _by_date(cf, "Operating Cash Flow")
    fcf = _by_date(cf, "Free Cash Flow")

    rev_l = [rev.get(d) for d in dates]
    ni_l = [ni.get(d) for d in dates]

    roe_hist: List[Num] = []
    roce_hist: List[Num] = []
    opm_hist: List[Num] = []
    for d in dates:
        n, e = ni.get(d), eq.get(d)
        roe_hist.append(n / e * 100.0 if n is not None and e and e > 0 else None)
        eb, ta, cl = ebit.get(d), assets.get(d), cur_liab.get(d)
        cap = (ta - cl) if ta is not None and cl is not None else None
        roce_hist.append(eb / cap * 100.0 if eb is not None and cap and cap > 0 else None)
        r = rev.get(d)
        opm_hist.append(ebit.get(d) / r * 100.0 if ebit.get(d) is not None and r and r > 0 else None)

    if _first(roe_hist) is not None:
        out["roe"] = round(_first(roe_hist), 2)
        valid = [x for x in roe_hist if x is not None]
        out["roe_years_ok"] = round(sum(1 for x in valid if x >= 15.0) / len(valid), 3)
    if _first(roce_hist) is not None:
        out["roce"] = round(_first(roce_hist), 2)
    if _first(opm_hist) is not None:
        out["op_margin"] = round(_first(opm_hist), 2)
        sd = _std([x for x in opm_hist if x is not None])
        if sd is not None:
            out["margin_std"] = round(sd, 2)
        pair = [x for x in opm_hist[:2] if x is not None]
        if len(pair) == 2:
            out["op_margin_trend"] = round(pair[0] - pair[1], 2)

    d0 = dates[0] if dates else None
    if d0 is not None:
        n0, r0 = ni.get(d0), rev.get(d0)
        if n0 is not None and r0 and r0 > 0:
            out["npm"] = round(n0 / r0 * 100.0, 2)
        d_, e_ = debt.get(d0), eq.get(d0)
        if d_ is not None and e_ and e_ > 0:
            out["debt_equity"] = round(d_ / e_, 3)
        if n0 is not None and n0 > 0:
            cash = fcf.get(d0) if fcf.get(d0) is not None else cfo.get(d0)
            if cash is not None:
                out["fcf_conv"] = round(max(-1.0, min(2.0, cash / n0)), 3)
    if "debt_equity" not in out and _f(info.get("debtToEquity")) is not None:
        out["debt_equity"] = round(_f(info["debtToEquity"]) / 100.0, 3)

    rc, pc = _cagr(rev_l), _cagr(ni_l)
    if rc is not None:
        out["revenue_cagr"] = round(rc, 2)
    if pc is not None:
        out["profit_cagr"] = round(pc, 2)

    q_eps = _yoy(qinc, ("Diluted EPS", "Basic EPS")) or _yoy(qinc, ("Net Income",))
    if q_eps is not None:
        out["q_eps_yoy"] = round(q_eps, 2)
    q_rev = _yoy(qinc, ("Total Revenue", "Operating Revenue"))
    if q_rev is not None:
        out["q_rev_yoy"] = round(q_rev, 2)

    pe = _f(info.get("trailingPE"))
    pb = _f(info.get("priceToBook"))
    if pe is not None and pe > 0:
        out["pe"] = round(pe, 2)
        g = pc if pc is not None else rc
        if g is not None and g > 0:
            out["peg"] = round(pe / g, 3)
    if pb is not None and pb > 0:
        out["pb"] = round(pb, 2)
    mcap = _f(info.get("marketCap"))
    if mcap:
        out["mcap_cr"] = round(mcap / 1e7, 1)
    dy = _f(info.get("trailingAnnualDividendYield"))
    dy = dy * 100.0 if dy is not None else _f(info.get("dividendYield"))
    if dy is not None:
        out["div_yield"] = round(dy, 2)
    inst, ins = _f(info.get("heldPercentInstitutions")), _f(info.get("heldPercentInsiders"))
    if inst is not None:
        out["inst_pct"] = round(inst * 100.0, 2)
    if ins is not None:
        out["insider_pct"] = round(ins * 100.0, 2)
    return out


# ── fetchers ─────────────────────────────────────────────────────────────────────────────────────────────
def fetch_symbol(symbol: str, attempts: int = 3) -> Tuple[Dict[str, object], Dict[str, object]]:
    """
    Fetch one stock from Yahoo -> (factors, meta{name, sector, industry}). Raises if nothing usable came back.
    Yahoo throttles bursts (empty responses, not errors), so empty results are retried with backoff.
    """
    import random

    import yfinance as yf

    last_exc: Optional[Exception] = None
    for attempt in range(attempts):
        if attempt:
            time.sleep((2 ** attempt) + random.random())       # ~2-3s, then ~4-5s
        try:
            tk = yf.Ticker(f"{symbol}.NS")
            info = tk.info or {}
            factors = factors_from_statements(tk.income_stmt, tk.balance_sheet, tk.cashflow,
                                              tk.quarterly_income_stmt, info)
            if not factors:
                raise RuntimeError("no statement data")
            meta = {"name": info.get("longName") or info.get("shortName") or symbol,
                    "sector": info.get("sector"), "industry": info.get("industry")}
            return factors, meta
        except Exception as exc:
            last_exc = exc
    raise RuntimeError(str(last_exc))


def stale_symbols(symbols: List[str], ttl_days: float = FUNDAMENTALS_TTL_DAYS) -> List[str]:
    cutoff = utcnow() - dt.timedelta(days=ttl_days)
    retry_cutoff = utcnow() - dt.timedelta(hours=6)           # failures are retried sooner
    with session_scope() as s:
        have = {r.symbol: (r.fetched_at, r.ok) for r in s.query(Fundamental.symbol, Fundamental.fetched_at, Fundamental.ok)}
    out = []
    for sym in symbols:
        rec = have.get(sym)
        if rec is None or (rec[0] or dt.datetime.min) < (cutoff if rec[1] else retry_cutoff):
            out.append(sym)
    return out


def refresh_fundamentals(symbols: List[str], force: bool = False,
                         progress: Optional[Callable[[int, int], None]] = None) -> Dict[str, int]:
    todo = list(symbols) if force else stale_symbols(symbols)
    total = len(todo)
    batch_f: List[dict] = []
    batch_s: List[dict] = []
    counts = {"ok": 0}

    def flush():
        nonlocal batch_f, batch_s
        if not batch_f:
            return
        with session_scope() as s:
            bulk_upsert(s, Fundamental, batch_f, ["symbol"])
            for m in batch_s:
                st = s.get(Stock, m["symbol"])
                if st is not None:
                    st.name = m.get("name") or st.name
                    st.sector = m.get("sector") or st.sector
                    st.industry = m.get("industry") or st.industry
                    if m.get("mcap_cr"):
                        st.mcap_cr = m["mcap_cr"]
        batch_f, batch_s = [], []

    def run_pass(syms: List[str], workers: int, done_offset: int) -> List[str]:
        """Fetch `syms` concurrently; returns the symbols that failed."""
        failed_syms: List[str] = []
        done = done_offset
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futs = {pool.submit(fetch_symbol, sym): sym for sym in syms}
            for fut in as_completed(futs):
                sym = futs[fut]
                done += 1
                try:
                    factors, meta = fut.result()
                    with session_scope() as s:   # keep promoter data from a previous pass: Yahoo never provides it
                        old = s.get(Fundamental, sym)
                        for k in ("promoter_pct", "promoter_change_qoq", "promoter_at"):
                            if old is not None and k in (old.factors or {}) and k not in factors:
                                factors[k] = old.factors[k]
                    batch_f.append({"symbol": sym, "factors": factors, "fetched_at": utcnow(), "ok": True})
                    batch_s.append({"symbol": sym, "mcap_cr": factors.get("mcap_cr"), **meta})
                    counts["ok"] += 1
                except Exception as exc:
                    logger.info("[Baskets] fundamentals failed for %s: %s", sym, exc)
                    failed_syms.append(sym)
                if len(batch_f) >= 25:
                    flush()
                if progress:
                    progress(min(done, total), total)
        flush()
        return failed_syms

    failed = run_pass(todo, FUNDAMENTALS_WORKERS, 0)
    if failed:
        # Most first-pass failures are Yahoo throttling, not missing data: cool down, retry gently.
        logger.info("[Baskets] fundamentals: repair pass for %d symbols", len(failed))
        time.sleep(10)
        failed = run_pass(failed, max(1, FUNDAMENTALS_WORKERS // 2), total - len(failed))

    for sym in failed:                                   # genuinely unavailable (e.g. a very recent listing)
        with session_scope() as s:
            old = s.get(Fundamental, sym)
            if old is None:
                bulk_upsert(s, Fundamental, [{"symbol": sym, "factors": {}, "fetched_at": utcnow(), "ok": False}], ["symbol"])
            else:                                        # never overwrite good older data with a failure
                old.fetched_at = utcnow() - dt.timedelta(days=FUNDAMENTALS_TTL_DAYS) + dt.timedelta(hours=6)
    logger.info("[Baskets] fundamentals: %d ok, %d failed (of %d stale)", counts["ok"], len(failed), total)
    return {"ok": counts["ok"], "failed": len(failed), "attempted": total}


def refresh_promoter_holdings(symbols: List[str], max_age_days: float = 7.0,
                              progress: Optional[Callable[[int, int], None]] = None) -> Dict[str, int]:
    """Promoter holding (% and change vs previous quarter) from NSE's shareholding pattern. Best-effort."""
    from market.nse_client import nse_client

    cutoff = (utcnow() - dt.timedelta(days=max_age_days)).isoformat()
    with session_scope() as s:
        existing = {r.symbol: dict(r.factors or {}) for r in s.query(Fundamental).filter(Fundamental.symbol.in_(symbols))}
    todo = [sym for sym in symbols if sym in existing and (existing[sym].get("promoter_at") or "") < cutoff]
    got = 0
    for i, sym in enumerate(todo, 1):
        try:
            rows = nse_client.get_shareholding(sym) or []

            def _d(r):
                try:
                    return dt.datetime.strptime(str(r.get("date")).title(), "%d-%b-%Y")
                except ValueError:
                    return dt.datetime.min

            rows = sorted((r for r in rows if _f(r.get("pr_and_prgrp")) is not None), key=_d, reverse=True)
            if rows:
                f = existing[sym]
                f["promoter_pct"] = _f(rows[0]["pr_and_prgrp"])
                if len(rows) > 1:
                    f["promoter_change_qoq"] = round(f["promoter_pct"] - _f(rows[1]["pr_and_prgrp"]), 2)
                f["promoter_at"] = utcnow().isoformat()
                with session_scope() as s:
                    rec = s.get(Fundamental, sym)
                    if rec is not None:
                        rec.factors = f
                got += 1
        except Exception as exc:
            logger.debug("[Baskets] promoter holding failed for %s: %s", sym, exc)
        if progress and (i % 10 == 0 or i == len(todo)):
            progress(i, len(todo))
    return {"updated": got, "attempted": len(todo)}
