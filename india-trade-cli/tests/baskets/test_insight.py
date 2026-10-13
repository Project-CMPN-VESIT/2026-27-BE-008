"""Spec for feature 7: per-stock investor insight, peers, AI summaries (LLM mocked, offline)."""

import datetime as dt

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from baskets import summaries
from baskets.api import router
from baskets.db import Score, Summary, session_scope, utcnow
from baskets.insight import stock_insight
from baskets.scoring import MODELS
from baskets.scoring.labels import PHILOSOPHY, RULE_META, band, breakdown, format_value
from baskets.summaries import LegendSummary, fallback_summary, get_summary


# ── labels ──
def test_every_rule_of_every_model_has_a_human_label():
    for spec in MODELS.values():
        for r in spec.rules:
            assert r.key in RULE_META, f"{spec.id}.{r.key} has no label"
    assert set(PHILOSOPHY) == set(MODELS)


@pytest.mark.parametrize("score,expected", [(95, "Excellent"), (80, "Excellent"), (70, "Strong"), (55, "Moderate"),
                                            (40, "Weak"), (10, "Poor"), (None, "Unrated")])
def test_band(score, expected):
    assert band(score) == expected


def test_format_value():
    assert format_value("roe", "%", 28.04) == "28.0%"
    assert format_value("debt_equity", "x", 0.051) == "0.05x"
    assert format_value("mcap_cr", "cr", 6000) == "₹6,000 cr"
    assert format_value("above_200dma", "bool", True) == "Above"
    assert format_value("margin_std", "pp", -1.5) == "-1.5 pts"
    assert format_value("roe", "%", None) is None


def test_breakdown_lists_rules_by_weight_with_values_and_subscores():
    f = {"roe": 28, "roce": 34, "debt_equity": 0.05, "pe": 18, "above_200dma": True, "ret_6m": 30}
    rows = breakdown(MODELS["jhunjhunwala"], f)
    assert [r["weight"] for r in rows] == sorted((r["weight"] for r in rows), reverse=True)
    roe = next(r for r in rows if r["key"] == "roe")
    assert roe["display"] == "28.0%" and roe["subscore"] == 100
    missing = next(r for r in rows if r["key"] == "profit_growth")
    assert missing["subscore"] is None and missing["display"] is None            # missing data is shown, not hidden


def test_breakdown_hides_rules_that_do_not_apply_to_banks():
    f = {"roe": 17, "pe": 15, "pb": 2.5, "is_financial": True, "debt_equity": 9.0}
    keys = {r["key"] for r in breakdown(MODELS["buffett"], f)}
    assert "debt" not in keys and "roce" not in keys and "roe" in keys


# ── insight ──
def test_stock_insight_has_all_five_models_with_breakdowns(seeded):
    ins = stock_insight("M03")
    assert ins["symbol"] == "M03" and ins["cap_class"] == "mid"
    assert {s["model"] for s in ins["scores"]} == set(MODELS)
    s = ins["scores"][0]
    assert s["band"] and s["philosophy"] and s["breakdown"] and s["tags_pos"] == ["Strong"]
    assert ins["best_fit"]["score"] == max(x["score"] for x in ins["scores"])
    assert ins["factors"]["roe"] is not None and ins["factors"]["above_200dma"] is True


def test_peers_prefer_same_sector_and_same_cap(seeded):
    ins = stock_insight("M03")
    assert 1 <= len(ins["peers"]) <= 3
    assert all(p["symbol"] != "M03" for p in ins["peers"])
    assert set(ins["peers"][0]["scores"]) == set(MODELS)
    sector = ins["sector"]
    from baskets.db import Stock
    with session_scope() as s:
        assert all(s.get(Stock, p["symbol"]).sector == sector for p in ins["peers"])
    # same-cap peers come before other caps
    caps = [p["cap_class"] for p in ins["peers"]]
    assert caps == sorted(caps, key=lambda c: c != "mid")


def test_unknown_symbol_has_no_insight(seeded):
    assert stock_insight("NOPE") is None


# ── summaries ──
GOOD = LegendSummary(summary="The company shows strong returns on equity and low debt, which fits this style well.",
                     positives=["Return on equity: 25.0%"], negatives=["Price to earnings: 40.00x"])


def fake_llm(result=GOOD, calls=None):
    def _f(insight, model):
        if calls is not None:
            calls.append((insight["symbol"], model))
        return result
    return _f


def test_summary_generated_cached_and_reused(seeded):
    calls = []
    first = get_summary("M03", "buffett", llm=fake_llm(calls=calls))
    assert first["source"] == "llm" and first["summary"].startswith("The company shows")
    assert first["positives"] == ["Return on equity: 25.0%"] and first["investor"] and first["disclaimer"]
    second = get_summary("M03", "buffett", llm=fake_llm(calls=calls))
    assert second["summary"] == first["summary"] and len(calls) == 1               # served from cache, no 2nd LLM call


