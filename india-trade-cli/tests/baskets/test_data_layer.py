"""Spec for factor extraction (offline: synthetic statements and price series)."""

import numpy as np
import pandas as pd
import pytest

from baskets.factors import price_factors
from baskets.fundamentals import _cagr, factors_from_statements


def _stmt(rows: dict, dates) -> pd.DataFrame:
    return pd.DataFrame({d: {k: v[i] for k, v in rows.items()} for i, d in enumerate(dates)})


ANNUAL = [pd.Timestamp(f"{y}-03-31") for y in (2026, 2025, 2024, 2023, 2022)]       # newest first, like Yahoo
QTRS = [pd.Timestamp(x) for x in ("2026-06-30", "2026-03-31", "2025-12-31", "2025-09-30", "2025-06-30")]


def make_statements():
    inc = _stmt({
        "Total Revenue": [1000, 880, 770, 680, 600],
        "Net Income": [200, 160, 125, 100, 80],
        "EBIT": [260, 220, 180, 150, 125],
    }, ANNUAL)
    bs = _stmt({
        "Stockholders Equity": [800, 640, 520, 420, 340],
        "Total Debt": [80, 90, 100, 110, 120],
        "Total Assets": [1200, 1000, 850, 720, 620],
        "Current Liabilities": [200, 180, 150, 130, 110],
    }, ANNUAL)
    cf = _stmt({"Operating Cash Flow": [230, 180, 140, 110, 90], "Free Cash Flow": [170, 130, 100, 80, 60]}, ANNUAL)
    q = _stmt({"Diluted EPS": [6.0, 5.0, 4.6, 4.2, 4.0], "Total Revenue": [280, 260, 250, 240, 230]}, QTRS)
    return inc, bs, cf, q


def test_return_ratios_and_debt():
    f = factors_from_statements(*make_statements(), info={})
    assert f["roe"] == pytest.approx(25.0)                          # 200 / 800
    assert f["roce"] == pytest.approx(260 / 1000 * 100)             # EBIT / (assets - current liabilities)
    assert f["debt_equity"] == pytest.approx(0.1)
    assert f["roe_years_ok"] == pytest.approx(1.0)                  # every year ROE >= 15%
    assert f["op_margin"] == pytest.approx(26.0)
    assert f["npm"] == pytest.approx(20.0)


def test_growth_is_a_cagr_over_the_statement_window():
    f = factors_from_statements(*make_statements(), info={})
    assert f["revenue_cagr"] == pytest.approx(((1000 / 600) ** (1 / 4) - 1) * 100, abs=0.01)
    assert f["profit_cagr"] == pytest.approx(((200 / 80) ** (1 / 4) - 1) * 100, abs=0.01)


def test_quarterly_yoy_compares_same_quarter_a_year_apart():
    f = factors_from_statements(*make_statements(), info={})
    assert f["q_eps_yoy"] == pytest.approx((6.0 / 4.0 - 1) * 100, abs=0.01)
    assert f["q_rev_yoy"] == pytest.approx((280 / 230 - 1) * 100, abs=0.01)


def test_quarterly_yoy_survives_a_missing_quarter_in_yahoos_columns():
    """Real Yahoo output skips quarters (e.g. no 2025-09-30), so position 5 is not 'a year ago'."""
    inc, bs, cf, _ = make_statements()
    dates = [pd.Timestamp(x) for x in ("2026-06-30", "2026-03-31", "2025-12-31", "2025-06-30", "2025-03-31")]
    q = _stmt({"Diluted EPS": [5.52, 4.62, 3.60, 3.21, 3.39], "Total Revenue": [640, 589, 442, 371, 348]}, dates)
    f = factors_from_statements(inc, bs, cf, q, info={})
    assert f["q_eps_yoy"] == pytest.approx((5.52 / 3.21 - 1) * 100, abs=0.01)     # vs 2025-06-30
    assert f["q_rev_yoy"] == pytest.approx((640 / 371 - 1) * 100, abs=0.01)


