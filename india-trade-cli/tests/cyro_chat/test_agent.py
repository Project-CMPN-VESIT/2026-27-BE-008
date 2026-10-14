"""Spec for the CYRO chat agent: memory, planning, report-vs-chat decisions, streaming turns (offline)."""

import asyncio
import json
import threading

import pytest

from cyro_chat import agent, llm, memory, store, tools
from cyro_chat.agent import Plan, chat_turn, make_plan

UNIVERSE = [{"symbol": s, "name": n, "sector": "IT", "industry": "Software", "cap": "large", "mcap_cr": 1e5, "price": 100.0}
            for s, n in [("TCS", "Tata Consultancy Services Limited"), ("INFY", "Infosys Limited"),
                         ("HDFCBANK", "HDFC Bank Limited"), ("SUZLON", "Suzlon Energy Limited")]]


@pytest.fixture(autouse=True)
def fake_world(monkeypatch):
    monkeypatch.setattr(tools, "_universe", lambda: UNIVERSE)
    monkeypatch.setattr(tools, "stock_snapshot", lambda symbol: tools._result("stock_snapshot", True, {
        "symbol": symbol, "name": symbol, "sector": "IT", "size": "large cap", "price": 100, "metrics": {"roe": 25},
        "investor_scores": [{"investor": "Warren Buffett", "score": 80.0, "band": "Excellent", "strengths": [], "weaknesses": []}],
        "best_fit": {"label": "Warren Buffett", "score": 80}, "in_baskets": [], "similar_stocks": [{"symbol": "INFY", "name": "Infosys", "scores": {}}]},
        title=f"{symbol}: scores & fundamentals"))
    monkeypatch.setattr(tools, "stock_news", lambda symbol, limit=5: tools._result("stock_news", True, [], title="news"))
    monkeypatch.setattr(tools, "stock_alerts", lambda symbol: tools._result("stock_alerts", True, [], title="alerts"))
    monkeypatch.setattr(llm, "stream_text", lambda msgs, **kw: iter(["Here is ", "the answer."]))


def run(coro):
    return asyncio.get_event_loop_policy().new_event_loop().run_until_complete(coro)


async def collect(session, user, message, ticker=None, runner=None):
    out = []
    async for chunk in chat_turn(session, user, message, ticker, report_runner=runner):
        out.append(json.loads(chunk[5:].strip()))
    return out


class FakeStream:
    def __init__(self, events):
        self.events = events

    @property
    def body_iterator(self):
        async def gen():
            for e in self.events:
                yield f"data: {json.dumps(e)}\n\n"
        return gen()


def make_runner(calls):
    async def runner(message, ticker, mode, session_id):
        calls.append({"message": message, "ticker": ticker, "mode": mode})
        return FakeStream([
            {"type": "started", "request_id": "r1", "research_id": "x1"},
            {"type": "analyst_start", "analyst": "FundamentalAnalyst"},
            {"type": "final_report", "report": {"symbol": ticker, "conclusion": "Constructive", "summary": "Solid business.", "claims": []}},
            {"type": "final_decision", "signal": "Constructive", "summary": "Solid business."},
            {"type": "done", "conclusion": "Constructive"},
        ])
    return runner


def plan_with(**kw):
    return lambda *a, **k: Plan(**kw)


# ── memory ──
def test_memory_validates_and_merges():
    ch = memory.apply_updates("u", [{"key": "risk_appetite", "value": "aggressive"}, {"key": "watchlist", "value": ["tcs", "bad!"]},
                                    {"key": "nonsense", "value": "x"}, {"key": "answer_style", "value": "banana"}])
    assert {c["key"] for c in ch} == {"risk_appetite", "watchlist"}
    memory.apply_updates("u", [{"key": "watchlist", "value": ["INFY"]}])
    assert store.get_memory("u")["watchlist"] == ["TCS", "INFY"]                 # lists union
    memory.apply_updates("u", [{"key": "watchlist", "value": ["TCS"], "action": "remove"}])
    assert store.get_memory("u")["watchlist"] == ["INFY"]
    assert memory.apply_updates("u", [{"key": "risk_appetite", "value": "aggressive"}]) == []   # no-op => no change event


