"""
Tools the CYRO chat agent can call. Each returns a compact, JSON-able dict so the answer model works from facts
we computed, never from guesses. Every tool degrades gracefully (returns ok=False with a reason).
"""

from __future__ import annotations

import logging
import re
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger(__name__)

NOT_TICKERS = {
    "I", "IT", "IN", "AT", "IS", "BE", "BY", "OR", "IF", "OF", "TO", "ON", "AN", "AS", "DO", "GO", "NO", "SO", "UP",
    "US", "AND", "THE", "FOR", "ALL", "BUY", "SELL", "HOLD", "NSE", "BSE", "IPO", "FII", "DII", "ROE", "ROI", "EPS",
    "PE", "PB", "AI", "SIP", "ETF", "PEG", "DCF", "CAGR", "FD", "GDP", "RBI", "SEBI", "NAV", "ITR", "TOP", "NEW",
    "BEST", "ARE", "NOT", "CAN", "HOW", "WHY", "WHAT", "WHO", "YOU", "ANY", "LOW", "HIGH", "RISK", "PLAN", "FUND",
    "CANSLIM", "GARP", "AM", "PM", "VS", "OK", "ME", "MY", "OUR",
}

_cache: Dict[str, tuple] = {}


def _cached(key: str, ttl: float, fn: Callable[[], Any]) -> Any:
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < ttl:
        return hit[1]
    val = fn()
    _cache[key] = (time.time(), val)
    return val


def _result(name: str, ok: bool = True, data: Any = None, sources: Optional[List[dict]] = None,
            error: str = "", title: str = "") -> Dict[str, Any]:
    return {"name": name, "title": title or name, "ok": ok, "data": data, "sources": sources or [], "error": error}


# ── universe / entity resolution ─────────────────────────────────────────────────────────────────────────
def _universe() -> List[dict]:
    def load():
        from baskets.db import Stock, init_db, session_scope

        init_db()
        with session_scope() as s:
            return [{"symbol": r.symbol, "name": r.name or r.symbol, "sector": r.sector, "industry": r.industry,
                     "cap": r.cap_class, "mcap_cr": r.mcap_cr, "price": r.last_price}
                    for r in s.query(Stock).filter(Stock.in_universe.is_(True)).all()]
    try:
        return _cached("universe", 600, load)
    except Exception as exc:
        logger.info("[CyroChat] universe unavailable: %s", exc)
        return []


_SUFFIX = re.compile(r"\b(limited|ltd|corporation|corp|company|co|inc|india|industries|industry|enterprises|"
                     r"technologies|technology|services|solutions|the)\b\.?", re.I)


# NSE symbols that are also everyday words: only treated as a company when the message has a stock-ish cue
_ENGLISH_SYMBOLS = {"page", "sail", "gail", "best", "bata", "cera", "coal", "can", "one", "all", "now", "pel", "man",
                    "power", "bank", "gold", "time", "fine", "deep", "just", "kaya", "lux", "nava", "rain", "star",
                    "safe", "good", "info", "intel", "orient", "relaxo", "praj", "eros", "hub", "pvr", "uno", "sun",
                    "ace", "oil", "tata", "vip", "ashok", "orient"}


def _norm_name(name: str) -> str:
    return re.sub(r"\s+", " ", _SUFFIX.sub(" ", re.sub(r"[^a-zA-Z0-9& ]", " ", name or ""))).strip().lower()


def resolve_tickers(text: str, hint: Optional[str] = None, limit: int = 4) -> List[str]:
    """Companies mentioned in a message: @tags, ALL-CAPS symbols in the universe, company names and known aliases."""
    found: List[str] = []

    def add(sym: str):
        sym = sym.upper().replace(".NS", "")
        if sym and sym not in found:
            found.append(sym)

    for m in re.findall(r"@([A-Za-z0-9&\-]{2,20})", text or ""):
        add(m)
    uni = _universe()
    symbols = {u["symbol"] for u in uni}
    for tok in re.findall(r"\b[A-Z][A-Z0-9&\-]{1,19}\b", text or ""):
        if tok not in NOT_TICKERS and (tok in symbols or not symbols):
            add(tok)
    low = " " + re.sub(r"[^a-z0-9& ]", " ", (text or "").lower()) + " "
    low = re.sub(r"\s+", " ", low)
    # lowercase symbols ("tcs", "infy"): accept exact universe symbols; ambiguous English words need a cue word
    cue = re.search(r"\b(stock|share|shares|price|ltd|limited|company|results?|invest\w*|buy|sell)\b", low) is not None
    for tok in re.findall(r"[a-z][a-z0-9&]{2,14}", low):
        sym = tok.upper()
        if sym in symbols and sym not in NOT_TICKERS and (tok not in _ENGLISH_SYMBOLS or cue):
            add(sym)
    try:
        from web.cyro_skill import _TICKER_MAP

        for alias, sym in sorted(_TICKER_MAP.items(), key=lambda kv: -len(kv[0])):
            if len(alias) >= 4 and f" {alias} " in low:
                add(sym)
    except Exception:
        pass
    for u in uni:
        n = _norm_name(u["name"])
        if len(n) >= 4 and f" {n} " in low:
            add(u["symbol"])
    if not found and hint:
        add(hint)
    return found[:limit]


