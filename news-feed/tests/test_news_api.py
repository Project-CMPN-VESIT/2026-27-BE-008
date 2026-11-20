"""Edge-case tests for the news-feed API (database access is faked)."""

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import main  # noqa: E402


@pytest.fixture()
def client(monkeypatch):
    calls = []

    def fake(symbol=None, source=None, nse_index=None, limit=None):
        calls.append({"symbol": symbol, "source": source, "nse_index": nse_index, "limit": limit})
        return [{"id": i, "symbol": symbol or "TCS", "subject": "x" * 400} for i in range(3)]

    monkeypatch.setattr(main, "get_announcements", fake)
    with TestClient(main.app) as c:
        c.calls = calls
        yield c


def test_default_limit_is_bounded(client):
    assert client.get("/v1/news").status_code == 200
    assert client.calls[-1]["limit"] == 5000


@pytest.mark.parametrize("limit", ["0", "-5", "abc", "20001", "999999"])
def test_limit_must_be_between_1_and_20000(client, limit):
    assert client.get(f"/v1/news?limit={limit}").status_code == 422


def test_limit_upper_bound_is_allowed(client):
    assert client.get("/v1/news?limit=20000").status_code == 200


def test_filters_are_normalised(client):
    client.get("/v1/news?symbol=%20tcs%20&source=nse&nse_index=sme")
    assert client.calls[-1] == {"symbol": "TCS", "source": "NSE", "nse_index": "SME", "limit": 5000}


@pytest.mark.parametrize("query", ["source=XYZ", "nse_index=BOGUS", "source=BSE&nse_index=SME"])
def test_invalid_filters_are_rejected(client, query):
    assert client.get(f"/v1/news?{query}").status_code == 400


def test_symbol_endpoint_is_bounded_and_validates(client):
    assert client.get("/v1/news/tcs").status_code == 200
    assert client.calls[-1] == {"symbol": "TCS", "source": None, "nse_index": None, "limit": 500}
    assert client.get("/v1/news/" + "A" * 41).status_code == 400
    assert client.get("/v1/news/TCS?limit=5001").status_code == 422


def test_injection_style_symbol_is_passed_as_data_not_sql(client):
    r = client.get("/v1/news/%27%3B%20DROP%20TABLE%20announcements%3B--")
    assert r.status_code == 200
    assert "DROP" in client.calls[-1]["symbol"]          # parameterised query: it is only ever a value


def test_large_responses_are_gzip_compressed(client):
    r = client.get("/v1/news", headers={"Accept-Encoding": "gzip"})
    assert r.headers.get("content-encoding") == "gzip"
