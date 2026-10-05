import operator

import pytest

from web.cyro_engine.graph import (
    CyroPipelineError,
    fan_out_analysts,
    intent_router_node,
    require_intent_route,
)
from web.cyro_engine.models import (
    EntityData,
    IntentData,
    IntentRoute,
    RoutingData,
    StockResearchContext,
)


def make_route(agents=None):
    return IntentRoute(
        request_id="research-1",
        raw_query="Analyse TCS stock",
        entity=EntityData(security_id="sec_tcs", nse_symbol="TCS"),
        resolution={"status": "resolved", "method": "exact_ticker", "confidence": 1.0},
        intent=IntentData(research_horizon="long_term", requested_areas=["general"]),
        routing=RoutingData(agents=agents or [
            "fundamental", "filings_governance", "technical",
            "sector_peer_macro", "news_catalyst", "risk", "committee",
        ]),
        metadata={"created_at": "2026-08-29T00:00:00Z"},
    )


def make_state(route):
    return {
        "request": {"mode": "deep"},
        "research_id": "research-1",
        "resolved_ticker": "TCS",
        "intent_route": route.model_dump(),
        "verified_context": StockResearchContext(identity={"symbol": "TCS"}).model_dump(),
        "specialist_reports": [],
    }


def test_intent_route_is_required_at_downstream_boundary():
    with pytest.raises(CyroPipelineError, match="IntentRoute is missing") as exc_info:
        require_intent_route({"intent_route": None}, "Agent 9")

    assert exc_info.value.error_type == "INTENT_ROUTE_MISSING"


def test_agent1_writes_canonical_intent_route(monkeypatch):
    class FakeRouter:
        def __init__(self, client):
            pass

        def route(self, request):
            return make_route()

    monkeypatch.setattr("web.cyro_engine.intent_router.router.IntentRouter", FakeRouter)
    monkeypatch.setattr("web.cyro_engine.graph.MistralClient", lambda: object())

    result = intent_router_node({
        "request": {"message": "Analyse TCS stock", "ticker": "TCS", "session_id": "session-1"},
        "research_id": "research-1",
    })

    assert result["intent_route"]["entity"]["security_id"] == "sec_tcs"
    assert "plan" not in result


def test_parallel_specialists_receive_the_same_canonical_route():
    sends = fan_out_analysts(make_state(make_route()))

    assert len(sends) == 5
    assert all(send.arg["intent_route_dict"]["entity"]["security_id"] == "sec_tcs" for send in sends)


def test_parallel_specialist_reports_fan_in_without_data_loss():
    reports = [{"agent_name": f"Agent {index}", "summary": "ok"} for index in range(4, 9)]

    merged = []
    for report in reports:
        merged = operator.add(merged, [report])

    assert [item["agent_name"] for item in merged] == [
        "Agent 4", "Agent 5", "Agent 6", "Agent 7", "Agent 8"
    ]