def company_name(symbol: str) -> str:
    for u in _universe():
        if u["symbol"] == symbol:
            return u["name"]
    return symbol


# ── tools ────────────────────────────────────────────────────────────────────────────────────────────────
def stock_snapshot(symbol: str) -> Dict[str, Any]:
    """Investor scores + key fundamentals + recent price action for one company."""
    try:
        from baskets.insight import stock_insight

        ins = stock_insight(symbol, with_peers=True)
    except Exception as exc:
        return _result("stock_snapshot", False, error=str(exc), title=f"{symbol} snapshot")
    if ins is None:
        return _result("stock_snapshot", False, error=f"{symbol} is not in the Nifty 500 universe (no scored data)",
                       title=f"{symbol} snapshot")
    f = ins["factors"]
    keep = ["roe", "roce", "debt_equity", "op_margin", "npm", "revenue_cagr", "profit_cagr", "q_eps_yoy", "q_rev_yoy",
            "fcf_conv", "pe", "pb", "peg", "div_yield", "promoter_pct", "inst_pct", "mcap_cr", "ret_1m", "ret_3m",
            "ret_6m", "ret_12m", "dist_high_pct", "above_200dma", "rel_strength_12m", "volatility_pct"]
    data = {
        "symbol": ins["symbol"], "name": ins["name"], "sector": ins["sector"], "industry": ins["industry"],
        "size": f"{ins['cap_class']} cap", "price": ins["price"],
        "metrics": {k: f[k] for k in keep if f.get(k) is not None},
        "investor_scores": [{"investor": s["label"], "score": s["score"], "band": s["band"],
                             "strengths": s["tags_pos"], "weaknesses": s["tags_neg"]} for s in ins["scores"]],
        "best_fit": ins["best_fit"], "in_baskets": [b["name"] for b in ins["in_baskets"]],
        "similar_stocks": [{"symbol": p["symbol"], "name": p["name"], "scores": p["scores"]} for p in ins["peers"]],
    }
    return _result("stock_snapshot", True, data, title=f"{ins['name'] or symbol}: scores & fundamentals", sources=[
        {"label": f"{symbol} investor scores", "type": "Investor scoring model",
         "detail": "Rule-based scores from Yahoo Finance statements and NSE data"},
        {"label": f"{symbol} fundamentals", "type": "Financial statements", "detail": "Annual and quarterly filings via Yahoo Finance"}])


def stock_news(symbol: str, limit: int = 5) -> Dict[str, Any]:
    try:
        from market.news import get_canonical_stock_news

        res = _cached(f"news:{symbol}", 300, lambda: get_canonical_stock_news(symbol, n=8))
    except Exception as exc:
        return _result("stock_news", False, error=str(exc), title=f"{symbol} news")
    items = []
    for it in list(res.get("announcements", []))[:3] + list(res.get("news", []))[:limit]:
        d = it.to_dict() if hasattr(it, "to_dict") else {}
        items.append({"title": d.get("title") or getattr(it, "title", ""), "source": d.get("publisher") or getattr(it, "source", ""),
                      "published": d.get("published") or getattr(it, "published", ""), "url": d.get("url") or getattr(it, "url", "")})
    srcs = [{"label": i["title"][:90], "type": i["source"] or "News", "detail": i["published"], "url": i["url"]} for i in items[:6]]
    return _result("stock_news", bool(items), items[: limit + 3], srcs, "" if items else "no recent news found", f"{symbol} latest news")


