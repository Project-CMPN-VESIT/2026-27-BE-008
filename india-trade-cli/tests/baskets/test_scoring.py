"""Spec for the legend scoring engine (offline, deterministic)."""

import math

import pytest

from baskets.scoring import MODELS, score_all
from baskets.scoring.helpers import ModelSpec, Rule, score_model, scale


# ── helpers ────────────────────────────────────────────────────────────────────────────────────────────
def test_scale_linear_and_clamped():
    assert scale(15, 10, 20) == pytest.approx(0.5)
    assert scale(5, 10, 20) == 0.0
    assert scale(99, 10, 20) == 1.0


def test_scale_inverse_when_hi_below_lo():
    # lower is better: 0.1 (best) .. 1.5 (worst)
    assert scale(0.1, 1.5, 0.1) == 1.0
    assert scale(1.5, 1.5, 0.1) == 0.0
    assert scale(0.8, 1.5, 0.1) == pytest.approx(0.5)


def test_scale_missing_or_nan_is_none():
    assert scale(None, 0, 1) is None
    assert scale(float("nan"), 0, 1) is None
    assert scale("abc", 0, 1) is None


def test_score_model_renormalises_over_available_weight_and_reports_coverage():
    spec = ModelSpec("t", "T", "T", [
        Rule("a", 50, lambda f: 1.0, "A+", "A-"),
        Rule("b", 50, lambda f: None, "B+", "B-"),
    ])
    r = score_model(spec, {})
    assert r.score == 100.0           # only 'a' had data and it is perfect
    assert r.coverage == 0.5          # but half the weight was missing


def test_score_model_all_missing_is_zero_with_zero_coverage():
    spec = ModelSpec("t", "T", "T", [Rule("a", 10, lambda f: None, "x", "y")])
    r = score_model(spec, {})
    assert (r.score, r.coverage) == (0.0, 0.0)


def test_rule_exceptions_are_treated_as_missing_not_fatal():
    def boom(f):
        raise ValueError("bad data")
    spec = ModelSpec("t", "T", "T", [Rule("a", 10, boom, "x", "y"), Rule("b", 10, lambda f: 0.5, "p", "n")])
    r = score_model(spec, {})
    assert r.score == 50.0 and r.coverage == 0.5


# ── model definitions ──────────────────────────────────────────────────────────────────────────────────
def test_five_models_registered():
    assert set(MODELS) == {"buffett", "lynch", "jhunjhunwala", "hundred_baggers", "canslim"}


@pytest.mark.parametrize("mid", list(MODELS))
def test_model_weights_sum_to_100(mid):
    assert MODELS[mid].total_weight() == pytest.approx(100.0)


# ── realistic profiles ─────────────────────────────────────────────────────────────────────────────────
COMPOUNDER = dict(  # high returns, no debt, fast growth, near highs, leader, small
    roe=28, roce=34, roe_years_ok=1.0, debt_equity=0.05, op_margin=24, margin_std=1.0, npm=17, fcf_conv=0.9,
    revenue_cagr=26, profit_cagr=35, q_eps_yoy=45, q_rev_yoy=28, op_margin_trend=2.0, pe=28, pb=6, peg=0.8,
    div_yield=0.3, inst_pct=22, promoter_pct=58, mcap_cr=6000, ret_3m=20, ret_6m=32, ret_12m=60,
    dist_high_pct=2, above_200dma=True, rel_strength_12m=45, vol_surge=1.4,
)
LOSER = dict(  # low returns, heavy debt, shrinking, far from highs, laggard
    roe=3, roce=5, roe_years_ok=0.2, debt_equity=2.5, op_margin=4, margin_std=9, npm=1, fcf_conv=0.0,
    revenue_cagr=-2, profit_cagr=-8, q_eps_yoy=-30, q_rev_yoy=-5, op_margin_trend=-3, pe=80, pb=9, peg=None,
    div_yield=4, inst_pct=65, promoter_pct=15, mcap_cr=90000, ret_3m=-15, ret_6m=-25, ret_12m=-35,
    dist_high_pct=45, above_200dma=False, rel_strength_12m=-40, vol_surge=0.6,
)


@pytest.mark.parametrize("mid", list(MODELS))
def test_every_model_ranks_compounder_above_loser(mid):
    good = score_all(COMPOUNDER)[mid]
    bad = score_all(LOSER)[mid]
    assert good.score > bad.score + 30
    assert 0 <= bad.score <= good.score <= 100
    assert good.coverage > 0.9


