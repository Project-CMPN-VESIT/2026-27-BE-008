import asyncio
import json

from cyro_chat import agent, agentic_v2, llm
from cyro_chat.agent import Plan


def run(coro):
    return asyncio.run(coro)


async def collect(session, user, message, runner=None):
    events = []
    async for chunk in agent.chat_turn(session, user, message, report_runner=runner):
        events.append(json.loads(chunk[5:].strip()))
    return events


class FakeStream:
    def __init__(self, events):
        self.events = events

    @property
    def body_iterator(self):
        async def generate():
            for event in self.events:
                yield f"data: {json.dumps(event)}\n\n"
        return generate()


def test_flag_is_explicitly_opt_in(monkeypatch):
    monkeypatch.delenv("CYRO_AGENTIC_V2_ENABLED", raising=False)
    assert not agentic_v2.enabled()
    monkeypatch.setenv("CYRO_AGENTIC_V2_ENABLED", "true")
    assert agentic_v2.enabled()


def test_router_only_selects_complex_single_stock_chat():
    plan = Plan(intent="stock_qa", tickers=["TCS"])
    assert agentic_v2.should_research("What are TCS's valuation risks?", plan)
    assert not agentic_v2.should_research("What is TCS's P/E?", plan)
    assert not agentic_v2.should_research("Research TCS", Plan(intent="report", tickers=["TCS"], wants_report=True))
    assert not agentic_v2.should_research("Compare risks", Plan(intent="compare", tickers=["TCS", "INFY"]))


def test_summary_only_includes_evidence_backed_claims_and_source_provenance():
    answer, sources = agentic_v2.summarize_report({
        "symbol": "TCS",
        "summary": "Stable cash generation.",
        "conclusion": "Constructive",
        "confidence": 72,
        "claims": [
            {"text": "Cash flow is positive.", "evidence_ids": ["ev_1"]},
            {"text": "Unsupported claim.", "evidence_ids": []},
        ],
        "citation_map": {"ev_1": {"title": "Exchange filing", "source_quality": "PRIMARY", "fetched_at": "2026-10-14T00:00:00Z", "url": "https://example.test"}},
        "sources": [{"title": "Exchange filing", "source_quality": "PRIMARY", "fetched_at": "2026-10-14T00:00:00Z", "url": "https://example.test"}],
        "data_limitations": ["One source is delayed."],
    })
    assert "Cash flow is positive." in answer
    assert "Unsupported claim." not in answer
    assert "Data limitations" in answer
    assert sources[0]["label"] == "Exchange filing"
    assert "PRIMARY" in sources[0]["detail"]
    assert "ev_1" in sources[0]["detail"]
    assert sources[0]["url"] == "https://example.test"


def test_v2_success_uses_existing_chat_sse_contract(monkeypatch):
    monkeypatch.setattr(agentic_v2, "enabled", lambda: True)
    monkeypatch.setattr(agentic_v2, "should_research", lambda message, plan: True)
    monkeypatch.setattr(agent, "make_plan", lambda *args: Plan(intent="stock_qa", tickers=["TCS"]))

    async def runner(message, ticker, mode, session_id):
        return FakeStream([{
            "type": "final_report",
            "report": {
                "research_id": "research-123", "symbol": ticker, "summary": "Evidence-backed summary.",
                "conclusion": "Constructive", "confidence": 70, "claims": [],
                "sources": [{"title": "NSE filing", "source_quality": "PRIMARY"}],
            },
        }])

    events = run(collect(None, "agentic-user", "TCS valuation risks", runner))
    assert events[-1]["type"] == "done"
    assert any(event.get("type") == "sources" and event["items"][0]["label"] == "NSE filing" for event in events)
    assert any(event.get("type") == "message" and event["message"]["payload"]["agentic_v2"] for event in events)
    assert "final_report" not in [event["type"] for event in events]


def test_v2_failure_falls_back_to_current_chat_tools(monkeypatch):
    monkeypatch.setattr(agentic_v2, "enabled", lambda: True)
    monkeypatch.setattr(agentic_v2, "should_research", lambda message, plan: True)
    monkeypatch.setattr(agent, "make_plan", lambda *args: Plan(intent="stock_qa", tickers=["TCS"], tools=["stock_snapshot"]))
    monkeypatch.setattr(llm, "stream_text", lambda messages, **kwargs: iter(["Legacy fallback answer."]))

    async def runner(**kwargs):
        raise RuntimeError("research provider unavailable")

    events = run(collect(None, "agentic-fallback-user", "TCS valuation risks", runner))
    answer = "".join(event.get("text", "") for event in events if event.get("type") == "delta")
    assert "Legacy fallback answer." in answer
    assert events[-1]["type"] == "done"
    assert any(event.get("type") == "step" and event.get("status") == "failed" for event in events)


def test_flag_off_keeps_legacy_path(monkeypatch):
    monkeypatch.delenv("CYRO_AGENTIC_V2_ENABLED", raising=False)
    monkeypatch.setattr(agent, "make_plan", lambda *args: Plan(intent="stock_qa", tickers=["TCS"], tools=["stock_snapshot"]))
    monkeypatch.setattr(llm, "stream_text", lambda messages, **kwargs: iter(["Legacy path."]))
    calls = []

    async def runner(**kwargs):
        calls.append(kwargs)
        raise AssertionError("v2 should not call the research graph")

    events = run(collect(None, "agentic-legacy-user", "TCS valuation risks", runner))
    assert not calls
    assert "Legacy path." in "".join(event.get("text", "") for event in events if event.get("type") == "delta")


def test_registry_marks_private_portfolio_as_uid_scoped_read_only():
    item = next(c for c in agentic_v2.CAPABILITY_REGISTRY if c.name == "chat.portfolio_review")
    assert "UID scoped" in item.authentication
    assert "read-only" in item.readiness

