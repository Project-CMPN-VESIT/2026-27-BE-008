"""
FastAPI router for AI Baskets.

    GET  /baskets                        list of baskets (cards) + filter metadata + data status
    GET  /baskets/{id}?range=ALL         one basket: holdings, performance series vs NIFTY 50 / FD, dates
    GET  /baskets/stocks/ranking         stocks ranked by an investor-style score (feature 7)
    GET  /baskets/stocks/{symbol}/scores all five investor scores for one stock (feature 7)
    GET  /baskets/pipeline/status        refresh progress / data freshness
    POST /baskets/pipeline/refresh       trigger a refresh (localhost only)
"""

from __future__ import annotations

import datetime as dt
import math
import threading
import time
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd
from fastapi import APIRouter, HTTPException, Query, Request

from baskets import pipeline
from baskets.config import BENCHMARK_SYMBOL, CAP_INDICES, DISCLAIMER, FD_RATE
from baskets.db import Fundamental, Holding, Rebalance, Score, Stock, init_db, session_scope
from baskets.definitions import BASKETS, BasketDef
from baskets.performance import build_series, headline_return, pct_return, slice_range, to_points
from baskets.prices import load_close_frame
from baskets.scoring import MODELS

router = APIRouter(prefix="/baskets", tags=["Baskets"])

_perf_cache: Dict[Tuple, Tuple[float, pd.DataFrame]] = {}
_perf_lock = threading.Lock()
_PERF_TTL = 300.0
RANGES = ["7D", "1M", "3M", "6M", "1Y", "ALL"]


def _clean(o: Any) -> Any:
    """Make a structure JSON-safe (NaN/Inf -> None)."""
    if isinstance(o, float):
        return None if (math.isnan(o) or math.isinf(o)) else o
    if isinstance(o, dict):
        return {k: _clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_clean(v) for v in o]
    return o


def _rebalances(session, basket_id: str) -> List[Tuple[dt.date, Dict[str, float], int]]:
    out = []
    for r in session.query(Rebalance).filter(Rebalance.basket_id == basket_id).order_by(Rebalance.as_of).all():
        w = {h.symbol: h.weight for h in session.query(Holding).filter(Holding.rebalance_id == r.id)}
        out.append((r.as_of, w, r.id))
    return out


def _performance(basket_id: str, rebs: List[Tuple[dt.date, Dict[str, float], int]]) -> pd.DataFrame:
    """Chart series for a basket, cached per (basket, latest rebalance, latest price date)."""
    last_px = pipeline._latest_price_date()
    key = (basket_id, rebs[-1][2], last_px)
    now = time.time()
    with _perf_lock:
        hit = _perf_cache.get(key)
        if hit and now - hit[0] < _PERF_TTL:
            return hit[1]
    symbols = sorted({s for _, w, _ in rebs for s in w})
    closes = load_close_frame(symbols + [BENCHMARK_SYMBOL])
    bench = closes[BENCHMARK_SYMBOL] if BENCHMARK_SYMBOL in closes.columns else pd.Series(dtype=float)
    stock_closes = closes[[c for c in closes.columns if c != BENCHMARK_SYMBOL]]
    df = build_series([(a, w) for a, w, _ in rebs], stock_closes, bench, FD_RATE)
    with _perf_lock:
        _perf_cache[key] = (now, df)
        if len(_perf_cache) > 64:
            _perf_cache.pop(next(iter(_perf_cache)))
    return df


def _card(d: BasketDef, session) -> dict:
    rebs = _rebalances(session, d.id)
    card = {
        "id": d.id, "name": d.name, "description": d.description,
        "model": d.model, "model_label": d.model_label, "investor": MODELS[d.model].investor,
        "caps": list(d.caps), "cap_label": d.cap_label,
        "target_holdings": d.n, "built": bool(rebs),
        "return_pct": None, "return_basis": "none", "spark": [],
        "holdings_count": 0, "top_holdings": [], "created_on": None, "last_rebalance": None, "next_rebalance": None,
    }
    if not rebs:
        return card
    df = _performance(d.id, rebs)
    ret, basis = headline_return(df)
    last_as_of, last_w, _ = rebs[-1]
    names = {s.symbol: s.name for s in session.query(Stock).filter(Stock.symbol.in_(list(last_w))).all()}
    top = sorted(last_w.items(), key=lambda kv: kv[1], reverse=True)[:4]
    card.update({
        "return_pct": None if ret is None else round(ret, 2), "return_basis": basis,
        "spark": [] if df.empty else [round(float(v), 2) for v in df["basket"].iloc[-90:].iloc[::3]],
        "holdings_count": len(last_w),
        "top_holdings": [{"symbol": s, "name": names.get(s) or s, "weight_pct": round(w * 100, 1)} for s, w in top],
        "created_on": rebs[0][0].isoformat(), "last_rebalance": last_as_of.isoformat(),
        "next_rebalance": (last_as_of + dt.timedelta(days=d.rebalance_days)).isoformat(),
    })
    return card


