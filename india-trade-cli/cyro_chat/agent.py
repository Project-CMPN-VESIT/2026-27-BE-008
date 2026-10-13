"""
CYRO conversational agent.

One turn = understand (plan) -> decide (chat vs. full report) -> gather facts (tools) -> answer (streamed).

The full research report pipeline is NOT modified: when the agent decides a report is warranted it delegates to
the existing `/skills/cyro/stream` generator and forwards its events untouched. The decision is the agent's, and
is shaped by what the user said, the conversation, and the preference stored in their memory.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import json
import logging
import re
import threading
from typing import Any, AsyncIterator, Callable, Dict, List, Optional, Tuple, Union

from pydantic import BaseModel, Field

from cyro_chat import grounding, llm, memory, store, tools

logger = logging.getLogger(__name__)

INTENTS = ("smalltalk", "stock_qa", "report", "discovery", "compare", "sector", "framework", "portfolio",
           "basket", "market", "memory", "general")
TOOL_NAMES = ("stock_snapshot", "stock_news", "stock_alerts", "discover", "sector_overview", "compare", "frameworks",
              "basket_info", "portfolio_review", "market_pulse")
LENSES = ("buffett", "lynch", "jhunjhunwala", "hundred_baggers", "canslim")

REPORT_EVENT_KEEP = {"started", "ticker_resolved", "intent_resolved", "analyst_start", "analyst_done",
                     "agent_claims_ready", "risk_gate_ready", "evidence_verified", "context_module_done",
                     "final_report", "final_decision", "analyst_update"}


# ── plan ─────────────────────────────────────────────────────────────────────────────────────────────────
class MemoryUpdate(BaseModel):
    key: str
    value: Union[str, List[str]] = ""
    action: str = "set"


class Plan(BaseModel):
    intent: str = "general"
    tickers: List[str] = Field(default_factory=list)
    topics: List[str] = Field(default_factory=list)
    investor_lens: Optional[str] = None
    size: Optional[str] = None
    wants_report: bool = False
    report_horizon: Optional[str] = None
    deep: bool = False
    tools: List[str] = Field(default_factory=list)
    memory_updates: List[MemoryUpdate] = Field(default_factory=list)
    reason: str = ""


_PLANNER_SYSTEM = """You are the planning brain of CYRO, an AI investment research assistant for Indian equities.
Read the user's latest message (with conversation context) and return a JSON plan. Do not answer the question.

intent (pick one): smalltalk | stock_qa (a question about one company) | report (wants a FULL research report) |
discovery (find/screen/recommend stocks) | compare (2+ companies) | sector (a sector/industry/theme) |
framework (how an investing style/metric/concept works) | portfolio (their own holdings/positions) |
basket (AI Baskets) | market (overall market, FII/DII, VIX) | memory (stating preferences/facts about themselves) | general.

tickers: NSE symbols of companies in play. Resolve pronouns ("it", "that stock", "its") from FOCUS. Use symbols given in
KNOWN_SYMBOLS when they match; never invent symbols.
topics: sector/theme words (e.g. "banks", "defence", "EV", "renewable energy").
investor_lens: buffett | lynch | jhunjhunwala | hundred_baggers | canslim when the user names an investor/style.
size: large | mid | small if the user restricts by company size.
tools: choose only what is needed, from: stock_snapshot, stock_news, stock_alerts, discover, sector_overview, compare,
frameworks, basket_info, portfolio_review, market_pulse. Prefer few tools. smalltalk needs none.

wants_report = true ONLY if the user clearly wants a comprehensive, formal research report/deep analysis of ONE company
(e.g. "full report on X", "analyse X for long term", "deep dive into X", "should I invest in X? do a full analysis").
Set false for: specific questions, quick takes, "what do you think about X" style chat, metric lookups, comparisons,
discovery, concepts. Honour USER_PROFILE.report_preference: prefer_chat => only when explicitly asked for a report;
prefer_reports => also for open-ended "analyse/research X" requests; auto => use judgement.
report_horizon: short_term | medium_term | long_term if stated or in USER_PROFILE. deep=true only if they ask for
a very deep/exhaustive analysis.