def test_quarterly_yoy_skipped_when_columns_are_not_a_year_apart():
    inc, bs, cf, q = make_statements()
    q.columns = [pd.Timestamp(x) for x in ("2026-06-30", "2026-03-31", "2025-12-31", "2025-09-30", "2025-08-30")]
    f = factors_from_statements(inc, bs, cf, q, info={})
    assert "q_eps_yoy" not in f


def test_cash_conversion_uses_fcf_and_falls_back_to_cfo():
    inc, bs, cf, q = make_statements()
    assert factors_from_statements(inc, bs, cf, q, {})["fcf_conv"] == pytest.approx(170 / 200)
    f = factors_from_statements(inc, bs, cf.drop(index="Free Cash Flow"), q, {})
    assert f["fcf_conv"] == pytest.approx(230 / 200)


def test_valuation_and_peg_from_info():
    info = {"trailingPE": 30.0, "priceToBook": 5.0, "marketCap": 5e10, "trailingAnnualDividendYield": 0.005,
            "heldPercentInstitutions": 0.2, "heldPercentInsiders": 0.55}
    f = factors_from_statements(*make_statements(), info=info)
    assert f["pe"] == 30.0 and f["pb"] == 5.0
    assert f["mcap_cr"] == pytest.approx(5000.0)                    # Rs 5e10 = Rs 5,000 crore
    assert f["div_yield"] == pytest.approx(0.5)
    assert f["inst_pct"] == pytest.approx(20.0) and f["insider_pct"] == pytest.approx(55.0)
    assert f["peg"] == pytest.approx(30.0 / f["profit_cagr"], abs=0.01)


def test_loss_making_company_has_no_cagr_and_no_peg():
    inc, bs, cf, q = make_statements()
    inc.loc["Net Income"] = [-20, 10, 15, 20, 25]
    f = factors_from_statements(inc, bs, cf, q, {"trailingPE": 25})
    assert "profit_cagr" not in f
    assert "peg" in f                                                # falls back to revenue growth


def test_missing_statements_yield_empty_not_crash():
    assert factors_from_statements(None, None, None, None, {}) == {}
    assert factors_from_statements(pd.DataFrame(), pd.DataFrame(), pd.DataFrame(), pd.DataFrame(), None) == {}


def test_cagr_requires_positive_endpoints():
    assert _cagr([100, 80, 60]) == pytest.approx(((100 / 60) ** 0.5 - 1) * 100)
    assert _cagr([-5, 80, 60]) is None
    assert _cagr([100, None, None]) is None


# ── price factors ──────────────────────────────────────────────────────────────────────────────────────
def _series(values, start="2024-01-01"):
    idx = pd.bdate_range(start, periods=len(values))
    return pd.Series(values, index=idx, dtype=float)


def test_price_factors_trend_and_returns():
    closes = _series(np.linspace(100, 200, 300))                    # steady uptrend
    bench = _series(np.linspace(100, 120, 300))
    f = price_factors(closes, bench=bench)
    assert f["above_200dma"] is True
    assert f["ret_12m"] > 0 and f["rel_strength_12m"] > 0          # beats the benchmark
    assert f["dist_high_pct"] == pytest.approx(0.0, abs=0.01)      # closing at the 52-week high


def test_price_factors_downtrend_far_from_high():
    closes = _series(np.linspace(200, 100, 300))
    f = price_factors(closes)
    assert f["above_200dma"] is False
    assert f["dist_high_pct"] > 20 and f["ret_6m"] < 0


def test_price_factors_omit_what_history_cannot_support():
    f = price_factors(_series(np.linspace(100, 110, 80)))
    assert "ret_12m" not in f and "above_200dma" not in f and "ret_3m" in f
    assert price_factors(_series([100, 101, 102])) == {}


def test_liquidity_and_volume_surge():
    closes = _series(np.full(300, 100.0))
    vols = _series(np.concatenate([np.full(237, 1e5), np.full(63, 3e5)]))
    f = price_factors(closes, volumes=vols)
    assert f["bars"] == 300
    assert f["avg_value_cr"] == pytest.approx(100 * 3e5 / 1e7, rel=1e-3)   # Rs per day -> crore
    assert f["vol_surge"] > 1.2