def test_memory_is_per_user():
    memory.apply_updates("alice", [{"key": "risk_appetite", "value": "conservative"}])
    assert store.get_memory("bob") == {}


def test_heuristic_memory_catches_plain_statements():
    got = {u["key"]: u["value"] for u in agent._heuristic_memory("I'm a conservative investor and please keep answers short. My name is Asha")}
    assert got["risk_appetite"] == "conservative" and got["answer_style"] == "concise" and got["name"] == "Asha"
    assert agent._heuristic_memory("don't send reports")[0]["value"] == "prefer_chat"


# ── entity resolution ──
def test_resolve_tickers_from_symbols_names_and_tags():
    assert tools.resolve_tickers("what do you think of TCS?") == ["TCS"]
    assert tools.resolve_tickers("how is infosys doing") == ["INFY"]
    assert tools.resolve_tickers("compare @HDFCBANK and Suzlon Energy") == ["HDFCBANK", "SUZLON"]
    assert tools.resolve_tickers("explain the PE ratio and CANSLIM") == []             # jargon is not a ticker
    assert tools.resolve_tickers("and its debt?", hint="TCS") == ["TCS"]


# ── planning: heuristics & policy ──
def test_heuristic_plan_routes_intents():
    h = agent._heuristic_plan
    assert h("analyse TCS for long term, full report please", ["TCS"], {}).wants_report is True
    assert h("is TCS expensive?", ["TCS"], {}).intent == "stock_qa"
    assert h("compare TCS vs INFY", ["TCS", "INFY"], {}).intent == "compare"
    assert h("find me good small cap stocks", [], {}).intent == "discovery"
    assert h("how is my portfolio doing", [], {}).intent == "portfolio"
    assert h("what is the CANSLIM method?", [], {}).intent == "framework"
    assert h("hi there", [], {}).intent == "smalltalk"


def test_open_ended_analyse_respects_report_preference():
    h = agent._heuristic_plan
    assert h("analyse TCS", ["TCS"], {"report_preference": "prefer_reports"}).wants_report is True
    assert h("analyse TCS", ["TCS"], {"report_preference": "auto"}).wants_report is False
    assert h("analyse TCS", ["TCS"], {"report_preference": "prefer_chat"}).wants_report is False


def test_prefer_chat_blocks_an_implicit_report_but_not_an_explicit_request(monkeypatch):
    monkeypatch.setattr(llm, "structured", plan_with(intent="report", tickers=["TCS"], wants_report=True))
    mem = {"report_preference": "prefer_chat"}
    assert make_plan("what do you think about TCS", [], mem, [], ["TCS"]).wants_report is False
    assert make_plan("give me the full report on TCS", [], mem, [], ["TCS"]).wants_report is True


def test_report_only_ever_runs_for_exactly_one_company(monkeypatch):
    monkeypatch.setattr(llm, "structured", plan_with(intent="report", tickers=["TCS", "INFY"], wants_report=True))
    p = make_plan("full report on TCS and INFY", [], {}, [], ["TCS", "INFY"])
    assert p.wants_report is False and p.intent == "compare"


def test_planner_cannot_invent_tickers_and_resolves_pronouns_from_focus(monkeypatch):
    monkeypatch.setattr(llm, "structured", plan_with(intent="stock_qa", tickers=["FAKECO"]))
    p = make_plan("what about its debt?", [], {}, ["INFY"], [])
    assert p.tickers == ["INFY"]


def test_planner_failure_falls_back_to_rules(monkeypatch):
    monkeypatch.setattr(llm, "structured", lambda *a, **k: None)
    p = make_plan("is TCS expensive?", [], {}, [], ["TCS"])
    assert p.intent == "stock_qa" and p.tools == ["stock_snapshot"]


def test_threaded_success_does_not_mark_turn_cancelled():
    cancel_event = threading.Event()

    async def consume():
        return [item async for item in agent._threaded(lambda emit: "worker result", cancel_event=cancel_event)]

    result = asyncio.run(consume())
    assert result == [("result", "worker result")]
    assert not cancel_event.is_set()