memory_updates: ONLY facts the user states about themselves or how they want CYRO to behave. Allowed keys:
risk_appetite(conservative|moderate|aggressive), investment_horizon(short_term|medium_term|long_term),
report_preference(auto|prefer_chat|prefer_reports), answer_style(concise|balanced|detailed),
experience_level(beginner|intermediate|expert), name, goals, interests[], watchlist[], holdings[], avoid[].
Use action "remove" to drop list items. Never store guesses or things the assistant said."""


def _heuristic_plan(message: str, tickers: List[str], mem: Dict[str, Any]) -> Plan:
    m = message.lower()
    p = Plan(tickers=tickers)
    explicit_report = bool(re.search(
        r"\b(full|detailed|complete|comprehensive|formal)\b.{0,15}\b(report|research|analysis)\b|"
        r"\b(research|analysis) report\b|\bgenerate (a |the )?report\b|\bdeep[- ]dive\b|\bevaluate .* for (long|short|medium)", m))
    open_analyse = bool(re.search(r"\b(analy[sz]e|research|should i (invest|buy)|worth (buying|investing))\b", m))
    for lens, words in {"buffett": ("buffett",), "lynch": ("lynch", "garp"), "jhunjhunwala": ("jhunjhunwala", "rakesh"),
                        "hundred_baggers": ("100 bagger", "hundred bagger", "multibagger", "mayer"), "canslim": ("canslim", "o'neil")}.items():
        if any(w in m for w in words):
            p.investor_lens = lens
    for sz in ("large", "mid", "small"):
        if f"{sz} cap" in m or f"{sz}-cap" in m or f"{sz}cap" in m:
            p.size = sz
    pref = mem.get("report_preference", "auto")
    if len(tickers) == 1 and (explicit_report or (open_analyse and pref == "prefer_reports")):
        p.intent, p.wants_report = "report", True
    elif re.search(r"\b(my )(portfolio|holdings|positions)\b", m):
        p.intent, p.tools = "portfolio", ["portfolio_review"]
    elif len(tickers) >= 2 and re.search(r"\b(compare|vs|versus|better|difference)\b", m):
        p.intent, p.tools = "compare", ["compare"]
    elif re.search(r"\b(find|screen|recommend|suggest|which|best|top|ideas?|pick|discover|undervalued|multibagger)\b", m) and not tickers:
        p.intent, p.tools = "discovery", ["discover"]
    elif re.search(r"\b(basket|baskets)\b", m):
        p.intent, p.tools = "basket", ["basket_info"]
    elif re.search(r"\b(fii|dii|vix|market (today|outlook|mood)|nifty today|sensex)\b", m):
        p.intent, p.tools = "market", ["market_pulse"]
    elif re.search(r"\b(sector|industry|theme|banks|banking|it services|pharma|defen[cs]e|auto|fmcg|metals|energy|realty)\b", m) and not tickers:
        p.intent, p.tools = "sector", ["sector_overview"]
    elif re.search(r"\b(what is|what's|explain|how does|how do|meaning of|difference between|framework|strategy)\b", m) and not tickers:
        p.intent, p.tools = "framework", ["frameworks"]
    elif tickers:
        p.intent, p.tools = "stock_qa", ["stock_snapshot"] + (["stock_news"] if re.search(r"\b(news|latest|recent|announce)\b", m) else []) \
            + (["stock_alerts"] if re.search(r"\b(risk|alert|warning|concern)\b", m) else [])
    elif re.match(r"^\s*(hi|hello|hey|thanks|thank you|good (morning|evening))\b", m):
        p.intent = "smalltalk"
    return p


_MEM_PATTERNS: List[Tuple[re.Pattern, str, str]] = [
    (re.compile(r"\bi(?:'m| am)(?: a)? (conservative|moderate|aggressive|cautious|risk[- ]averse)\b", re.I), "risk_appetite", ""),
    (re.compile(r"\b(long|short|medium)[- ]term (?:investor|investing|horizon)\b", re.I), "investment_horizon", ""),
    (re.compile(r"\b(?:i(?:'m| am)|as an?)\b[^.?!]{0,60}\b(conservative|aggressive|moderate|risk[- ]averse|cautious)\b", re.I), "risk_appetite", ""),
    (re.compile(r"\b(?:i(?:'m| am)|as an?)\b[^.?!]{0,60}\b(long|short|medium)[- ]term\b", re.I), "investment_horizon", ""),
    (re.compile(r"\b(?:i(?:'m| am)(?: a)?|as a) (beginner|novice|intermediate|expert|experienced)\b", re.I), "experience_level", ""),
    (re.compile(r"\b(?:no|stop|don'?t (?:give|send)|skip) (?:the )?(?:long )?reports?\b", re.I), "report_preference", "prefer_chat"),
    (re.compile(r"\balways (?:give|send|run|generate) (?:me )?(?:a )?(?:full )?reports?\b", re.I), "report_preference", "prefer_reports"),
    (re.compile(r"\b(?:keep|make) (?:it|answers?|replies) (short|brief|concise)\b", re.I), "answer_style", "concise"),
    (re.compile(r"\b(?:more|in) detail(?:ed)?\b.*\b(?:always|from now)\b|\balways (?:be )?detailed\b", re.I), "answer_style", "detailed"),
]


def _heuristic_memory(message: str) -> List[Dict[str, Any]]:
    out = []
    for rx, key, fixed in _MEM_PATTERNS:
        m = rx.search(message)
        if m:
            raw = fixed or m.group(1)
            if key == "risk_appetite":
                raw = {"cautious": "conservative", "risk-averse": "conservative", "risk averse": "conservative"}.get(raw.lower(), raw)
            if key == "investment_horizon":
                raw = f"{m.group(1).lower()}_term"
            if key == "risk_appetite":
                raw = raw.lower().replace(" ", "-")
                raw = {"risk-averse": "conservative", "cautious": "conservative"}.get(raw, raw)
            if key == "experience_level":
                raw = {"novice": "beginner", "experienced": "expert"}.get(raw.lower(), raw)
            out.append({"key": key, "value": raw})
    nm = re.search(r"\b(?i:my name is) ([A-Z][a-zA-Z]{1,20})\b", message)
    if nm:
        out.append({"key": "name", "value": nm.group(1)})
    return out


def _history_for_prompt(msgs: List[Dict[str, Any]], limit: int = 10) -> List[Tuple[str, str]]:
    out: List[Tuple[str, str]] = []
    for m in msgs[-limit:]:
        text = m["content"] or ""
        if m["kind"] == "report":
            text = f"[CYRO ran a full research report] {text}"
        out.append((m["role"], text[:1500]))
    return out


def make_plan(message: str, history: List[Dict[str, Any]], mem: Dict[str, Any], focus: List[str],
              tickers: List[str]) -> Plan:
    """LLM planner with a rules-based fallback; both are post-processed by the same validator."""
    ctx = {
        "USER_PROFILE": mem, "FOCUS": focus, "KNOWN_SYMBOLS_IN_MESSAGE": tickers,
        "RECENT_CONVERSATION": [{"role": r, "text": t[:300]} for r, t in _history_for_prompt(history, 6)],
        "USER_MESSAGE": message,
    }
    plan = llm.structured(_PLANNER_SYSTEM, json.dumps(ctx, default=str), Plan, retries=1)
    if plan is None:
        use = tickers or (focus[:1] if _refers_back(message) else [])
        plan = _heuristic_plan(message, use, mem)
        logger.info("[CyroChat] planner fallback used")
    return _validate_plan(plan, message, tickers, focus, mem)


def _refers_back(message: str) -> bool:
    return bool(re.search(r"\b(it|its|that|this|the stock|the company|them|they|their)\b", message.lower()))


def _validate_plan(p: Plan, message: str, tickers: List[str], focus: List[str], mem: Dict[str, Any]) -> Plan:
    p.intent = p.intent if p.intent in INTENTS else "general"
    p.tools = [t for t in p.tools if t in TOOL_NAMES][:5]
    p.investor_lens = p.investor_lens if p.investor_lens in LENSES else None
    p.size = p.size if p.size in ("large", "mid", "small") else None
    low = message.lower()
    for sz in ("large", "mid", "small"):                       # the user's own words are authoritative for size
        if re.search(rf"\b{sz}[- ]?caps?\b", low):
            p.size = sz
    for lens, words in {"buffett": ("buffett",), "lynch": ("lynch", "garp"), "jhunjhunwala": ("jhunjhunwala",),
                        "hundred_baggers": ("100 bagger", "hundred bagger", "multibagger", "mayer"),
                        "canslim": ("canslim",)}.items():
        if p.investor_lens is None and any(w in low for w in words):
            p.investor_lens = lens
    generic = {"cap", "caps", "stock", "stocks", "share", "shares", "good", "best", "top", "high", "quality", "small",
               "mid", "large", "midcap", "smallcap", "largecap", "company", "companies", "market", "india", "indian",
               "invest", "investing", "long", "term", "growth", "value"}
    p.topics = [t for t in (str(x).strip() for x in p.topics)
                if t and not set(re.findall(r"[a-z]+", t.lower())) <= generic][:3]
    p.report_horizon = p.report_horizon if p.report_horizon in ("short_term", "medium_term", "long_term") else None
    # Only trust tickers we can verify: the ones resolved from the message, or the planner's if they are in the universe.
    universe = {u["symbol"] for u in tools._universe()}
    cleaned: List[str] = []
    for t in list(p.tickers) + list(tickers):
        t = str(t).upper().replace(".NS", "").strip()
        if t and t not in cleaned and (t in universe or not universe or t in tickers):
            cleaned.append(t)
    if not cleaned and focus and _refers_back(message):
        cleaned = focus[:1]
    p.tickers = cleaned[:4]
    # Safety net: a report only ever runs for exactly one company.
    pref = mem.get("report_preference", "auto")
    explicit = bool(re.search(r"\b(report|deep[- ]dive|full analysis|comprehensive|detailed analysis)\b", message.lower()))
    if p.wants_report and pref == "prefer_chat" and not explicit:
        p.wants_report = False
    if p.wants_report and len(p.tickers) != 1:
        p.wants_report = False
        if len(p.tickers) > 1 and p.intent == "report":
            p.intent, p.tools = "compare", ["compare"]
    if p.wants_report:
        p.intent = "report"
    elif p.intent == "report":                      # asked for a report but it cannot run (no single company)
        p.intent = "stock_qa" if p.tickers else "general"
    if p.intent != "report" and not p.tools:
        p.tools = _default_tools(p)
    return p


def _default_tools(p: Plan) -> List[str]:
    i = p.intent
    if i == "stock_qa" and p.tickers:
        return ["stock_snapshot"]
    return {"discovery": ["discover"], "compare": ["compare"], "sector": ["sector_overview"], "framework": ["frameworks"],
            "portfolio": ["portfolio_review"], "basket": ["basket_info"], "market": ["market_pulse"]}.get(i, [])


# ── answering ────────────────────────────────────────────────────────────────────────────────────────────
_PERSONA = """You are CYRO, FinPilot's AI investment research assistant for Indian equities (NSE/BSE).
Speak like a sharp, friendly analyst: conversational, direct, plain English. Explain jargon briefly for beginners.