def test_scores_are_bounded_0_to_100_for_extreme_inputs():
    wild = {k: 1e9 for k in COMPOUNDER}
    wild["above_200dma"] = True
    for r in score_all(wild).values():
        assert 0 <= r.score <= 100
    wild = {k: -1e9 for k in COMPOUNDER}
    wild["above_200dma"] = False
    for r in score_all(wild).values():
        assert 0 <= r.score <= 100


def test_lynch_penalises_negative_growth_as_failing_peg_not_missing_data():
    shrinking = dict(COMPOUNDER, profit_cagr=-10, peg=None)
    r = score_all(shrinking)["lynch"]
    assert r.detail["peg"] == 0.0
    assert "Unattractive PEG" in r.tags_neg


def test_canslim_prefers_leaders_near_highs():
    leader = dict(COMPOUNDER, dist_high_pct=1, rel_strength_12m=50)
    laggard = dict(COMPOUNDER, dist_high_pct=40, rel_strength_12m=-20)
    assert score_all(leader)["canslim"].score > score_all(laggard)["canslim"].score + 15


def test_hundred_baggers_prefers_small_base_over_large():
    small = dict(COMPOUNDER, mcap_cr=2000)
    large = dict(COMPOUNDER, mcap_cr=80000)
    assert score_all(small)["hundred_baggers"].score > score_all(large)["hundred_baggers"].score


def test_buffett_prefers_low_debt_and_reasonable_price():
    base = score_all(dict(COMPOUNDER, debt_equity=0.1, pe=14))["buffett"].score
    levered = score_all(dict(COMPOUNDER, debt_equity=1.8, pe=14))["buffett"].score
    expensive = score_all(dict(COMPOUNDER, debt_equity=0.1, pe=70))["buffett"].score
    assert base > levered and base > expensive


def test_promoter_pct_falls_back_to_insider_pct():
    with_promoter = score_all(dict(COMPOUNDER, promoter_pct=60))["jhunjhunwala"].detail["promoter"]
    fallback = score_all({**{k: v for k, v in COMPOUNDER.items() if k != "promoter_pct"}, "insider_pct": 60})["jhunjhunwala"].detail["promoter"]
    assert with_promoter == pytest.approx(fallback)


def test_tags_reflect_strengths_and_weaknesses():
    good = score_all(COMPOUNDER)["jhunjhunwala"]
    bad = score_all(LOSER)["jhunjhunwala"]
    assert good.tags_pos and not good.tags_neg
    assert bad.tags_neg and not bad.tags_pos
    assert len(good.tags_pos) <= 3 and len(bad.tags_neg) <= 3
    # a stock that is strong everywhere except its trend is flagged for exactly that
    downtrend = score_all(dict(COMPOUNDER, above_200dma=False, ret_6m=-20))["jhunjhunwala"]
    assert "Bearish Long-Term Trend" in downtrend.tags_neg


def test_missing_data_lowers_coverage_but_not_validity():
    sparse = {"roe": 22, "pe": 20}
    r = score_all(sparse)["buffett"]
    assert 0 < r.coverage < 0.5
    assert not math.isnan(r.score)


# -- financial companies (banks/NBFCs): ROCE, margins, FCF and D/E are not meaningful -------------------
BANK = dict(roe=17, roe_years_ok=1.0, revenue_cagr=16, profit_cagr=18, pe=17, pb=2.8, peg=0.95, inst_pct=60,
            insider_pct=0.2, promoter_pct=26, mcap_cr=800000, ret_6m=12, ret_3m=6, above_200dma=True,
            dist_high_pct=5, rel_strength_12m=10, div_yield=1.1)


def test_banks_are_not_penalised_for_ratios_that_do_not_apply_to_them():
    plain = score_all(BANK)["buffett"]
    flagged = score_all(dict(BANK, is_financial=True))["buffett"]
    assert plain.coverage < 0.7           # looks like thin data if ROCE/margins/FCF/debt count against it
    assert flagged.coverage > 0.95        # but they are simply not applicable to lenders
    assert flagged.score > plain.score - 5


def test_non_financial_scoring_is_unchanged_by_the_flag_being_absent():
    assert score_all(COMPOUNDER)["buffett"].coverage > 0.95