def stock_alerts(symbol: str) -> Dict[str, Any]:
    try:
        from market.alerts import build_alerts

        res = build_alerts(symbol)
    except Exception as exc:
        return _result("stock_alerts", False, error=str(exc), title=f"{symbol} alerts")
    alerts = [{"severity": a["type"], "title": a["title"], "detail": a["message"], "category": a["category"]}
              for a in res.get("alerts", [])[:8]]
    return _result("stock_alerts", True, alerts, [{"label": f"{symbol} alerts", "type": "Risk & momentum checks",
                                                    "detail": "Price action, derivatives, flows, events, news"}],
                   title=f"{symbol} alerts")


def discover(model: Optional[str] = None, cap: Optional[str] = None, sector: Optional[str] = None,
             keywords: Optional[List[str]] = None, limit: int = 8) -> Dict[str, Any]:
    """Stock discovery: rank the universe by an investor lens (or the average of all five), with filters."""
    try:
        from baskets.db import Score, Stock, session_scope
        from baskets.scoring import MODELS

        kws = [k.lower() for k in (keywords or []) if k and len(k) > 2]
        with session_scope() as s:
            stocks = {r.symbol: r for r in s.query(Stock).filter(Stock.in_universe.is_(True)).all()}
            q = s.query(Score).filter(Score.coverage >= 0.7)
            if model and model in MODELS:
                q = q.filter(Score.model == model)
            rows = q.all()
        by_sym: Dict[str, List[Any]] = {}
        for r in rows:
            by_sym.setdefault(r.symbol, []).append(r)
        out = []
        for sym, rs in by_sym.items():
            st = stocks.get(sym)
            if st is None:
                continue
            if cap and st.cap_class != cap:
                continue
            if sector and sector.lower() not in f"{st.sector or ''} {st.industry or ''}".lower():
                continue
            if kws and not any(k in f"{st.name} {st.sector} {st.industry}".lower() for k in kws):
                continue
            score = sum(r.score or 0 for r in rs) / len(rs)
            best = max(rs, key=lambda r: r.score or 0)
            out.append({"symbol": sym, "name": st.name, "sector": st.sector, "size": f"{st.cap_class} cap",
                        "score": round(score, 1), "best_lens": best.model if not model else model,
                        "strengths": (best.tags_pos or [])[:3], "watch_outs": (best.tags_neg or [])[:2]})
        out.sort(key=lambda x: -x["score"])
        note = ""
        if not out and kws:                       # keywords were too narrow: retry without them rather than say "none"
            return discover(model=model, cap=cap, sector=sector, keywords=None, limit=limit)
        label = MODELS[model].label if model in MODELS else "average of five investor lenses"
        return _result("discover", bool(out), out[:limit], [{"label": "Nifty 500 investor-style ranking", "type": "Investor scoring model",
                       "detail": f"Ranked by {label}" + (f", {cap} cap" if cap else "") + (f", {sector}" if sector else "")}],
                       "" if out else "no stocks matched those filters", "Stock discovery")
    except Exception as exc:
        return _result("discover", False, error=str(exc), title="Stock discovery")