Hard rules:
- Every number you state must appear in DATA. Never cite a figure from memory: no peer averages, historical
  averages, targets, or other companies' ratios unless they are in DATA. If a figure you'd like isn't there, say it
  isn't available rather than estimating.
- Never recommend specific stocks, thresholds or numbers unless DATA contains them.
- Investor scores are rule-based lenses (Buffett, Lynch, Jhunjhunwala, 100 Baggers, CANSLIM), not predictions.

Style:
- Lead with the answer in the first sentence, then support it. Short paragraphs; bullets for lists; a small table
  (max 5 rows) for comparisons. Use bold for at most three key phrases. No headings unless the answer is long.
- About 100-200 words unless the user asked for depth or their answer_style is detailed.
- Tailor to USER_PROFILE (risk, horizon, experience) without reciting it back.
- You are not a SEBI-registered adviser. If you lean towards buy/sell/hold, add one short line that this is
  research, not personalised advice.
- Never claim you ran the full research report in this answer; if it would help, say you can run it.
- Do NOT end with a question or an offer ("Want me to...?"). Suggested follow-ups are shown separately."""

_INTENT_NOTES = {
    "memory": "The user is telling you about themselves. In 1-2 sentences acknowledge what you noted and how you will "
              "tailor answers. Do not recommend stocks or quote any numbers.",
    "smalltalk": "Reply warmly in one or two sentences and say what you can help with (company questions, finding "
                 "stocks, sectors, investing frameworks, their portfolio, or a full research report). No numbers.",
    "framework": "Explain the concept clearly with a tiny worked example using round illustrative numbers that you "
                 "label as an example. If DATA has CYRO's own scoring rules, describe those.",
    "general": "If this is outside investing/markets, politely steer back. If DATA is empty, answer from general "
               "investing knowledge without quoting specific company figures.",
}
_COMMON_NOTE = ("Mention a specific company only if the user asked about it or DATA is about it. Do not bring up "
                "earlier chats unless they directly help answer this message.")


def _compact(data: Any, limit: int = 5500) -> str:
    s = json.dumps(data, default=str, separators=(",", ":"))
    return s if len(s) <= limit else s[:limit] + "…(truncated)"


def build_messages(message: str, history: List[Dict[str, Any]], mem: Dict[str, Any], plan: Plan,
                   results: List[Dict[str, Any]], past: List[Dict[str, Any]], focus: List[str]) -> List[llm.Message]:
    today = dt.date.today().isoformat()
    data = {r["title"]: (r["data"] if r["ok"] else {"unavailable": r["error"]}) for r in results} if results else {}
    note = (_INTENT_NOTES.get(plan.intent, "") + " " + _COMMON_NOTE).strip()
    sys = (f"{_PERSONA}\n" + (f"\nFOR THIS MESSAGE: {note}\n" if note else "") + f"\nTODAY: {today}\n\nUSER_PROFILE:\n{memory.describe(mem)}\n"
           f"FOCUS (companies in the current conversation): {', '.join(focus) or 'none'}\n"
           + (f"EARLIER CHATS (for continuity only): {json.dumps(past, default=str)}\n" if past else "")
           + (f"\nDATA (computed by CYRO tools just now):\n{_compact(data)}\n" if data else "\nDATA: none needed for this message.\n"))
    msgs: List[llm.Message] = [("system", sys)]
    msgs += _history_for_prompt(history, 10)
    msgs.append(("user", message))
    return msgs


def fallback_answer(plan: Plan, results: List[Dict[str, Any]], llm_down: bool = True) -> str:
    """Data-only answer when the language model is unavailable."""
    lines: List[str] = []
    if llm_down:
        lines.append("_My language model is busy right now, so here are the raw findings._\n")
    for r in results:
        if not r["ok"]:
            lines.append(f"- **{r['title']}**: unavailable ({r['error']})")
            continue
        d = r["data"]
        if r["name"] == "stock_snapshot":
            lines.append(f"**{d['name']} ({d['symbol']})** · {d['sector']} · {d['size']}")
            lines.append("\n| Investor lens | Score | Rating |\n|---|---|---|")
            for s in d["investor_scores"]:
                lines.append(f"| {s['investor']} | {s['score']:.0f} | {s['band']} |" if s["score"] is not None else f"| {s['investor']} | n/a | n/a |")
        elif r["name"] == "discover":
            lines.append("**Top matches**\n\n| Stock | Score | Size |\n|---|---|---|")
            for s in d:
                lines.append(f"| {s['name']} ({s['symbol']}) | {s['score']:.0f} | {s['size']} |")
        elif r["name"] == "compare":
            lines.append("**Comparison**\n\n| Stock | " + " | ".join(next(iter(d))["scores"].keys()) + " |\n|---|" + "---|" * len(d[0]["scores"]))
            for row in d:
                lines.append(f"| {row['symbol']} | " + " | ".join(f"{v:.0f}" if v is not None else "n/a" for v in row["scores"].values()) + " |")
        else:
            lines.append(f"**{r['title']}**\n\n```\n{_compact(d, 1500)}\n```")
    return "\n".join(lines) if lines else "I couldn't reach my language model just now. Please try again in a moment."


def suggestions_for(plan: Plan, results: List[Dict[str, Any]], mem: Dict[str, Any]) -> List[str]:
    sym = plan.tickers[0] if plan.tickers else None
    out: List[str] = []
    if plan.intent == "report":
        return [f"What are the biggest risks for {sym}?", f"How would Buffett view {sym}?", f"Compare {sym} with a peer"]
    if plan.intent == "stock_qa" and sym:
        snap = next((r for r in results if r["name"] == "stock_snapshot" and r["ok"]), None)
        peer = (snap["data"]["similar_stocks"][0]["symbol"] if snap and snap["data"].get("similar_stocks") else None)
        best = snap["data"]["best_fit"]["label"] if snap and snap["data"].get("best_fit") else None
        out = [f"Run a full research report on {sym}"]
        if best:
            out.append(f"Why does {sym} fit the {best} style?")
        out.append(f"Compare {sym} with {peer}" if peer else f"What are the risks for {sym}?")
        out.append(f"Any recent news on {sym}?")
    elif plan.intent == "discovery":
        top = next((r["data"] for r in results if r["name"] == "discover" and r["ok"] and r["data"]), None)
        out = ["Show only large caps", "Which of these have the least debt?"] + ([f"Tell me more about {top[0]['symbol']}"] if top else [])
    elif plan.intent == "compare":
        out = ["Which one fits a long-term investor better?", "What are the risks in each?"]
    elif plan.intent == "sector":
        out = ["Which stocks lead this sector?", "How is valuation vs the market?"]
    elif plan.intent == "portfolio":
        out = ["Am I too concentrated in one sector?", "Which holding looks weakest?"]
    elif plan.intent in ("framework", "general", "smalltalk"):
        out = ["Find me high-quality large caps", "Explain the CANSLIM method", "What does my portfolio look like?"]
    elif plan.intent == "market":
        out = ["What is FII selling telling us?", "Which sectors look strong now?"]
    elif plan.intent == "basket":
        out = ["What's inside the best basket?", "How are baskets built?"]
    return out[:4]


def _sources_from(results: List[Dict[str, Any]]) -> List[dict]:
    seen, out = set(), []
    for r in results:
        for s in r.get("sources", []):
            k = (s.get("label"), s.get("type"))
            if k not in seen:
                seen.add(k)
                out.append({"label": s.get("label", ""), "type": s.get("type", ""), "detail": s.get("detail", ""),
                            "url": s.get("url", "")})
    return out[:12]


# ── async plumbing ───────────────────────────────────────────────────────────────────────────────────────
async def _threaded(producer: Callable[[Callable[[dict], None]], Any]) -> AsyncIterator[Tuple[str, Any]]:
    """Run a blocking `producer(emit)` in a thread; yield ("event", dict) as it emits, then ("result", value)."""
    loop = asyncio.get_running_loop()
    q: asyncio.Queue = asyncio.Queue()

    def emit(ev: dict) -> None:
        loop.call_soon_threadsafe(q.put_nowait, ("event", ev))

    def worker() -> None:
        try:
            res = producer(emit)
            loop.call_soon_threadsafe(q.put_nowait, ("result", res))
        except Exception as exc:                                  # noqa: BLE001
            loop.call_soon_threadsafe(q.put_nowait, ("error", exc))

    threading.Thread(target=worker, daemon=True, name="cyro-chat-worker").start()
    while True:
        kind, val = await q.get()
        if kind == "error":
            raise val
        yield kind, val
        if kind == "result":
            return


def _sse(ev: dict) -> str:
    return f"data: {json.dumps(ev, default=str)}\n\n"


def _title_from(message: str, tickers: List[str]) -> str:
    t = re.sub(r"\s+", " ", re.sub(r"@", "", message)).strip()
    t = t[:46].rstrip(" ,.;:") + ("…" if len(message) > 46 else "")
    return t or "New chat"


# ── the turn ─────────────────────────────────────────────────────────────────────────────────────────────
async def chat_turn(session_id: Optional[str], user_id: str, message: str, ticker_hint: Optional[str] = None,
                    report_runner: Optional[Callable[..., Any]] = None) -> AsyncIterator[str]:
    """
    Async generator of SSE strings for one user message.
    `report_runner(message, ticker, mode, session_id)` must return an object with an async `body_iterator`
    (the existing cyro_stream does).
    """
    store.init_db()
    message = (message or "").strip()
    if not message:
        yield _sse({"type": "error", "message": "Please type a message."})
        yield _sse({"type": "done"})
        return

    sess = store.get_session(session_id, user_id) if session_id else None
    if sess is None:
        sess = store.create_session(user_id, session_id=session_id)
    sid = sess["id"]
    history = store.get_messages(sid, limit=24)
    first_turn = not history
    yield _sse({"type": "session", "session_id": sid, "title": sess["title"]})

    user_msg = store.add_message(sid, "user", message)
    yield _sse({"type": "user_message", "message": user_msg})
    if first_turn:
        title = _title_from(message, [])
        store.touch_session(sid, title=title)
        yield _sse({"type": "session", "session_id": sid, "title": title})

    mem = store.get_memory(user_id)
    focus = list(sess.get("focus") or [])
    tickers = tools.resolve_tickers(message, hint=ticker_hint)

    # 1. understand + decide
    yield _sse({"type": "step", "id": "plan", "label": "Understanding your question", "status": "running"})
    loop = asyncio.get_running_loop()
    plan: Plan = await loop.run_in_executor(None, make_plan, message, history, mem, focus, tickers)

    updates = [u.model_dump() for u in plan.memory_updates] + _heuristic_memory(message)
    changed = memory.apply_updates(user_id, updates) if updates else []
    if changed:
        mem = store.get_memory(user_id)
        yield _sse({"type": "memory", "items": changed})
        if plan.intent in ("smalltalk", "general") and not plan.tools and not plan.tickers:
            plan.intent = "memory"                      # the user was telling us about themselves
    yield _sse({"type": "step", "id": "plan", "label": "Understanding your question", "status": "done"})
    if plan.tickers:
        focus = plan.tickers[:3] + [f for f in focus if f not in plan.tickers][:2]
        store.touch_session(sid, focus=focus)
    yield _sse({"type": "plan", "intent": plan.intent, "tickers": plan.tickers, "wants_report": plan.wants_report,
                "reason": plan.reason})

    # 2a. full research report (existing pipeline, untouched)
    if plan.intent == "report" and plan.wants_report and plan.tickers and report_runner is not None:
        sym = plan.tickers[0]
        horizon = (plan.report_horizon or mem.get("investment_horizon") or "").replace("_", " ")
        lead = f"I'll run a full research report on **{sym}**" + (f" with a {horizon} view" if horizon else "") + \
               ". This pulls financials, filings, technicals, sector context and news, so it takes a minute."
        yield _sse({"type": "delta", "text": lead})
        canon = f"Analyse {sym}" + (f" for {horizon}" if horizon else "")
        events: List[dict] = []
        final_report: Optional[dict] = None
        err: Optional[str] = None
        try:
            resp = await report_runner(message=canon, ticker=sym, mode="reasoning" if plan.deep else "normal", session_id=sid)
            async for chunk in resp.body_iterator:
                text = chunk.decode() if isinstance(chunk, (bytes, bytearray)) else chunk
                for line in text.split("\n"):
                    if not line.startswith("data:"):
                        continue
                    try:
                        ev = json.loads(line[5:].strip())
                    except ValueError:
                        continue
                    t = ev.get("type")
                    if t == "done":
                        continue
                    if t in REPORT_EVENT_KEEP:
                        events.append(ev)
                    if t == "final_report":
                        final_report = ev.get("report")
                    if t == "error":
                        err = ev.get("message") or "The research pipeline hit an error."
                    yield _sse(ev)
        except Exception as exc:                                   # noqa: BLE001
            logger.exception("[CyroChat] report delegation failed")
            err = str(exc)
        if final_report:
            content = f"{lead}\n\n{final_report.get('summary', '')}".strip()
            msg = store.add_message(sid, "assistant", content, kind="report",
                                    payload={"events": events, "symbol": sym, "plan": plan.model_dump()})
        else:
            fail = f"The research report for {sym} couldn't be completed" + (f" ({err})" if err else "") + \
                   ". I can still answer questions about it in chat."
            msg = store.add_message(sid, "assistant", fail, payload={"error": True})
            yield _sse({"type": "delta", "text": "\n\n" + fail})
        yield _sse({"type": "suggestions", "items": suggestions_for(plan, [], mem)})
        yield _sse({"type": "message", "message": msg})
        yield _sse({"type": "done"})
        return

    # 2b. gather facts with tools (parallel)
    calls = _tool_calls(plan, mem, user_id)
    results: List[Dict[str, Any]] = []
    if calls:
        def produce(emit):
            def start(label):
                emit({"type": "step", "id": label, "label": label, "status": "running"})

            def done(r):
                lbl = r.get("_label") or r.get("title")
                emit({"type": "step", "id": lbl, "label": lbl, "status": "done" if r["ok"] else "failed"})
            return tools.run_tools(calls, start, done)

        async for kind, val in _threaded(produce):
            if kind == "event":
                yield _sse(val)
            else:
                results = val
        # a lone report-request without a report runner or ticker still gets a normal answer
    # 3. answer
    msgs = build_messages(message, history, mem, plan, results, store.recent_user_topics(user_id, sid), focus)
    has_data = any(r["ok"] for r in results)
    answer = ""
    try:
        if has_data:
            # Facts matter more than typing effects: generate fully, verify every figure, then reveal.
            yield _sse({"type": "step", "id": "write", "label": "Writing the answer", "status": "running"})

            def produce(emit):
                return _grounded_answer(msgs, results, message, history)

            async for kind, val in _threaded(produce):
                if kind == "result":
                    answer = val
            yield _sse({"type": "step", "id": "write", "label": "Writing the answer", "status": "done"})
            for chunk in _chunks(answer):
                yield _sse({"type": "delta", "text": chunk})
                await asyncio.sleep(0.012)
        else:
            parts: List[str] = []

            def gen(emit):
                for piece in llm.stream_text(msgs):
                    emit({"type": "delta", "text": piece})

            async for kind, val in _threaded(gen):
                if kind == "event":
                    parts.append(val["text"])
                    yield _sse(val)
            answer = grounding.tidy("".join(parts))
            yield _sse({"type": "final_text", "text": answer})
    except Exception as exc:                                       # noqa: BLE001
        logger.warning("[CyroChat] answer generation failed: %s", exc)
        answer = fallback_answer(plan, results)
        yield _sse({"type": "delta", "text": answer})
        yield _sse({"type": "final_text", "text": answer})
    answer = answer.strip() or fallback_answer(plan, results)

    srcs = _sources_from(results)
    sugg = suggestions_for(plan, results, mem)
    if srcs:
        yield _sse({"type": "sources", "items": srcs})
    if sugg:
        yield _sse({"type": "suggestions", "items": sugg})
    msg = store.add_message(sid, "assistant", answer, payload={"sources": srcs, "suggestions": sugg,
                                                               "plan": plan.model_dump(), "memory_changed": changed})
    yield _sse({"type": "message", "message": msg})
    yield _sse({"type": "done"})


def _chunks(text: str, size: int = 28) -> List[str]:
    """Split on word boundaries so the reveal reads naturally."""
    out, cur = [], ""
    for w in re.findall(r"\S+\s*", text):
        cur += w
        if len(cur) >= size:
            out.append(cur)
            cur = ""
    if cur:
        out.append(cur)
    return out


def _grounded_answer(msgs: List[llm.Message], results: List[Dict[str, Any]], message: str,
                     history: List[Dict[str, Any]]) -> str:
    """Generate, verify every number against DATA, regenerate once if needed, scrub what's still unsupported."""
    allowed = grounding.data_numbers([r["data"] for r in results if r["ok"]])
    extra = [message] + [m["content"] for m in history[-10:]]
    text = llm.complete_text(msgs)
    bad = grounding.ungrounded(text, allowed, extra)
    if bad:
        logger.info("[CyroChat] ungrounded numbers %s: regenerating", bad[:6])
        fix = ("Rewrite your answer. These figures are NOT in DATA and must not appear: "
               + ", ".join(str(b) for b in bad[:10]) + ". Use only figures present in DATA; if something is not "
               "available, say so. Keep the same style and length.")
        try:
            text2 = llm.complete_text(msgs + [("assistant", text), ("user", fix)])
            text, bad = text2, grounding.ungrounded(text2, allowed, extra)
        except Exception:                                          # noqa: BLE001
            pass
        if bad:
            text = grounding.scrub(text, bad)
    return grounding.tidy(text)