@router.get("")
def list_baskets(cap: Optional[str] = Query(None, pattern="^(large|mid|small)$"),
                 model: Optional[str] = None, sort: str = Query("default", pattern="^(default|return|name)$")):
    init_db()
    with session_scope() as s:
        cards = [_card(d, s) for d in BASKETS.values()
                 if (not cap or cap in d.caps) and (not model or d.model == model)]
    if sort == "return":
        cards.sort(key=lambda c: (c["return_pct"] is None, -(c["return_pct"] or 0)))
    elif sort == "name":
        cards.sort(key=lambda c: c["name"])
    return _clean({
        "baskets": cards, "disclaimer": DISCLAIMER, "pipeline": pipeline.get_status(),
        "filters": {
            "caps": [{"id": k, "label": f"{k.title()} Cap", "index": v} for k, v in CAP_INDICES.items()],
            "models": [{"id": m.id, "label": m.label, "investor": m.investor} for m in MODELS.values()],
        },
    })


@router.get("/pipeline/status")
def pipeline_status():
    return _clean(pipeline.get_status())


@router.post("/pipeline/refresh")
def pipeline_refresh(request: Request, force: bool = False, stages: Optional[str] = None):
    host = request.client.host if request.client else ""
    if host not in ("127.0.0.1", "::1", "localhost", "testclient"):
        raise HTTPException(status_code=403, detail="Refresh can only be triggered from localhost.")
    chosen = [x.strip() for x in stages.split(",")] if stages else None
    if chosen and any(x not in pipeline.STAGES for x in chosen):
        raise HTTPException(status_code=400, detail=f"stages must be among {pipeline.STAGES}")
    started = pipeline.start_background_refresh(chosen, force)
    return {"started": started, "message": "Refresh started" if started else "A refresh is already running"}


@router.get("/stocks/ranking")
def stock_ranking(model: str, cap: Optional[str] = Query(None, pattern="^(large|mid|small)$"),
                  limit: int = Query(25, ge=1, le=200), min_coverage: float = Query(0.7, ge=0, le=1)):
    """'Invest like ...' ranking: universe stocks ordered by one investor-style score."""
    if model not in MODELS:
        raise HTTPException(status_code=404, detail=f"unknown model; choose from {list(MODELS)}")
    with session_scope() as s:
        q = s.query(Score, Stock).join(Stock, Stock.symbol == Score.symbol).filter(
            Score.model == model, Score.coverage >= min_coverage, Stock.in_universe.is_(True))
        if cap:
            q = q.filter(Stock.cap_class == cap)
        rows = q.order_by(Score.score.desc(), Score.symbol).limit(limit).all()
        out = [{"rank": i + 1, "symbol": st.symbol, "name": st.name, "sector": st.sector, "cap_class": st.cap_class,
                "price": st.last_price, "score": sc.score, "coverage": sc.coverage,
                "tags_pos": sc.tags_pos or [], "tags_neg": sc.tags_neg or []} for i, (sc, st) in enumerate(rows)]
    return _clean({"model": model, "label": MODELS[model].label, "cap": cap, "results": out, "disclaimer": DISCLAIMER})


