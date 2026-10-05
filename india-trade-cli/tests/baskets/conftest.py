"""
Point the baskets engine at a throwaway SQLite file BEFORE any baskets module is imported
(baskets.db reads its URL at import time), so tests never touch real data.
"""

import os
import tempfile

_tmp = tempfile.mkdtemp(prefix="baskets_test_")
os.environ["BASKETS_DATA_DIR"] = _tmp
os.environ["BASKETS_DATABASE_URL"] = "sqlite:///" + os.path.join(_tmp, "test.db").replace("\\", "/")
os.environ["BASKETS_AUTO_REFRESH"] = "0"


import numpy as np                      # noqa: E402  (after env is set)
import pandas as pd                     # noqa: E402
import pytest                           # noqa: E402

from baskets.config import BENCHMARK_SYMBOL                                                    # noqa: E402
from baskets.db import (Base, Fundamental, JobState, Price, Score, Stock, bulk_upsert, engine,  # noqa: E402
                        init_db, session_scope, utcnow)
from baskets.scoring import MODELS                                                              # noqa: E402

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
    stocks, prices, scores, liq, funds = [], [], [], {}, []
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
            funds.append({"symbol": sym, "ok": True, "fetched_at": utcnow(), "factors": {
                "roe": 14.0 + (i % 12), "roce": 18.0 + (i % 9), "roe_years_ok": 0.8, "debt_equity": 0.1 * (i % 7),
                "op_margin": 15.0 + (i % 8), "margin_std": 2.0, "fcf_conv": 0.8, "revenue_cagr": 12.0 + (i % 10),
                "profit_cagr": 14.0 + (i % 11), "pe": 20.0 + (i % 15), "pb": 3.0, "peg": 1.1, "q_eps_yoy": 20.0,
                "inst_pct": 25.0, "insider_pct": 50.0, "promoter_pct": 52.0, "div_yield": 0.8}, "price_factors": {
                "ret_6m": 12.0, "ret_3m": 6.0, "above_200dma": True, "dist_high_pct": 4.0, "rel_strength_12m": 15.0,
                "vol_surge": 1.1}})
            i += 1
    bench = 1000 * np.cumprod(1 + rng.normal(0.0004, 0.008, N_DAYS))
    prices += [{"symbol": BENCHMARK_SYMBOL, "date": d.date(), "close": float(c), "volume": 0.0} for d, c in zip(idx, bench)]
    with session_scope() as s:
        bulk_upsert(s, Stock, stocks, ["symbol"])
        bulk_upsert(s, Price, prices, ["symbol", "date"])
        bulk_upsert(s, Score, scores, ["symbol", "model"])
        bulk_upsert(s, Fundamental, funds, ["symbol"])
        bulk_upsert(s, JobState, [{"key": "liquidity", "value": liq, "updated_at": utcnow()}], ["key"])
    # last_price used for entry prices
    with session_scope() as s:
        for st in s.query(Stock).all():
            st.last_price = s.query(Price.close).filter(Price.symbol == st.symbol).order_by(Price.date.desc()).first()[0]
    yield
    Base.metadata.drop_all(engine)