def test_concurrent_identical_requests_call_the_llm_once(seeded):
    import threading
    import time
    calls = []

    def slow(insight, model):
        calls.append(1)
        time.sleep(0.4)
        return GOOD

    results = []
    threads = [threading.Thread(target=lambda: results.append(get_summary("M10", "buffett", llm=slow))) for _ in range(4)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert len(calls) == 1 and len(results) == 4 and len({r["summary"] for r in results}) == 1


def test_summary_regenerates_when_the_score_moves(seeded):
    calls = []
    get_summary("M03", "buffett", llm=fake_llm(calls=calls))
    with session_scope() as s:
        row = s.get(Score, ("M03", "buffett"))
        row.score = (row.score or 0) + 20
    get_summary("M03", "buffett", llm=fake_llm(calls=calls))
    assert len(calls) == 2


def test_summary_regenerates_when_old(seeded):
    calls = []
    get_summary("M03", "lynch", llm=fake_llm(calls=calls))
    with session_scope() as s:
        s.get(Summary, ("M03", "lynch")).generated_at = utcnow() - dt.timedelta(days=9)
    get_summary("M03", "lynch", llm=fake_llm(calls=calls))
    assert len(calls) == 2


def test_summary_falls_back_when_llm_fails_or_returns_nothing(seeded):
    def boom(insight, model):
        raise RuntimeError("429 rate limited")
    out = get_summary("M04", "canslim", llm=boom)
    assert out["source"] == "fallback" and "scores" in out["summary"] and out["note"]
    assert get_summary("M05", "canslim", llm=fake_llm(result=None))["source"] == "fallback"


def test_summary_strips_markdown_from_model_output(seeded):
    md = LegendSummary(summary="The firm shows **strong** returns on equity and a conservative balance sheet overall.",
                       positives=["**Return on equity**: 25.0%", "- Debt to equity: 0.10x"], negatives=[])
    out = get_summary("M09", "buffett", llm=fake_llm(result=md))
    assert "*" not in out["summary"] and out["positives"] == ["Return on equity: 25.0%", "Debt to equity: 0.10x"]


def test_summary_rejects_advice_and_too_short_output(seeded):
    advice = LegendSummary(summary="This is a great business and you should buy it now before it doubles in price.")
    assert get_summary("M06", "buffett", llm=fake_llm(result=advice))["source"] == "fallback"
    tiny = LegendSummary(summary="Good.")
    assert get_summary("M07", "buffett", llm=fake_llm(result=tiny))["source"] == "fallback"


def test_fallback_retried_sooner_than_a_real_summary(seeded):
    calls = []
    get_summary("M08", "buffett", llm=fake_llm(result=None, calls=calls))                  # -> fallback cached
    get_summary("M08", "buffett", llm=fake_llm(calls=calls))                               # within retry window: cached
    assert len(calls) == 1
    with session_scope() as s:
        s.get(Summary, ("M08", "buffett")).generated_at = utcnow() - dt.timedelta(minutes=45)
    out = get_summary("M08", "buffett", llm=fake_llm(calls=calls))                         # window passed: LLM tried again
    assert len(calls) == 2 and out["source"] == "llm"


def test_fallback_summary_text_cites_only_measured_values(seeded):
    ins = stock_insight("M03", with_peers=False)
    fb = fallback_summary(ins, "buffett")
    sc = next(s for s in ins["scores"] if s["model"] == "buffett")
    assert f"{sc['score']:.0f}/100" in fb.summary and sc["label"] in fb.summary
    shown = {b["display"] for b in sc["breakdown"] if b["display"]}
    for line in fb.positives + fb.negatives:
        assert line.split(": ", 1)[1] in shown


def test_unknown_symbol_or_model(seeded):
    assert get_summary("NOPE", "buffett", llm=fake_llm()) is None
    with pytest.raises(KeyError):
        get_summary("M03", "nobody", llm=fake_llm())


# ── API ──
@pytest.fixture()
def client(seeded):
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def test_scores_endpoint_returns_insight_with_peers_and_breakdown(client):
    r = client.get("/baskets/stocks/m03/scores")
    assert r.status_code == 200
    d = r.json()
    assert d["peers"] and d["scores"][0]["breakdown"] and d["best_fit"] and d["disclaimer"]
    assert client.get("/baskets/stocks/NOPE/scores").status_code == 404


def test_summary_endpoint(client, monkeypatch):
    monkeypatch.setattr(summaries, "_call_llm", lambda insight, model: GOOD)
    r = client.get("/baskets/stocks/M03/summary", params={"model": "buffett"})
    assert r.status_code == 200 and r.json()["source"] == "llm" and r.json()["positives"]
    assert client.get("/baskets/stocks/M03/summary", params={"model": "nobody"}).status_code == 404
    assert client.get("/baskets/stocks/NOPE/summary", params={"model": "buffett"}).status_code == 404
    assert client.get("/baskets/stocks/M03/summary").status_code == 422                      # model is required
