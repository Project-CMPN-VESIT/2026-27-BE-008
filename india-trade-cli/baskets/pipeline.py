"""
The refresh pipeline: universe -> prices -> fundamentals -> promoter holdings -> scores -> baskets.

Every stage is incremental and fault-isolated: a failing stage (say Yahoo is down) never wipes data, and later
stages still run on the last good data. A scheduler thread keeps everything fresh after market close, so the
baskets stay dynamic without anyone running anything by hand.
"""

from __future__ import annotations

import datetime as dt
import logging
import threading
import time
from typing import Callable, Dict, List, Optional

import pandas as pd

from baskets.config import (AUTO_REFRESH, BENCHMARK_SYMBOL, REFRESH_AFTER_HOUR_IST, REFRESH_MIN_AGE_HOURS,
                            SCHEDULER_TICK_SECONDS)
from baskets.db import (Fundamental, Holding, JobState, Price, Rebalance, Score, Stock, bulk_upsert, init_db,
                        session_scope, utcnow)
from baskets.definitions import BASKETS
from baskets.engine import Candidate, needs_rebalance, select
from baskets.factors import price_factors
from baskets.scoring import MODELS, score_all

logger = logging.getLogger(__name__)

STAGES = ["universe", "prices", "fundamentals", "holdings", "scores", "baskets"]
_run_lock = threading.Lock()
_scheduler_started = False


# ── status ───────────────────────────────────────────────────────────────────────────────────────────────
def _write_state(key: str, value: dict) -> None:
    with session_scope() as s:
        bulk_upsert(s, JobState, [{"key": key, "value": value, "updated_at": utcnow()}], ["key"])


def _read_state(key: str, default=None):
    with session_scope() as s:
        row = s.get(JobState, key)
        return row.value if row is not None else default


def _set_status(**kw) -> dict:
    st = _read_state("pipeline", {}) or {}
    st.update(kw)
    _write_state("pipeline", st)
    return st


def get_status() -> dict:
    init_db()
    st = _read_state("pipeline", {}) or {}
    with session_scope() as s:
        n_univ = s.query(Stock).filter(Stock.in_universe.is_(True)).count()
        n_fund = s.query(Fundamental).filter(Fundamental.ok.is_(True)).count()
        n_scored = s.query(Score.symbol).distinct().count()
        n_baskets = s.query(Rebalance.basket_id).distinct().count()
        last_px = s.query(Price.date).filter(Price.symbol == BENCHMARK_SYMBOL).order_by(Price.date.desc()).first()
    st.update({
        "universe_size": n_univ, "fundamentals_ok": n_fund, "scored_symbols": n_scored,
        "baskets_built": n_baskets, "baskets_total": len(BASKETS),
        "last_price_date": last_px[0].isoformat() if last_px else None,
        "ready": n_baskets > 0,
    })
    if st.get("state") == "running" and not _run_lock.locked():
        st["state"] = "interrupted"            # process died mid-run; the next run repairs it
    return st


# ── scoring ──────────────────────────────────────────────────────────────────────────────────────────────
def compute_scores() -> Dict[str, int]:
    """Score every universe stock under every legend model and store the results."""
    with session_scope() as s:
        stocks = {x.symbol: x for x in s.query(Stock).filter(Stock.in_universe.is_(True)).all()}
        fund = {f.symbol: f for f in s.query(Fundamental).all()}
        rows = s.query(Price.symbol, Price.date, Price.close, Price.volume).filter(
            Price.symbol.in_(list(stocks) + [BENCHMARK_SYMBOL])).all()
    if not rows:
        raise RuntimeError("no price data available for scoring")

    df = pd.DataFrame(rows, columns=["symbol", "date", "close", "volume"])
    df["date"] = pd.to_datetime(df["date"])
    by_sym = {sym: g.sort_values("date").set_index("date") for sym, g in df.groupby("symbol")}
    bench = by_sym.get(BENCHMARK_SYMBOL, pd.DataFrame()).get("close")

    now = utcnow()
    score_rows: List[dict] = []
    price_updates: Dict[str, dict] = {}
    liquidity: Dict[str, float] = {}
    for sym, st in stocks.items():
        g = by_sym.get(sym)
        pf = price_factors(g["close"], g["volume"], bench) if g is not None and len(g) else {}
        base = dict((fund[sym].factors or {})) if sym in fund else {}
        f = {**base, **pf}
        if st.mcap_cr:
            f["mcap_cr"] = st.mcap_cr
        f["is_financial"] = (st.sector == "Financial Services")
        if pf.get("avg_value_cr") is not None:
            liquidity[sym] = pf["avg_value_cr"]
        price_updates[sym] = {"pf": pf, "last": pf.get("last_close")}
        for mid, res in score_all(f).items():
            score_rows.append({"symbol": sym, "model": mid, "score": res.score, "coverage": res.coverage,
                               "tags_pos": res.tags_pos, "tags_neg": res.tags_neg, "as_of": now})

    with session_scope() as s:
        bulk_upsert(s, Score, score_rows, ["symbol", "model"])
        for sym, u in price_updates.items():
            if sym in fund:
                s.get(Fundamental, sym).price_factors = u["pf"]
            if u["last"] is not None:
                s.get(Stock, sym).last_price = u["last"]
    _write_state("liquidity", liquidity)
    logger.info("[Baskets] scored %d stocks x %d models", len(stocks), len(MODELS))
    return {"stocks": len(stocks), "rows": len(score_rows)}