def sector_overview(sector: str) -> Dict[str, Any]:
    """Aggregate view of a sector/theme: valuation, quality, momentum and the standout names."""
    try:
        import statistics

        from baskets.db import Fundamental, Score, Stock, session_scope

        term = sector.lower()
        with session_scope() as s:
            stocks = [r for r in s.query(Stock).filter(Stock.in_universe.is_(True)).all()
                      if term in f"{r.sector or ''} {r.industry or ''} {r.name or ''}".lower()]
            syms = [r.symbol for r in stocks]
            funds = {f.symbol: f for f in s.query(Fundamental).filter(Fundamental.symbol.in_(syms)).all()} if syms else {}
            scores = s.query(Score).filter(Score.symbol.in_(syms)).all() if syms else []
        if not stocks:
            return _result("sector_overview", False, error=f"no companies matched '{sector}'", title=f"{sector} overview")

        def med(key: str, src: str = "factors") -> Optional[float]:
            vals = []
            for f in funds.values():
                d = (f.factors if src == "factors" else f.price_factors) or {}
                if d.get(key) is not None:
                    vals.append(float(d[key]))
            return round(statistics.median(vals), 1) if vals else None

        avg: Dict[str, List[float]] = {}
        for sc in scores:
            avg.setdefault(sc.symbol, []).append(sc.score or 0)
        ranked = sorted(((sum(v) / len(v), sym) for sym, v in avg.items()), reverse=True)
        names = {r.symbol: r.name for r in stocks}
        caps: Dict[str, int] = {}
        for r in stocks:
            caps[r.cap_class] = caps.get(r.cap_class, 0) + 1
        data = {"sector": sector, "companies": len(stocks), "size_mix": caps,
                "median": {"pe": med("pe"), "roe_pct": med("roe"), "revenue_cagr_pct": med("revenue_cagr"),
                           "profit_cagr_pct": med("profit_cagr"), "debt_equity": med("debt_equity"),
                           "return_3m_pct": med("ret_3m", "price"), "return_12m_pct": med("ret_12m", "price")},
                "top_by_investor_score": [{"symbol": sym, "name": names.get(sym), "avg_score": round(sc, 1)} for sc, sym in ranked[:5]],
                "weakest": [{"symbol": sym, "name": names.get(sym), "avg_score": round(sc, 1)} for sc, sym in ranked[-3:]]}
        return _result("sector_overview", True, data, [{"label": f"{sector}: {len(stocks)} Nifty 500 companies",
                       "type": "Sector aggregate", "detail": "Medians across constituents"}], title=f"{sector} overview")
    except Exception as exc:
        return _result("sector_overview", False, error=str(exc), title=f"{sector} overview")


def compare(symbols: List[str]) -> Dict[str, Any]:
    snaps = [stock_snapshot(s) for s in symbols[:4]]
    ok = [s["data"] for s in snaps if s["ok"]]
    if len(ok) < 2:
        return _result("compare", False, error="need at least two scored companies to compare", title="Comparison")
    rows = [{"symbol": d["symbol"], "name": d["name"], "size": d["size"], "sector": d["sector"],
             "scores": {x["investor"]: x["score"] for x in d["investor_scores"]},
             "metrics": {k: d["metrics"].get(k) for k in ("roe", "roce", "debt_equity", "pe", "peg", "profit_cagr",
                                                         "revenue_cagr", "ret_6m", "ret_12m") if d["metrics"].get(k) is not None}}
            for d in ok]
    srcs = [src for s in snaps if s["ok"] for src in s["sources"][:1]]
    return _result("compare", True, rows, srcs, title="Side-by-side comparison")


def frameworks(topic: str = "") -> Dict[str, Any]:
    """The five investing frameworks CYRO scores with, plus the exact rules behind each score."""
    from baskets.scoring import MODELS
    from baskets.scoring.labels import PHILOSOPHY, RULE_META

    data = []
    for m in MODELS.values():
        data.append({"name": m.label, "style": m.investor, "looks_for": PHILOSOPHY[m.id],
                     "what_is_measured": [{"metric": RULE_META.get(r.key, (r.key,))[0], "weight": r.weight} for r in m.rules]})
    return _result("frameworks", True, data, [{"label": "CYRO investor-style scoring rules", "type": "Methodology",
                   "detail": "Transparent weighted checklists, 100 points each"}], title="Investing frameworks")


def basket_info(query: str = "") -> Dict[str, Any]:
    try:
        from baskets.api import _card
        from baskets.db import session_scope
        from baskets.definitions import BASKETS

        q = (query or "").lower()
        with session_scope() as s:
            cards = [_card(d, s) for d in BASKETS.values()]
        if q:
            sel = [c for c in cards if any(w in f"{c['name']} {c['model_label']} {c['cap_label']}".lower() for w in q.split() if len(w) > 3)]
            cards = sel or cards
        slim = [{"name": c["name"], "style": c["model_label"], "size": c["cap_label"], "stocks": c["holdings_count"],
                 "return_pct": c["return_pct"], "return_basis": c["return_basis"],
                 "top_holdings": [h["symbol"] for h in c["top_holdings"]]} for c in cards if c["built"]]
        return _result("basket_info", bool(slim), slim, [{"label": "AI Baskets", "type": "AI Baskets",
                       "detail": "Rule-based baskets, simulated 1-year history until live tracking matures"}],
                       "" if slim else "baskets are not built yet", "AI Baskets")
    except Exception as exc:
        return _result("basket_info", False, error=str(exc), title="AI Baskets")