@router.get("/stocks/{symbol}/scores")
def stock_scores(symbol: str):
    """All five investor-style scores (with reasons) for one stock."""
    sym = symbol.strip().upper()
    with session_scope() as s:
        st = s.get(Stock, sym)
        if st is None:
            raise HTTPException(status_code=404, detail=f"{sym} is not in the Nifty 500 universe")
        rows = {r.model: r for r in s.query(Score).filter(Score.symbol == sym).all()}
        fund = s.get(Fundamental, sym)
        in_baskets = []
        for d in BASKETS.values():
            last = s.query(Rebalance).filter(Rebalance.basket_id == d.id).order_by(Rebalance.as_of.desc()).first()
            if last and s.query(Holding).filter(Holding.rebalance_id == last.id, Holding.symbol == sym).first():
                in_baskets.append({"id": d.id, "name": d.name})
        scores = [{"model": m.id, "label": m.label, "investor": m.investor,
                   "score": rows[m.id].score if m.id in rows else None,
                   "coverage": rows[m.id].coverage if m.id in rows else None,
                   "tags_pos": (rows[m.id].tags_pos if m.id in rows else []) or [],
                   "tags_neg": (rows[m.id].tags_neg if m.id in rows else []) or []} for m in MODELS.values()]
        payload = {"symbol": sym, "name": st.name, "sector": st.sector, "cap_class": st.cap_class,
                   "price": st.last_price, "mcap_cr": st.mcap_cr, "scores": scores, "in_baskets": in_baskets,
                   "factors": {**((fund.factors if fund else {}) or {}), **((fund.price_factors if fund else {}) or {})},
                   "disclaimer": DISCLAIMER}
    return _clean(payload)


@router.get("/{basket_id}")
def basket_detail(basket_id: str, range: str = Query("ALL", pattern="^(7D|1M|3M|6M|1Y|ALL)$"),
                  notional: float = Query(100000.0, gt=0)):
    d = BASKETS.get(basket_id)
    if d is None:
        raise HTTPException(status_code=404, detail="unknown basket")
    init_db()
    with session_scope() as s:
        rebs = _rebalances(s, d.id)
        card = _card(d, s)
        if not rebs:
            return _clean({**card, "holdings": [], "series": [], "disclaimer": DISCLAIMER,
                           "pipeline": pipeline.get_status()})
        last_as_of, weights, rid = rebs[-1]
        stocks = {x.symbol: x for x in s.query(Stock).filter(Stock.symbol.in_(list(weights))).all()}
        scores = {r.symbol: r for r in s.query(Score).filter(Score.model == d.model, Score.symbol.in_(list(weights))).all()}
        entries = {h.symbol: h.entry_price for h in s.query(Holding).filter(Holding.rebalance_id == rid)}
        holdings = []
        for sym, w in sorted(weights.items(), key=lambda kv: kv[1], reverse=True):
            st, sc = stocks.get(sym), scores.get(sym)
            price, entry = (st.last_price if st else None), entries.get(sym)
            holdings.append({
                "symbol": sym, "name": (st.name if st else None) or sym, "sector": st.sector if st else None,
                "cap_class": st.cap_class if st else None, "weight_pct": round(w * 100, 2),
                "score": sc.score if sc else None, "price": price, "entry_price": entry,
                "return_since_entry_pct": round((price / entry - 1) * 100, 2) if price and entry else None,
                "tags_pos": (sc.tags_pos if sc else []) or [], "tags_neg": (sc.tags_neg if sc else []) or [],
            })
    df = _performance(d.id, rebs)
    window = slice_range(df, range)
    perf = {
        "basket_pct": pct_return(window["basket"]) if not window.empty else None,
        "nifty_pct": pct_return(window["nifty"]) if not window.empty else None,
        "fd_pct": pct_return(window["fd"]) if not window.empty else None,
    }
    live_days = int((df[df["live"]].index[-1] - df[df["live"]].index[0]).days) if (not df.empty and df["live"].sum() > 1) else 0
    return _clean({
        **card, "range": range, "ranges": RANGES, "notional": notional, "performance": perf,
        "series": to_points(window, notional), "holdings": holdings, "live_days": live_days,
        "benchmark": "NIFTY 50", "fd_rate_pct": FD_RATE * 100,
        "simulated_until": rebs[0][0].isoformat(),
        "methodology": (f"Top {d.n} stocks by {d.model_label} score within {d.cap_label}, score-weighted "
                        f"(max {int(d.max_weight * 100)}% per stock, max {d.max_per_sector} per sector, max {d.financials_cap} "
                        f"banks/NBFCs, at least ~6 months of trading history), rebalanced "
                        f"every {d.rebalance_days} days. History before {rebs[0][0].isoformat()} is a simulation using "
                        "today's holdings; history after it is tracked live."),
        "disclaimer": DISCLAIMER,
    })