# ── baskets ──────────────────────────────────────────────────────────────────────────────────────────────
def _latest_price_date() -> Optional[dt.date]:
    with session_scope() as s:
        r = s.query(Price.date).filter(Price.symbol == BENCHMARK_SYMBOL).order_by(Price.date.desc()).first()
    return r[0] if r else None


def update_baskets(force: bool = False) -> Dict[str, str]:
    """Create or rebalance each basket when due. Returns {basket_id: 'created'|'rebalanced'|'kept'|'unavailable'}."""
    today = _latest_price_date()
    if today is None:
        raise RuntimeError("no price data: cannot build baskets")
    liquidity = _read_state("liquidity", {}) or {}
    result: Dict[str, str] = {}

    with session_scope() as s:
        stocks = {x.symbol: x for x in s.query(Stock).filter(Stock.in_universe.is_(True)).all()}
        last_close = {sym: x.last_price for sym, x in stocks.items()}

    for d in BASKETS.values():
        with session_scope() as s:
            last = s.query(Rebalance).filter(Rebalance.basket_id == d.id).order_by(Rebalance.as_of.desc()).first()
            last_as_of = last.as_of if last else None
            incumbents = set()
            if last:
                incumbents = {h.symbol for h in s.query(Holding).filter(Holding.rebalance_id == last.id)}
            if last and not force and not needs_rebalance(last_as_of, today, d):
                result[d.id] = "kept"
                continue
            scores = s.query(Score).filter(Score.model == d.model).all()
            bars = {f.symbol: (f.price_factors or {}).get("bars") for f in s.query(Fundamental.symbol, Fundamental.price_factors)}
            cands = [Candidate(sc.symbol, stocks[sc.symbol].cap_class, stocks[sc.symbol].sector, sc.score or 0.0,
                               sc.coverage or 0.0, liquidity.get(sc.symbol),
                               is_financial=stocks[sc.symbol].sector == "Financial Services",
                               bars=bars.get(sc.symbol))
                     for sc in scores if sc.symbol in stocks]
            picks = select(cands, d, incumbents)
            if not picks:
                result[d.id] = "unavailable" if not last else "kept"
                logger.warning("[Baskets] %s: not enough eligible stocks", d.id)
                continue
            existing = s.query(Rebalance).filter(Rebalance.basket_id == d.id, Rebalance.as_of == today).first()
            if existing:
                s.query(Holding).filter(Holding.rebalance_id == existing.id).delete()
                reb = existing
            else:
                reb = Rebalance(basket_id=d.id, as_of=today)
                s.add(reb)
                s.flush()
            for p in picks:
                s.add(Holding(rebalance_id=reb.id, symbol=p.symbol, weight=p.weight, score=p.score,
                              entry_price=last_close.get(p.symbol)))
            result[d.id] = "created" if last is None else "rebalanced"
    logger.info("[Baskets] baskets: %s", result)
    return result