def portfolio_review(user_id: str = "test_user") -> Dict[str, Any]:
    """The user's paper-trading portfolio, enriched with investor scores and sector mix."""
    try:
        import httpx

        r = httpx.get(f"http://127.0.0.1:8001/api/portfolio/{user_id}", timeout=6)
        r.raise_for_status()
        pf = r.json()
    except Exception as exc:
        return _result("portfolio_review", False, error=f"portfolio service unavailable ({exc})", title="Your portfolio")
    positions = pf.get("positions") or []
    if not positions:
        return _result("portfolio_review", False, error="the paper portfolio has no positions yet", title="Your portfolio")
    uni = {u["symbol"]: u for u in _universe()}
    rows, total = [], 0.0
    for p in positions:
        sym = str(p.get("ticker", "")).upper()
        qty, avg = float(p.get("quantity") or 0), float(p.get("average_buy_price") or 0)
        px = (uni.get(sym) or {}).get("price") or avg
        value = qty * float(px)
        total += value
        rows.append({"symbol": sym, "quantity": qty, "avg_buy": avg, "price": px, "value": value,
                     "pnl_pct": round((px / avg - 1) * 100, 1) if avg else None,
                     "sector": (uni.get(sym) or {}).get("sector"), "size": (uni.get(sym) or {}).get("cap")})
    try:
        from baskets.db import Score, session_scope

        with session_scope() as s:
            sc: Dict[str, List[float]] = {}
            for r_ in s.query(Score).filter(Score.symbol.in_([x["symbol"] for x in rows])).all():
                sc.setdefault(r_.symbol, []).append(r_.score or 0)
        for r_ in rows:
            v = sc.get(r_["symbol"])
            r_["avg_investor_score"] = round(sum(v) / len(v), 1) if v else None
    except Exception:
        pass
    sectors: Dict[str, float] = {}
    for r_ in rows:
        sectors[r_["sector"] or "Unknown"] = sectors.get(r_["sector"] or "Unknown", 0) + r_["value"]
    for r_ in rows:
        r_["weight_pct"] = round(r_["value"] / total * 100, 1) if total else None
    data = {"cash": pf.get("balance"), "invested_value": round(total, 0), "positions": sorted(rows, key=lambda x: -x["value"]),
            "sector_mix_pct": {k: round(v / total * 100, 1) for k, v in sorted(sectors.items(), key=lambda kv: -kv[1])}}
    return _result("portfolio_review", True, data, [{"label": "Paper-trading portfolio", "type": "Your portfolio",
                   "detail": "Positions from the FinPilot paper-trading account"}], title="Your portfolio")


def market_pulse() -> Dict[str, Any]:
    try:
        from market.nse_client import nse_client

        flows = nse_client.get_fii_dii() or []
        import datetime as dt

        now = dt.datetime.now()
        vix = nse_client.get_vix_history((now - dt.timedelta(days=10)).strftime("%d-%m-%Y"), now.strftime("%d-%m-%Y")) or []
        data = {"fii_dii": flows[:1], "india_vix": (vix[-1] if vix else None) and {
            "close": vix[-1].get("EOD_CLOSE_INDEX_VAL"), "change_pct": vix[-1].get("VIX_PERC_CHG"), "date": vix[-1].get("EOD_TIMESTAMP")}}
        return _result("market_pulse", True, data, [{"label": "NSE FII/DII activity and India VIX", "type": "NSE India",
                       "detail": "Latest available session"}], title="Market pulse")
    except Exception as exc:
        return _result("market_pulse", False, error=str(exc), title="Market pulse")


# ── parallel execution helper ────────────────────────────────────────────────────────────────────────────
def run_tools(calls: List[tuple], on_start: Optional[Callable[[str], None]] = None,
              on_done: Optional[Callable[[Dict[str, Any]], None]] = None) -> List[Dict[str, Any]]:
    """calls = [(label, fn, kwargs)]. Runs concurrently, preserves order, never raises."""
    def one(c):
        label, fn, kw = c
        if on_start:
            on_start(label)
        try:
            r = fn(**kw)
        except Exception as exc:
            r = _result(getattr(fn, "__name__", "tool"), False, error=str(exc), title=label)
        r.setdefault("title", label)
        r["_label"] = label
        if on_done:
            on_done(r)
        return r

    if not calls:
        return []
    with ThreadPoolExecutor(max_workers=min(6, len(calls))) as ex:
        return list(ex.map(one, calls))