# ── whole turns ──
def test_chat_turn_streams_answer_saves_messages_and_does_not_run_a_report(monkeypatch):
    monkeypatch.setattr(llm, "structured", plan_with(intent="stock_qa", tickers=["TCS"], tools=["stock_snapshot"]))
    calls = []
    ev = run(collect(None, "u1", "how is TCS looking?", runner=make_runner(calls)))
    kinds = [e["type"] for e in ev]
    assert kinds[0] == "session" and "delta" in kinds and kinds[-1] == "done"
    assert "".join(e["text"] for e in ev if e["type"] == "delta") == "Here is the answer."
    assert not calls                                                    # report pipeline untouched
    assert any(e["type"] == "suggestions" and any("full research report on TCS" in s for s in e["items"]) for e in ev)
    sid = next(e["session_id"] for e in ev if e["type"] == "session")
    msgs = store.get_messages(sid)
    assert [m["role"] for m in msgs] == ["user", "assistant"] and msgs[1]["content"] == "Here is the answer."
    assert store.get_session(sid)["focus"] == ["TCS"] and store.get_session(sid)["title"].startswith("how is TCS")


def test_empty_model_answer_streams_and_saves_fallback(monkeypatch):
    monkeypatch.setattr(llm, "structured", plan_with(intent="framework", tickers=[], tools=[]))
    monkeypatch.setattr(agent, "_grounded_answer", lambda *a, **k: "")

    ev = run(collect(None, "u-empty", "explain investing basics"))

    sid = next(e["session_id"] for e in ev if e["type"] == "session")
    saved = store.get_messages(sid)[-1]["content"]
    streamed = "".join(e["text"] for e in ev if e["type"] == "delta")
    assert streamed
    assert saved == streamed
    assert ev[-1]["type"] == "done"


def test_report_turn_delegates_with_a_canonical_message_and_forwards_events(monkeypatch):
    monkeypatch.setattr(llm, "structured", plan_with(intent="report", tickers=["TCS"], wants_report=True, report_horizon="long_term"))
    calls = []
    ev = run(collect(None, "u1", "Give me a full report on that CANSLIM-ish TCS", runner=make_runner(calls)))
    assert calls == [{"message": "Analyse TCS for long term", "ticker": "TCS", "mode": "normal"}]
    types = [e["type"] for e in ev]
    assert "final_report" in types and "analyst_start" in types and types.count("done") == 1   # pipeline 'done' swallowed
    sid = next(e["session_id"] for e in ev if e["type"] == "session")
    last = store.get_messages(sid)[-1]
    assert last["kind"] == "report" and last["payload"]["symbol"] == "TCS"
    assert {e["type"] for e in last["payload"]["events"]} >= {"final_report", "analyst_start"}


def test_report_failure_degrades_to_a_chat_message(monkeypatch):
    monkeypatch.setattr(llm, "structured", plan_with(intent="report", tickers=["TCS"], wants_report=True))

    async def broken(**kw):
        return FakeStream([{"type": "error", "message": "LLM down"}, {"type": "done"}])

    ev = run(collect(None, "u1", "full report on TCS", runner=broken))
    sid = next(e["session_id"] for e in ev if e["type"] == "session")
    last = store.get_messages(sid)[-1]
    assert last["kind"] == "text" and "couldn't be completed" in last["content"]
    assert ev[-1]["type"] == "done"


def test_memory_learned_in_chat_is_saved_and_reported(monkeypatch):
    monkeypatch.setattr(llm, "structured", plan_with(intent="memory", memory_updates=[
        {"key": "investment_horizon", "value": "long_term"}, {"key": "interests", "value": ["defence", "banks"]}]))
    ev = run(collect(None, "u7", "I invest for 10 years and like defence and banks"))
    mem_ev = next(e for e in ev if e["type"] == "memory")
    assert {i["key"] for i in mem_ev["items"]} == {"investment_horizon", "interests"}
    assert store.get_memory("u7")["investment_horizon"] == "long_term"


