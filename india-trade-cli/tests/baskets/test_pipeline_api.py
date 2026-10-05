"""Integration spec: DB -> basket creation / rebalancing -> API (synthetic data, no network)."""

import datetime as dt

import numpy as np
import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from baskets import pipeline
from baskets.api import router
from baskets.config import BENCHMARK_SYMBOL
from baskets.db import (Base, Fundamental, Holding, JobState, Price, Rebalance, Score, Stock, bulk_upsert, engine,
                        init_db, session_scope, utcnow)
from baskets.definitions import BASKETS
from baskets.scoring import MODELS

N_DAYS = 300


@pytest.fixture()
def seeded():
    """40 stocks (10 large / 15 mid / 15 small) with scores, liquidity and 300 days of prices."""
    Base.metadata.drop_all(engine)
    init_db()
    rng = np.random.default_rng(7)
    idx = pd.bdate_range(end="2026-10-02", periods=N_DAYS)
    sectors = ["IT", "Banks", "Pharma", "Auto", "Energy", "FMCG", "Metals", "Realty"]
    plan = [("large", 10), ("mid", 15), ("small", 15)]
    stocks, prices, scores, liq = [], [], [], {}
    i = 0
    for cap, n in plan:
        for k in range(n):
            sym = f"{cap[:1].upper()}{k:02d}"
            sector = sectors[(i + k) % len(sectors)]
            stocks.append({"symbol": sym, "name": f"{sym} Ltd", "sector": sector, "cap_class": cap,
                           "mcap_cr": 1000.0 + i * 100, "last_price": 100.0, "in_universe": True, "updated_at": utcnow()})
            walk = 100 * np.cumprod(1 + rng.normal(0.0006, 0.012, N_DAYS))
            prices += [{"symbol": sym, "date": d.date(), "close": float(c), "volume": 1e6} for d, c in zip(idx, walk)]
            for mid in MODELS:
                base = 50 + ((i * 7 + hash(mid) % 13) % 45)
                scores.append({"symbol": sym, "model": mid, "score": float(base), "coverage": 0.95,
                               "tags_pos": ["Strong"], "tags_neg": [], "as_of": utcnow()})
            liq[sym] = 100.0
            i += 1
    bench = 1000 * np.cumprod(1 + rng.normal(0.0004, 0.008, N_DAYS))
    prices += [{"symbol": BENCHMARK_SYMBOL, "date": d.date(), "close": float(c), "volume": 0.0} for d, c in zip(idx, bench)]
    with session_scope() as s:
        bulk_upsert(s, Stock, stocks, ["symbol"])
        bulk_upsert(s, Price, prices, ["symbol", "date"])
        bulk_upsert(s, Score, scores, ["symbol", "model"])
        bulk_upsert(s, JobState, [{"key": "liquidity", "value": liq, "updated_at": utcnow()}], ["key"])
    # last_price used for entry prices
    with session_scope() as s:
        for st in s.query(Stock).all():
            st.last_price = s.query(Price.close).filter(Price.symbol == st.symbol).order_by(Price.date.desc()).first()[0]
    yield
    Base.metadata.drop_all(engine)


@pytest.fixture()
def client(seeded):
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


# ── basket creation / rebalancing ──────────────────────────────────────────────────────────────────────────
def test_update_baskets_builds_every_basket_with_enough_stocks(seeded):
    out = pipeline.update_baskets()
    assert set(out) == set(BASKETS)
    built = [b for b, v in out.items() if v == "created"]
    assert len(built) >= 4
    with session_scope() as s:                                  # only 10 large caps exist: hold all 10, not 12
        reb = s.query(Rebalance).filter(Rebalance.basket_id == "buffett-large").one()
        assert s.query(Holding).filter(Holding.rebalance_id == reb.id).count() <= 10
    with session_scope() as s:
        for bid in built:
            reb = s.query(Rebalance).filter(Rebalance.basket_id == bid).one()
            hs = s.query(Holding).filter(Holding.rebalance_id == reb.id).all()
            assert 5 <= len(hs) <= BASKETS[bid].n
            assert sum(h.weight for h in hs) == pytest.approx(1.0)
            # cap holds whenever it is feasible; with fewer than 1/cap holdings the engine falls back to equal weights
            assert max(h.weight for h in hs) <= max(BASKETS[bid].max_weight, 1.0 / len(hs)) + 1e-9
            caps = {s.get(Stock, h.symbol).cap_class for h in hs}
            assert caps <= set(BASKETS[bid].caps)                   # cap segment respected
            assert all(h.entry_price for h in hs)


def test_basket_is_unavailable_when_too_few_stocks_qualify(seeded):
    with session_scope() as s:
        s.query(Score).filter(Score.symbol.like("S%")).delete(synchronize_session=False)   # wipe small-cap scores
    out = pipeline.update_baskets()
    assert out["mayer-small"] == "unavailable"                  # small-only basket has nothing to select from
    with session_scope() as s:
        assert s.query(Rebalance).filter(Rebalance.basket_id == "mayer-small").count() == 0


def test_second_run_keeps_baskets_until_rebalance_is_due_and_force_recreates(seeded):
    pipeline.update_baskets()
    assert set(pipeline.update_baskets().values()) <= {"kept", "unavailable"}
    forced = pipeline.update_baskets(force=True)
    assert "rebalanced" in forced.values()                        # force re-selects even though nothing is due
    with session_scope() as s:
        per = s.query(Rebalance.basket_id, Rebalance.as_of).all()
        assert len(per) == len(set(per))                            # unique (basket, date)