def _tool_calls(plan: Plan, mem: Dict[str, Any], user_id: str) -> List[tuple]:
    calls: List[tuple] = []
    t = set(plan.tools)
    sym = plan.tickers[0] if plan.tickers else None
    if "stock_snapshot" in t and sym:
        calls.append((f"Reading {sym} fundamentals & scores", tools.stock_snapshot, {"symbol": sym}))
    if "stock_news" in t and sym:
        calls.append((f"Checking latest {sym} news", tools.stock_news, {"symbol": sym}))
    if "stock_alerts" in t and sym:
        calls.append((f"Scanning {sym} risk signals", tools.stock_alerts, {"symbol": sym}))
    if "compare" in t and len(plan.tickers) >= 2:
        calls.append(("Comparing " + " vs ".join(plan.tickers[:3]), tools.compare, {"symbols": plan.tickers}))
    if "discover" in t:
        calls.append(("Screening the Nifty 500", tools.discover,
                      {"model": plan.investor_lens, "cap": plan.size, "keywords": plan.topics or None}))
    if "sector_overview" in t:
        topic = (plan.topics[0] if plan.topics else None) or (mem.get("interests") or [None])[0]
        if topic:
            calls.append((f"Analysing the {topic} space", tools.sector_overview, {"sector": topic}))
    if "frameworks" in t:
        calls.append(("Loading investing frameworks", tools.frameworks, {"topic": " ".join(plan.topics)}))
    if "basket_info" in t:
        calls.append(("Looking up AI Baskets", tools.basket_info, {"query": " ".join(plan.topics)}))
    if "portfolio_review" in t:
        calls.append(("Reviewing your portfolio", tools.portfolio_review, {"user_id": "test_user"}))
    if "market_pulse" in t:
        calls.append(("Checking market pulse", tools.market_pulse, {}))
    return calls
