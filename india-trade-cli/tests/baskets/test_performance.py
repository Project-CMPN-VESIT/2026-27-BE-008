"""Spec for basket value tracking and the chart series (offline)."""

import datetime as dt

import numpy as np
import pandas as pd
import pytest

from baskets.performance import (build_series, compute_live_nav, constant_weight_nav, fd_series,
                                 headline_return, pct_return, slice_range, to_points)


def frame(**cols):
    n = len(next(iter(cols.values())))
    idx = pd.bdate_range("2026-01-01", periods=n)
    return pd.DataFrame(cols, index=idx, dtype=float)


def d(i, base="2026-01-01"):
    return pd.bdate_range(base, periods=i + 1)[i].date()


# ── live NAV ──
def test_live_nav_buy_and_hold_two_stocks():
    closes = frame(A=[100, 110, 121, 121], B=[100, 100, 100, 150])
    nav = compute_live_nav([(d(0), {"A": 0.5, "B": 0.5})], closes, start_value=100)
    assert list(nav.round(2)) == [100.0, 105.0, 110.5, 135.5]             # 0.5*A/100 + 0.5*B/100, scaled to 100


def test_rebalance_carries_value_over_then_applies_new_weights():
    closes = frame(A=[100, 200, 200, 400], B=[100, 100, 100, 100])
    nav = compute_live_nav([(d(0), {"A": 1.0}), (d(2), {"B": 1.0})], closes, start_value=100)
    # A doubles to 200 by day 1; at the rebalance on day 2 the 200 moves into B and stays flat afterwards,
    # so A's later jump to 400 must NOT show up.
    assert nav.iloc[1] == pytest.approx(200.0)
    assert nav.iloc[2] == pytest.approx(200.0)                            # no jump on rebalance day
    assert nav.iloc[3] == pytest.approx(200.0)


def test_live_nav_drops_symbols_without_a_price_and_renormalises():
    closes = frame(A=[100, 110, 120], B=[np.nan, np.nan, np.nan])
    nav = compute_live_nav([(d(0), {"A": 0.5, "B": 0.5})], closes)
    assert nav.iloc[-1] == pytest.approx(120.0)                           # all of the money went into A


def test_live_nav_empty_inputs():
    assert compute_live_nav([], frame(A=[1, 2])).empty
    assert compute_live_nav([(d(0), {"A": 1})], pd.DataFrame()).empty


# ── simulated (constant weight) ──
def test_constant_weight_nav_matches_weighted_daily_returns():
    closes = frame(A=[100, 110, 99], B=[100, 100, 110])
    nav = constant_weight_nav({"A": 0.6, "B": 0.4}, closes)
    r1 = 0.6 * 0.10 + 0.4 * 0.0
    r2 = 0.6 * (99 / 110 - 1) + 0.4 * 0.10
    assert nav.iloc[1] == pytest.approx(100 * (1 + r1))
    assert nav.iloc[2] == pytest.approx(100 * (1 + r1) * (1 + r2))


def test_constant_weight_nav_handles_a_name_listed_late():
    closes = frame(A=[100, 101, 102, 103], B=[np.nan, np.nan, 50, 55])
    nav = constant_weight_nav({"A": 0.5, "B": 0.5}, closes)
    assert nav.iloc[1] == pytest.approx(101.0)                            # only A existed -> full weight on A
    assert not nav.isna().any()


# ── benchmarks ──
def test_fd_series_accrues_simple_interest():
    idx = pd.date_range("2026-01-01", periods=366, freq="D")
    fd = fd_series(idx, 0.07)
    assert fd.iloc[0] == 100.0 and fd.iloc[-1] == pytest.approx(107.0)


# ── composed chart series ──
def make_inputs():
    closes = frame(A=np.linspace(100, 160, 300), B=np.linspace(50, 60, 300))
    bench = pd.Series(np.linspace(1000, 1100, 300), index=closes.index)
    created = closes.index[200].date()
    return closes, bench, [(created, {"A": 0.5, "B": 0.5})]


def test_build_series_is_continuous_across_creation_and_flags_live_part():
    closes, bench, rebs = make_inputs()
    df = build_series(rebs, closes, bench, 0.07)
    assert df["basket"].iloc[0] == pytest.approx(100.0)
    assert df["nifty"].iloc[0] == pytest.approx(100.0)
    created = pd.Timestamp(rebs[0][0])
    assert not df.loc[df.index < created, "live"].any()
    assert df.loc[df.index >= created, "live"].all()
    jumps = df["basket"].pct_change().abs().dropna()
    assert jumps.max() < 0.05                                              # no seam / discontinuity at creation


def test_build_series_with_no_rebalances_is_empty():
    closes, bench, _ = make_inputs()
    assert build_series([], closes, bench, 0.07).empty


def test_slice_range_rebases_every_line_to_100():
    closes, bench, rebs = make_inputs()
    df = build_series(rebs, closes, bench, 0.07)
    s = slice_range(df, "1M")
    assert s["basket"].iloc[0] == pytest.approx(100.0)
    assert s["nifty"].iloc[0] == pytest.approx(100.0) and s["fd"].iloc[0] == pytest.approx(100.0)
    assert (s.index[-1] - s.index[0]).days <= 31 + 3
    assert slice_range(df, "ALL").shape == df.shape


def test_headline_return_basis_switches_from_simulated_to_live():
    closes, bench, rebs = make_inputs()
    young = build_series(rebs, closes.iloc[:230], bench.iloc[:230], 0.07)            # ~30 trading days live
    r, basis = headline_return(young)
    assert basis == "simulated_1y" and r is not None
    old = build_series(rebs, closes, bench, 0.07)                                    # ~100 trading days live
    r2, basis2 = headline_return(old)
    assert basis2 == "live"
    live = old[old["live"]]["basket"]
    assert r2 == pytest.approx((live.iloc[-1] / live.iloc[0] - 1) * 100)


def test_pct_return_edge_cases():
    assert pct_return(pd.Series([100.0, 110.0])) == pytest.approx(10.0)
    assert pct_return(pd.Series([100.0])) is None
    assert headline_return(pd.DataFrame(columns=["basket", "nifty", "fd", "live"])) == (None, "none")


def test_to_points_scales_to_rupees():
    closes, bench, rebs = make_inputs()
    pts = to_points(slice_range(build_series(rebs, closes, bench, 0.07), "ALL"))
    assert pts[0]["basket"] == pytest.approx(100000.0)
    assert set(pts[0]) == {"date", "basket", "nifty", "fd", "live"}