def test_followup_in_same_session_resolves_pronoun_and_keeps_history(monkeypatch):
    seen = {}

    def stream(msgs, **kw):
        seen["msgs"] = msgs
        return iter(["ok"])

    monkeypatch.setattr(llm, "stream_text", stream)
    monkeypatch.setattr(llm, "structured", lambda system, user, cls, retries=1: Plan(intent="stock_qa", tickers=["TCS"]) if "TCS" in user and "FOCUS" in user else Plan(intent="stock_qa"))
    ev1 = run(collect(None, "u1", "tell me about TCS"))
    sid = next(e["session_id"] for e in ev1 if e["type"] == "session")
    ev2 = run(collect(sid, "u1", "and what about its debt?"))
    plan = next(e for e in ev2 if e["type"] == "plan")
    assert plan["tickers"] == ["TCS"]
    roles = [r for r, _ in seen["msgs"]]
    assert roles[0] == "system" and roles.count("user") >= 2 and "tell me about TCS" in " ".join(t for _, t in seen["msgs"])


def test_llm_outage_still_returns_a_useful_data_answer(monkeypatch):
    monkeypatch.setattr(llm, "structured", plan_with(intent="stock_qa", tickers=["TCS"], tools=["stock_snapshot"]))

    def dead(msgs, **kw):
        raise RuntimeError("429")
        yield

    monkeypatch.setattr(llm, "stream_text", dead)
    ev = run(collect(None, "u1", "how is TCS?"))
    text = "".join(e["text"] for e in ev if e["type"] == "delta")
    assert "TCS" in text and "Warren Buffett" in text and ev[-1]["type"] == "done"


def test_sessions_are_isolated_between_users(monkeypatch):
    monkeypatch.setattr(llm, "structured", plan_with(intent="general"))
    ev = run(collect(None, "alice", "hello"))
    sid = next(e["session_id"] for e in ev if e["type"] == "session")
    assert store.get_session(sid, "bob") is None
    assert [s["id"] for s in store.list_sessions("alice")] == [sid] and store.list_sessions("bob") == []
    assert store.delete_session(sid, "bob") is False and store.delete_session(sid, "alice") is True


def test_empty_message_is_rejected_cleanly():
    ev = run(collect(None, "u", "   "))
    assert ev[0]["type"] == "error" and ev[-1]["type"] == "done"


# ── grounding ──
def test_grounding_flags_numbers_not_in_the_data():
    from cyro_chat import grounding as g
    data = g.data_numbers({"roe": 45.86, "debt_equity": 0.105, "pe": 15.61, "name": "TCS", "mcap_cr": 765008.4})
    ok = "TCS earns a 45.9% ROE with 0.1x debt at a P/E of 15.6 and a Rs 7,65,008 cr market cap."
    assert g.ungrounded(ok, data) == []
    bad = "Peers like Infosys run debt of 0.25 and the 5-year average P/E is 20.4."
    assert g.ungrounded(bad, data) == [0.25, 5.0 and 20.4] or set(g.ungrounded(bad, data)) == {0.25, 20.4}
    # numbers from the user's own message are allowed to be echoed back
    assert g.ungrounded("You said 18 percent returns.", data, extra_text=["I want 18% returns"]) == []


def test_scrub_removes_only_the_unsupported_sentences_and_rows():
    from cyro_chat import grounding as g
    text = "TCS has a 45.9% ROE. Infosys has debt of 0.25.\n- Wipro P/E is 21.7\n- ROE is strong"
    out = g.scrub(text, [0.25, 21.7])
    assert "45.9% ROE" in out and "0.25" not in out and "21.7" not in out and "ROE is strong" in out


def test_tidy_limits_bold_and_drops_engagement_bait():
    from cyro_chat import grounding as g
    t = "**a** **b** **c** **d** **e** reasons.\n\nWant me to compare it with Infosys?"
    out = g.tidy(t)
    assert out.count("**") == 6 and "Want me" not in out


