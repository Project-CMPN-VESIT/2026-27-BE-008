"""Screener engine and API: conditions, missing data, explanations, sorting, presets and error handling."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from stock_screener import api as screener_api
from stock_screener import engine
from stock_screener.fields import FIELDS
from stock_screener.presets import PRESETS


def row(symbol, **kw):
    base = {k: None for k in FIELDS}
    base.update({"symbol": symbol, "name": symbol.title() + " Ltd", "sector": "IT", "cap_class": "large", "industry": None})
    base.update(kw)
    return base


@pytest.fixture()
def universe():
    return [
        row("AAA", pe=12.0, roe=22.0, div_yield=3.5, mcap_cr=90000, profit_cagr=18.0, above_200dma=True, dist_high_pct=2.0),
        row("BBB", pe=45.0, roe=9.0, div_yield=0.0, mcap_cr=50000, sector="Banks", cap_class="mid", profit_cagr=4.0, above_200dma=False),
        row("CCC", pe=None, roe=30.0, div_yield=1.0, mcap_cr=20000, sector="Banks", cap_class="small", above_200dma=None),
        row("DDD", pe=-5.0, roe=5.0, mcap_cr=8000, cap_class="small", promoter_pct=70.0, q_eps_yoy=40.0),
    ]


def syms(out):
    return [r["symbol"] for r in out["results"]]


def test_no_conditions_returns_everything_sorted_by_market_cap(universe):
    out = engine.screen(universe, [])
    assert out["matched"] == 4 and out["total_universe"] == 4
    assert syms(out) == ["AAA", "BBB", "CCC", "DDD"]


def test_numeric_conditions_are_anded(universe):
    out = engine.screen(universe, [{"field": "pe", "op": "<", "value": 20}, {"field": "roe", "op": ">=", "value": 20}])
    assert syms(out) == ["AAA"]


def test_missing_value_never_passes_a_condition(universe):
    out = engine.screen(universe, [{"field": "pe", "op": "<", "value": 100}])
    assert "CCC" not in syms(out)                       # CCC has no P/E
    assert set(syms(out)) == {"AAA", "BBB", "DDD"}


def test_between_and_category_and_bool(universe):
    assert syms(engine.screen(universe, [{"field": "roe", "op": "between", "value": [8, 25]}])) == ["AAA", "BBB"]
    assert syms(engine.screen(universe, [{"field": "sector", "op": "in", "value": ["Banks"]}])) == ["BBB", "CCC"]
    assert syms(engine.screen(universe, [{"field": "above_200dma", "op": "==", "value": True}])) == ["AAA"]
    assert syms(engine.screen(universe, [{"field": "cap_class", "op": "!=", "value": "small"}])) == ["AAA", "BBB"]


def test_each_match_explains_every_condition_with_the_actual_value(universe):
    out = engine.screen(universe, [{"field": "pe", "op": "<=", "value": 15}, {"field": "div_yield", "op": ">=", "value": 3}])
    why = out["results"][0]["why"]
    assert [w["field"] for w in why] == ["pe", "div_yield"]
    assert why[0]["actual"] == 12.0 and "P/E" in why[0]["text"] and "<=" in why[0]["text"]


def test_sorting_puts_missing_values_last_in_both_directions(universe):
    desc = syms(engine.screen(universe, [], sort_by="pe", sort_desc=True))
    asc = syms(engine.screen(universe, [], sort_by="pe", sort_desc=False))
    assert desc == ["BBB", "AAA", "DDD", "CCC"] and asc == ["DDD", "AAA", "BBB", "CCC"]


def test_search_matches_symbol_or_name(universe):
    assert syms(engine.screen(universe, [], search="bb")) == ["BBB"]
    assert syms(engine.screen(universe, [], search="ccc ltd")) == ["CCC"]


def test_symbols_filter_for_comparison(universe):
    assert syms(engine.screen(universe, [], symbols=["ddd", "aaa"])) == ["AAA", "DDD"]


def test_paging(universe):
    p1 = engine.screen(universe, [], limit=2, offset=0)
    p2 = engine.screen(universe, [], limit=2, offset=2)
    assert syms(p1) + syms(p2) == ["AAA", "BBB", "CCC", "DDD"] and p1["matched"] == 4


@pytest.mark.parametrize("bad", [
    {"field": "nope", "op": ">", "value": 1},
    {"field": "pe", "op": "contains", "value": 1},
    {"field": "pe", "op": ">", "value": "abc"},
    {"field": "pe", "op": "between", "value": [1]},
    {"field": "above_200dma", "op": "==", "value": "yes"},
    {"field": "sector", "op": "in", "value": "Banks"},
    {"field": "sector", "op": ">", "value": "A"},
])
def test_invalid_conditions_are_rejected(universe, bad):
    with pytest.raises(ValueError):
        engine.screen(universe, [bad])


def test_condition_count_and_sort_field_are_limited(universe):
    with pytest.raises(ValueError):
        engine.screen(universe, [{"field": "pe", "op": ">", "value": 0}] * 21)
    with pytest.raises(ValueError):
        engine.screen(universe, [], sort_by="__class__")


def test_between_bounds_are_ordered(universe):
    out = engine.screen(universe, [{"field": "roe", "op": "between", "value": [25, 8]}])
    assert out["conditions"][0]["value"] == [8.0, 25.0]


def test_summary_reports_medians_sectors_and_caps(universe):
    s = engine.screen(universe, [])["summary"]
    assert s["median"]["roe"] == 15.5 and s["caps"] == {"large": 1, "mid": 1, "small": 2}
    assert {"sector": "Banks", "count": 2} in s["sectors"]


def test_every_preset_is_valid_and_loads_back_through_validation(universe):
    for p in PRESETS:
        engine.validate(p["conditions"])
    ids = [p["id"] for p in PRESETS]
    assert len(ids) == len(set(ids)) and "all" in ids


def test_meta_lists_presets_with_live_match_counts(universe):
    m = engine.meta(universe)
    by_id = {p["id"]: p for p in m["presets"]}
    assert m["universe"] == 4 and by_id["all"]["matches"] == 4
    assert by_id["dividend_low_pe"]["matches"] == 1          # only AAA: yield >= 3, 0 < P/E <= 15
    assert m["sectors"] == ["Banks", "IT"] and "note" in m


def test_build_rows_flattens_factor_json():
    class S:
        symbol, name, sector, cap_class, industry, last_price, mcap_cr = "XYZ", "Xyz", "IT", "mid", "Soft", 100.0, 5000.0
    rows = engine.build_rows([S()], {"XYZ": {"pe": 20, "roe": float("nan"), "div_yield": "1.5"}},
                             {"XYZ": {"last_close": 123.4, "above_200dma": True, "ret_3m": 7}})
    r = rows[0]
    assert r["pe"] == 20.0 and r["roe"] is None and r["div_yield"] == 1.5
    assert r["price"] == 123.4 and r["above_200dma"] is True and r["mcap_cr"] == 5000.0 and r["sector"] == "IT"


# ------------------------------------------------------------------------------------------------ API
@pytest.fixture()
def client(universe, monkeypatch):
    monkeypatch.setattr(engine, "load_universe", lambda force=False: universe)
    app = FastAPI()
    app.include_router(screener_api.router)
    return TestClient(app)


def test_api_meta_and_run(client):
    assert client.get("/screener/meta").json()["universe"] == 4
    r = client.post("/screener/run", json={"conditions": [{"field": "roe", "op": ">=", "value": 20}], "sort_by": "roe"})
    body = r.json()
    assert r.status_code == 200 and body["matched"] == 2 and [x["symbol"] for x in body["results"]] == ["CCC", "AAA"]


def test_api_rejects_bad_requests_with_400_or_422(client):
    assert client.post("/screener/run", json={"conditions": [{"field": "x", "op": ">", "value": 1}]}).status_code == 400
    assert client.post("/screener/run", json={"limit": 0}).status_code == 422
    assert client.post("/screener/run", json={"limit": 501}).status_code == 422
    assert client.post("/screener/run", json={"symbols": ["A"] * 51}).status_code == 422


def test_api_reports_503_when_universe_is_empty(monkeypatch):
    monkeypatch.setattr(engine, "load_universe", lambda force=False: [])
    app = FastAPI(); app.include_router(screener_api.router)
    assert TestClient(app).post("/screener/run", json={}).status_code == 503