def test_rebalance_happens_after_the_interval(seeded):
    pipeline.update_baskets()
    with session_scope() as s:
        for r in s.query(Rebalance).all():
            r.as_of = r.as_of - dt.timedelta(days=45)             # pretend the basket is 45 days old
    out = pipeline.update_baskets()
    assert "rebalanced" in out.values()
    with session_scope() as s:
        assert s.query(Rebalance).filter(Rebalance.basket_id == "canslim-small-mid").count() == 2


def test_no_price_data_is_an_error_not_a_silent_empty_basket():
    Base.metadata.drop_all(engine)
    init_db()
    with pytest.raises(RuntimeError):
        pipeline.update_baskets()


# ── API ────────────────────────────────────────────────────────────────────────────────────────────────────
def test_list_endpoint_cards_and_filters(client):
    pipeline.update_baskets()
    r = client.get("/baskets")
    assert r.status_code == 200
    body = r.json()
    assert len(body["baskets"]) == len(BASKETS) and body["disclaimer"]
    assert {c["id"] for c in body["filters"]["caps"]} == {"large", "mid", "small"}
    built = [b for b in body["baskets"] if b["built"]]
    assert built and all(b["return_basis"] in ("live", "simulated_1y") and b["return_pct"] is not None for b in built)
    small = client.get("/baskets", params={"cap": "small"}).json()["baskets"]
    assert small and all("small" in b["caps"] for b in small)
    only_model = client.get("/baskets", params={"model": "canslim"}).json()["baskets"]
    assert only_model and all(b["model"] == "canslim" for b in only_model)
    assert client.get("/baskets", params={"cap": "huge"}).status_code == 422


def test_detail_endpoint(client):
    pipeline.update_baskets()
    r = client.get("/baskets/canslim-small-mid", params={"range": "ALL"})
    assert r.status_code == 200
    d = r.json()
    assert sum(h["weight_pct"] for h in d["holdings"]) == pytest.approx(100.0, abs=0.1)
    assert d["holdings"] == sorted(d["holdings"], key=lambda h: -h["weight_pct"])
    pts = d["series"]
    assert len(pts) > 50 and pts[0]["basket"] == pytest.approx(100000.0)
    assert pts[0]["date"] < pts[-1]["date"]
    assert any(p["live"] for p in pts) and any(not p["live"] for p in pts)       # simulated + live both present
    assert set(d["performance"]) == {"basket_pct", "nifty_pct", "fd_pct"}
    assert "simulation" in d["methodology"] and d["created_on"] and d["next_rebalance"]
    short = client.get("/baskets/canslim-small-mid", params={"range": "1M"}).json()["series"]
    assert 15 <= len(short) <= 25 and short[0]["basket"] == pytest.approx(100000.0)   # rebased per range


def test_detail_unknown_basket_and_bad_range(client):
    assert client.get("/baskets/nope").status_code == 404
    assert client.get("/baskets/canslim-small-mid", params={"range": "9Y"}).status_code == 422


def test_detail_of_an_unbuilt_basket_is_a_clean_empty_state(client):
    r = client.get("/baskets/mayer-small")
    assert r.status_code == 200 and r.json()["built"] is False and r.json()["holdings"] == []


def test_stock_scores_endpoint(client):
    pipeline.update_baskets()
    r = client.get("/baskets/stocks/s00/scores")                # case-insensitive
    assert r.status_code == 200
    body = r.json()
    assert {s["model"] for s in body["scores"]} == set(MODELS)
    assert all(s["score"] is not None for s in body["scores"])
    assert client.get("/baskets/stocks/NOPE/scores").status_code == 404


def test_ranking_endpoint_orders_by_score_and_filters_cap(client):
    r = client.get("/baskets/stocks/ranking", params={"model": "buffett", "cap": "mid", "limit": 5})
    assert r.status_code == 200
    res = r.json()["results"]
    assert len(res) == 5 and [x["rank"] for x in res] == [1, 2, 3, 4, 5]
    assert [x["score"] for x in res] == sorted((x["score"] for x in res), reverse=True)
    assert all(x["cap_class"] == "mid" for x in res)
    assert client.get("/baskets/stocks/ranking", params={"model": "nope"}).status_code == 404


def test_refresh_is_localhost_only(seeded):
    app = FastAPI()
    app.include_router(router)
    remote = TestClient(app, client=("203.0.113.9", 50000))
    assert remote.post("/baskets/pipeline/refresh").status_code == 403
    assert remote.post("/baskets/pipeline/refresh", params={"stages": "bogus"}).status_code in (400, 403)


def test_status_reports_readiness(client):
    s0 = client.get("/baskets/pipeline/status").json()
    assert s0["ready"] is False and s0["universe_size"] == 40
    pipeline.update_baskets()
    s1 = client.get("/baskets/pipeline/status").json()
    assert s1["ready"] is True and s1["baskets_built"] >= 4 and s1["last_price_date"]


def test_scheduler_decides_when_to_run(seeded, monkeypatch):
    monkeypatch.setattr(pipeline, "AUTO_REFRESH", True)
    assert pipeline.should_run({"state": "idle", "ready": False}) is True            # nothing built: bootstrap
    assert pipeline.should_run({"state": "running", "ready": False}) is False
    fresh = (utcnow() - dt.timedelta(hours=2)).isoformat()
    assert pipeline.should_run({"state": "idle", "ready": True, "last_success_at": fresh}) is False
    old = (utcnow() - dt.timedelta(hours=60)).isoformat()
    assert pipeline.should_run({"state": "idle", "ready": True, "last_success_at": old}) is True
    failed = {"state": "error", "ready": False, "finished_at": (utcnow() - dt.timedelta(minutes=10)).isoformat()}
    assert pipeline.should_run(failed) is False                                       # back off after a recent failure