def test_invented_numbers_trigger_one_regeneration_then_scrub(monkeypatch):
    monkeypatch.setattr(llm, "structured", plan_with(intent="stock_qa", tickers=["TCS"], tools=["stock_snapshot"]))
    calls = []

    def fake_complete(msgs, **kw):
        calls.append(len(msgs))
        return "TCS has a ROE of 25. Wipro carries debt of 0.77 which is high." if len(calls) == 1 else \
               "TCS has a ROE of 25. Wipro carries debt of 0.77 still."

    monkeypatch.setattr(llm, "complete_text", fake_complete)
    ev = run(collect(None, "u1", "how is TCS?"))
    text = "".join(e["text"] for e in ev if e["type"] == "delta")
    assert len(calls) == 2 and "ROE of 25" in text and "0.77" not in text         # regenerated once, then scrubbed


def test_size_is_taken_from_the_users_words_not_the_topic_filter(monkeypatch):
    monkeypatch.setattr(llm, "structured", plan_with(intent="discovery", topics=["small cap stocks", "good"], tools=["discover"]))
    p = make_plan("find me some good small cap stocks", [], {}, [], [])
    assert p.size == "small" and p.topics == []                       # generic words never become keyword filters


def test_scrub_does_not_truncate_at_abbreviations():
    from cyro_chat import grounding as g
    t = "TCS is solid. If you want more (e.g., peer ratios of 0.77) ask me. The ROE is 45.9%."
    out = g.scrub(t, [0.77])
    assert "TCS is solid." in out and "ROE is 45.9%" in out and "(e." not in out.replace("e.g.", "")


def test_tidy_strips_model_added_followup_menus_and_rules():
    from cyro_chat import grounding as g
    t = "TCS looks fine.\n\n---\n\nSuggested follow-ups:\n- Compare with INFY\n- Check news"
    assert g.tidy(t) == "TCS looks fine."


def test_compound_self_description_is_remembered():
    got = {u["key"]: u["value"] for u in agent._heuristic_memory("hi, I'm a beginner and a conservative long-term investor")}
    assert got.get("risk_appetite") == "conservative" and got.get("investment_horizon") == "long_term"
    assert got.get("experience_level") == "beginner"


# ── grounding regressions: a named company must never be answered from the model's memory ──
def test_lowercase_symbols_and_plain_words_are_resolved():
    assert tools.resolve_tickers("i want know about tcs stock") == ["TCS"]
    assert tools.resolve_tickers("what do you think about infy and suzlon") == ["INFY", "SUZLON"]
    assert tools.resolve_tickers("how do i invest in a good bank") == []


def test_named_company_always_fetches_live_data_even_if_planner_returns_nothing(monkeypatch):
    monkeypatch.setattr(llm, "structured", plan_with(intent="general"))
    p = make_plan("tell me about tcs", [], {}, [], ["TCS"])
    assert p.intent == "stock_qa" and "stock_snapshot" in p.tools


def test_answer_without_data_has_invented_figures_removed(monkeypatch):
    monkeypatch.setattr(llm, "structured", plan_with(intent="general"))
    monkeypatch.setattr(llm, "complete_text", lambda msgs, **kw: "TCS is a big IT firm.\n\nIt trades at Rs 4,200 with a P/E of 28.")
    ev = run(collect(None, "u1", "hello there"))
    text = "".join(e["text"] for e in ev if e["type"] == "delta")
    assert "4,200" not in text and "28" not in text and "big IT firm" in text


def test_earlier_assistant_numbers_do_not_count_as_evidence(monkeypatch):
    monkeypatch.setattr(llm, "structured", plan_with(intent="general"))
    sid = store.create_session("u1")["id"]
    store.add_message(sid, "user", "hi")
    store.add_message(sid, "assistant", "TCS trades at 4200.")
    monkeypatch.setattr(llm, "complete_text", lambda msgs, **kw: "As said, price is 4200.")
    ev = run(collect(sid, "u1", "and now?"))
    assert "4200" not in "".join(e["text"] for e in ev if e["type"] == "delta")


def test_tidy_drops_data_leaks_and_trailing_offer_questions():
    from cyro_chat import grounding
    out = grounding.tidy("Trades at 100 (from DATA). Margins look fine. Would you like to explore growth next?")
    assert "DATA" not in out and "Would you like" not in out and "Margins look fine." in out