# ── orchestration ────────────────────────────────────────────────────────────────────────────────────────
def run_pipeline(stages: Optional[List[str]] = None, force: bool = False) -> dict:
    """Run the refresh (all stages by default). Safe to call concurrently: a second call returns immediately."""
    if not _run_lock.acquire(blocking=False):
        return {"state": "already_running"}
    init_db()
    stages = stages or STAGES
    started = utcnow()
    results: Dict[str, dict] = {}
    _set_status(state="running", stage=stages[0], progress={"done": 0, "total": 0},
                started_at=started.isoformat(), message="Starting refresh")

    def progress(stage: str):
        def cb(done: int, total: int):
            _set_status(stage=stage, progress={"done": done, "total": total})
        return cb

    def stage_run(name: str, fn: Callable[[], dict]):
        if name not in stages:
            return
        _set_status(stage=name, progress={"done": 0, "total": 0}, message=f"Running {name}")
        t0 = time.time()
        try:
            out = fn() or {}
            results[name] = {"ok": True, "seconds": round(time.time() - t0, 1), **out}
        except Exception as exc:                           # isolate: later stages can use the last good data
            logger.exception("[Baskets] stage %s failed", name)
            results[name] = {"ok": False, "seconds": round(time.time() - t0, 1), "error": str(exc)[:300]}

    try:
        from baskets import fundamentals, prices, universe

        stage_run("universe", lambda: {"stocks": universe.refresh_universe()})
        syms = universe.universe_symbols()
        stage_run("prices", lambda: prices.refresh_prices(syms, progress("prices")))
        stage_run("fundamentals", lambda: fundamentals.refresh_fundamentals(syms, force=force, progress=progress("fundamentals")))
        stage_run("holdings", lambda: fundamentals.refresh_promoter_holdings(syms, progress=progress("holdings")))
        stage_run("scores", compute_scores)
        stage_run("baskets", lambda: {"baskets": update_baskets(force=force)})

        core_ok = all(results.get(k, {}).get("ok", True) for k in ("scores", "baskets") if k in stages)
        _set_status(state="idle" if core_ok else "error", stage=None, finished_at=utcnow().isoformat(),
                    results=results, message="Done" if core_ok else "Finished with errors",
                    **({"last_success_at": utcnow().isoformat()} if core_ok else {}))
    except Exception as exc:
        logger.exception("[Baskets] pipeline crashed")
        _set_status(state="error", stage=None, finished_at=utcnow().isoformat(), message=str(exc)[:300], results=results)
    finally:
        _run_lock.release()
    return get_status()


def start_background_refresh(stages: Optional[List[str]] = None, force: bool = False) -> bool:
    """Kick off a refresh without blocking the caller. False if one is already running."""
    if _run_lock.locked():
        return False
    threading.Thread(target=run_pipeline, args=(stages, force), daemon=True, name="baskets-refresh").start()
    return True


# ── scheduler ────────────────────────────────────────────────────────────────────────────────────────────
def _now_ist() -> dt.datetime:
    return utcnow() + dt.timedelta(hours=5, minutes=30)


def should_run(status: Optional[dict] = None) -> bool:
    if not AUTO_REFRESH:
        return False
    st = status or get_status()
    if st.get("state") == "running":
        return False
    finished = st.get("finished_at")
    recently_failed = st.get("state") == "error" and finished and \
        (utcnow() - dt.datetime.fromisoformat(finished)) < dt.timedelta(hours=1)
    if recently_failed:
        return False
    if not st.get("ready"):                                    # nothing built yet: bootstrap right away
        return True
    last = st.get("last_success_at")
    if not last:
        return True
    age_h = (utcnow() - dt.datetime.fromisoformat(last)).total_seconds() / 3600.0
    return age_h >= 48 or (age_h >= REFRESH_MIN_AGE_HOURS and _now_ist().hour >= REFRESH_AFTER_HOUR_IST)


def _scheduler_loop() -> None:
    time.sleep(5)                                              # let the API finish starting
    while True:
        try:
            if should_run():
                logger.info("[Baskets] scheduler: starting refresh")
                run_pipeline()
        except Exception:
            logger.exception("[Baskets] scheduler tick failed")
        time.sleep(SCHEDULER_TICK_SECONDS)


def start_scheduler() -> None:
    global _scheduler_started
    if _scheduler_started or not AUTO_REFRESH:
        return
    _scheduler_started = True
    init_db()
    threading.Thread(target=_scheduler_loop, daemon=True, name="baskets-scheduler").start()
    logger.info("[Baskets] scheduler started (tick %ss)", SCHEDULER_TICK_SECONDS)
