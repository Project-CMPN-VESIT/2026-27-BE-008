"""Input-validation and isolation tests for the CYRO chat HTTP API (auth is faked, no network or LLM)."""

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from cyro_chat import api, store


@pytest.fixture()
def client(monkeypatch):
    def fake_auth(authorization, header=None):
        if not authorization:
            raise HTTPException(status_code=401, detail="Sign in is required")
        return {"uid": authorization.replace("Bearer ", ""), "email": None, "name": None, "picture": None}

    monkeypatch.setattr(api, "require_firebase_user", fake_auth)
    monkeypatch.setattr(store, "ensure_user", lambda *a, **k: None)
    app = FastAPI()
    app.include_router(api.router)
    return TestClient(app)


A = {"Authorization": "Bearer alice"}
B = {"Authorization": "Bearer bob"}


@pytest.mark.parametrize("method,path", [("get", "/skills/cyro/chat/sessions"), ("post", "/skills/cyro/chat/sessions"),
                                          ("get", "/skills/cyro/chat/memory"), ("delete", "/skills/cyro/chat/memory")])
def test_every_endpoint_requires_sign_in(client, method, path):
    kwargs = {"json": {}} if method == "post" else {}
    assert getattr(client, method)(path, **kwargs).status_code == 401


def test_chat_message_is_bounded(client):
    assert client.post("/skills/cyro/chat", json={"message": ""}, headers=A).status_code == 422
    assert client.post("/skills/cyro/chat", json={"message": "x" * 4001}, headers=A).status_code == 422
    assert client.post("/skills/cyro/chat", json={"message": "hi", "ticker": "T" * 41}, headers=A).status_code == 422


def test_session_titles_are_validated_and_isolated_per_user(client):
    sid = client.post("/skills/cyro/chat/sessions", json={"title": "My chat"}, headers=A).json()["id"]
    assert client.post("/skills/cyro/chat/sessions", json={"title": "t" * 121}, headers=A).status_code == 422
    assert client.patch(f"/skills/cyro/chat/sessions/{sid}", json={"title": ""}, headers=A).status_code == 422
    assert client.patch(f"/skills/cyro/chat/sessions/{sid}", json={"title": "Renamed"}, headers=A).status_code == 200
    # another user can neither read, rename nor delete it
    assert client.get(f"/skills/cyro/chat/sessions/{sid}/messages", headers=B).status_code == 404
    assert client.patch(f"/skills/cyro/chat/sessions/{sid}", json={"title": "Hijack"}, headers=B).status_code == 404
    assert client.delete(f"/skills/cyro/chat/sessions/{sid}", headers=B).status_code == 404
    assert [s["title"] for s in client.get("/skills/cyro/chat/sessions", headers=A).json()["sessions"]] == ["Renamed"]
    assert client.get("/skills/cyro/chat/sessions", headers=B).json()["sessions"] == []


def test_memory_rejects_unknown_keys_and_bad_values(client):
    assert client.put("/skills/cyro/chat/memory", json={"key": "risk_appetite", "value": "reckless"}, headers=A).status_code == 422
    assert client.put("/skills/cyro/chat/memory", json={"key": "password", "value": "x"}, headers=A).status_code == 422
    assert client.put("/skills/cyro/chat/memory", json={"key": "", "value": "x"}, headers=A).status_code == 422
    ok = client.put("/skills/cyro/chat/memory", json={"key": "risk_appetite", "value": "conservative"}, headers=A)
    assert ok.status_code == 200
    assert client.get("/skills/cyro/chat/memory", headers=B).json()["items"] == []    # bob does not see alice's memory
    assert client.delete("/skills/cyro/chat/memory", headers=A).json()["deleted"] >= 1
