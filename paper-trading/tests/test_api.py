"""Edge-case tests for the paper-trading API. The database and Firebase are replaced with fakes."""

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import main  # noqa: E402


class FakeDb:
    def __init__(self):
        self.trades = []

    def ensure_user(self, *a, **k):
        pass

    def get_or_create_user(self, uid):
        return {"firebase_uid": uid, "virtual_balance": 1_000_000}

    def get_user_positions(self, uid):
        return []

    def get_trade_journal(self, uid):
        return []

    def execute_trade(self, uid, ticker, action, quantity, price, thesis, feedback, key):
        if quantity > 100:
            return {"success": False, "error": "Insufficient virtual balance"}
        self.trades.append((uid, ticker, action, quantity, price, key))
        return {"success": True, "trade_id": "t-1"}


@pytest.fixture()
def client(monkeypatch):
    fake = FakeDb()
    monkeypatch.setattr(main, "db", fake)
    main.app.dependency_overrides[main.require_firebase_user] = lambda: {"uid": "u1", "email": "a@b.c"}
    with TestClient(main.app) as c:
        c.fake = fake
        yield c
    main.app.dependency_overrides.clear()


def trade(**over):
    body = {"ticker": "TCS", "action": "buy", "quantity": 5, "execution_price": 2500.5, "idempotency_key": "k1"}
    body.update(over)
    return body


def test_valid_trade_is_accepted_and_action_is_normalised(client):
    r = client.post("/api/trade/execute", json=trade())
    assert r.status_code == 200 and r.json()["success"] is True
    assert client.fake.trades[0][2] == "BUY"


@pytest.mark.parametrize("override", [
    {"quantity": 0}, {"quantity": -3}, {"quantity": 1_000_001}, {"quantity": 2.5},
    {"execution_price": 0}, {"execution_price": -1}, {"execution_price": 10_000_001},
    {"action": "HOLD"}, {"action": ""}, {"ticker": ""}, {"ticker": "X" * 33},
    {"idempotency_key": ""}, {"idempotency_key": "k" * 129},
    {"user_thesis": "t" * 4001}, {"ai_feedback": "f" * 8001},
])
def test_invalid_trades_are_rejected_before_touching_the_database(client, override):
    r = client.post("/api/trade/execute", json=trade(**override))
    assert r.status_code == 422
    assert client.fake.trades == []


def test_non_finite_price_is_rejected(client):
    r = client.post("/api/trade/execute", content='{"ticker":"TCS","action":"BUY","quantity":1,"execution_price":NaN,"idempotency_key":"k"}',
                    headers={"Content-Type": "application/json"})
    assert r.status_code == 422


def test_business_rejection_maps_to_400_with_the_reason(client):
    r = client.post("/api/trade/execute", json=trade(quantity=500))
    assert r.status_code == 400 and r.json()["detail"] == "Insufficient virtual balance"


def test_portfolio_returns_balance_positions_and_journal(client):
    r = client.get("/api/portfolio")
    assert r.status_code == 200
    assert set(r.json()) == {"balance", "positions", "journal"}


def test_requests_without_a_token_are_refused(monkeypatch):
    monkeypatch.setattr(main, "db", FakeDb())
    main.app.dependency_overrides.clear()
    with TestClient(main.app) as c:
        assert c.get("/api/portfolio").status_code in (401, 403)
        assert c.post("/api/trade/execute", json=trade()).status_code in (401, 403)
        assert c.post("/api/mentor-audit", json={}).status_code in (401, 403)


@pytest.mark.parametrize("override", [
    {"quantity": 0}, {"action": "SHORT"}, {"ticker": ""}, {"rk_score": 101}, {"pl_score": -1}, {"user_thesis": "t" * 4001},
])
def test_mentor_audit_validates_its_input(client, override):
    body = {"action": "BUY", "quantity": 5, "ticker": "TCS", "user_thesis": "cheap", "rk_score": 45, "pl_score": 78}
    body.update(override)
    assert client.post("/api/mentor-audit", json=body).status_code == 422


def test_mentor_audit_survives_an_llm_failure(client, monkeypatch):
    class Boom:
        def evaluate_trade(self, **k):
            raise RuntimeError("model down")

    monkeypatch.setattr(main, "MentorAgent", Boom)
    body = {"action": "buy", "quantity": 5, "ticker": "TCS", "user_thesis": "cheap"}
    r = client.post("/api/mentor-audit", json=body)
    assert r.status_code == 200 and "failed" in r.json()["critique"].lower()
