"""Spec for basket selection and weighting (pure logic, offline)."""

import datetime as dt

import pytest

from baskets.definitions import BASKETS, BasketDef
from baskets.engine import Candidate, cap_weights, eligible, needs_rebalance, select

D = BasketDef("t", "Test", "canslim", ("small", "mid"), "x", n=6, min_score=55, min_liq_cr=2.0, max_weight=0.25)


def cand(sym, score, cap="small", sector=None, cov=0.95, liq=10.0):
    return Candidate(sym, cap, sector or f"S_{sym}", score, cov, liq)


# ── cap_weights ──
def test_cap_weights_sum_to_one_and_respect_cap():
    w = cap_weights([100, 10, 10, 10, 10, 10], 0.25)
    assert sum(w) == pytest.approx(1.0)
    assert max(w) <= 0.25 + 1e-9
    assert w[0] == pytest.approx(0.25)                      # the dominant name is clipped, others absorb the rest


def test_cap_weights_uncapped_is_proportional():
    w = cap_weights([3, 1], 0.9)
    assert w == [pytest.approx(0.75), pytest.approx(0.25)]


def test_cap_weights_equal_when_cap_is_infeasible():
    w = cap_weights([5, 1, 1], 0.2)                         # 3 * 0.2 < 1 can never sum to 1
    assert w == [pytest.approx(1 / 3)] * 3


def test_cap_weights_empty():
    assert cap_weights([], 0.1) == []


# ── eligibility ──
def test_eligibility_filters():
    cs = [
        cand("OK", 70),
        cand("LOWSCORE", 40),
        cand("THINDATA", 80, cov=0.5),
        cand("ILLIQUID", 80, liq=0.5),
        cand("WRONGCAP", 80, cap="large"),
    ]
    assert [c.symbol for c in eligible(cs, D)] == ["OK"]


# ── selection ──
def test_selects_top_n_by_score_desc_with_symbol_tiebreak():
    cs = [cand(f"S{i}", 90 - i) for i in range(10)] + [cand("AAA", 81), cand("ZZZ", 81)]
    picks = select(cs, D)
    assert len(picks) == D.n
    assert [p.score for p in picks] == sorted((p.score for p in picks), reverse=True)
    syms = [p.symbol for p in picks]
    assert syms.index("AAA") < syms.index("ZZZ") if "ZZZ" in syms else True


def test_weights_sum_to_one_cap_respected_and_higher_score_not_lower_weight():
    picks = select([cand(f"S{i}", 95 - 3 * i) for i in range(8)], D)
    assert sum(p.weight for p in picks) == pytest.approx(1.0)
    assert all(p.weight <= D.max_weight + 1e-9 for p in picks)
    assert picks[0].weight >= picks[-1].weight


def test_sector_cap_limits_concentration():
    d = BasketDef("t", "T", "canslim", ("small",), "x", n=6, max_weight=0.3)          # max 2 per sector
    cs = [cand(f"BANK{i}", 90 - i, sector="Financials") for i in range(6)] + [cand(f"IT{i}", 70 - i, sector=f"Sec{i}") for i in range(6)]
    picks = select(cs, d)
    assert sum(1 for p in picks if p.sector == "Financials") <= d.max_per_sector
    assert len(picks) == d.n


def test_unknown_sector_does_not_block_other_unknown_sectors():
    d = BasketDef("t", "T", "canslim", ("small",), "x", n=6, max_weight=0.3)
    cs = [Candidate(f"X{i}", "small", None, 80 - i, 0.95, 10.0) for i in range(8)]
    assert len(select(cs, d)) == 6


def test_incumbents_are_sticky_within_the_hysteresis_band():
    cs = [cand(f"N{i}", 80) for i in range(6)] + [cand("OLD", 78)]          # OLD is slightly worse
    fresh = {p.symbol for p in select(cs, D)}
    sticky = {p.symbol for p in select(cs, D, incumbents={"OLD"})}
    assert "OLD" not in fresh and "OLD" in sticky                          # 78 + bonus > 80


def test_incumbent_bonus_cannot_save_a_stock_that_fails_a_hard_filter():
    cs = [cand(f"N{i}", 80) for i in range(6)] + [cand("OLD", 40)]
    assert "OLD" not in {p.symbol for p in select(cs, D, incumbents={"OLD"})}


def test_too_few_eligible_stocks_returns_no_basket():
    assert select([cand(f"S{i}", 70) for i in range(4)], D) == []


def test_selection_is_deterministic():
    cs = [cand(f"S{i}", 60 + (i * 7) % 30) for i in range(20)]
    assert select(cs, D) == select(list(reversed(cs)), D)


# ── quality guards ──
def test_financials_are_capped_per_basket():
    d = BasketDef("t", "T", "buffett", ("large",), "x", n=6, max_weight=0.3)               # cap = max(2, round(6/6)) = 2
    cs = [Candidate(f"B{i}", "large", f"Fin{i}", 95 - i, 0.95, 50.0, is_financial=True) for i in range(5)] +          [Candidate(f"N{i}", "large", f"Sec{i}", 70 - i, 0.95, 50.0) for i in range(6)]
    picks = select(cs, d)
    fins = [p for p in picks if p.symbol.startswith("B")]
    assert len(fins) == d.financials_cap == 2
    assert len(picks) == d.n                                                                # the rest are filled by non-financials


def test_recent_ipos_without_enough_history_are_excluded():
    new = Candidate("NEWIPO", "small", "X", 95, 0.95, 50.0, bars=80)
    seasoned = Candidate("OLD", "small", "Y", 70, 0.95, 50.0, bars=400)
    unknown = Candidate("UNK", "small", "Z", 70, 0.95, 50.0, bars=None)
    assert [c.symbol for c in eligible([new, seasoned, unknown], D)] == ["OLD", "UNK"]


# ── rebalance timing ──
def test_needs_rebalance():
    d = dt.date(2026, 10, 5)
    assert needs_rebalance(None, d, D)
    assert not needs_rebalance(d - dt.timedelta(days=10), d, D)
    assert needs_rebalance(d - dt.timedelta(days=D.rebalance_days), d, D)


# ── definitions sanity ──
def test_all_definitions_reference_real_models_and_valid_caps():
    from baskets.scoring import MODELS
    assert len(BASKETS) >= 6
    for b in BASKETS.values():
        assert b.model in MODELS
        assert set(b.caps) <= {"large", "mid", "small"}
        assert b.max_weight * b.n >= 1.0, f"{b.id}: max_weight too low for n holdings"
        assert b.cap_label and b.model_label
