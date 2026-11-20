"""
market/alerts.py
────────────────
Per-stock alert engine for the CYRO right panel.

Every check is independent: it runs in its own thread, has its own try/except, and a
failing data source only removes that check (reported in ``checks``), never the panel.

Severity (``type``):  error = critical risk · warn = needs attention · info = FYI / opportunity

Check groups
  Price action   day move, gap, 52-week high/low, volume spike, RSI, 200-DMA, golden/death cross
  Derivatives    put-call ratio (computed from the NSE option chain; no broker login needed)
  Market         India VIX level/jump, FII/DII net flows
  Ownership      promoter holding change / level
  Events         results / board meetings, ex-dividend & other corporate actions, bulk/block deals
  News & filings risk / positive keywords in recent news and exchange filings, filing bursts
"""

from __future__ import annotations

import concurrent.futures
import logging
import re
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger(__name__)

_SEV_ORDER = {"error": 0, "warn": 1, "info": 2}
_CACHE_TTL_SEC = 120
_DEADLINE_SEC = 25
_MAX_ALERTS = 16

_cache: Dict[str, tuple] = {}
_cache_lock = threading.Lock()


def _a(type_: str, title: str, message: str, category: str, source: str = "") -> Dict[str, Any]:
    return {"type": type_, "title": title, "message": message, "category": category, "source": source}


def _num(v: Any) -> Optional[float]:
    try:
        if v is None or v == "" or v == "-":
            return None
        return float(str(v).replace(",", ""))
    except (TypeError, ValueError):
        return None


# ── Price action ────────────────────────────────────────────────────────────

def _rsi(closes: List[float], period: int = 14) -> Optional[float]:
    if len(closes) < period + 1:
        return None
    gains = losses = 0.0
    for i in range(1, period + 1):
        d = closes[i] - closes[i - 1]
        gains += max(d, 0)
        losses += max(-d, 0)
    avg_g, avg_l = gains / period, losses / period
    for i in range(period + 1, len(closes)):
        d = closes[i] - closes[i - 1]
        avg_g = (avg_g * (period - 1) + max(d, 0)) / period
        avg_l = (avg_l * (period - 1) + max(-d, 0)) / period
    if avg_l == 0:
        return 100.0
    return 100 - 100 / (1 + avg_g / avg_l)


def _sma(vals: List[float], n: int, end: Optional[int] = None) -> Optional[float]:
    end = len(vals) if end is None else end
    if end < n:
        return None
    return sum(vals[end - n:end]) / n


_BARS_CACHE: Dict[str, tuple] = {}
_BARS_TTL_SEC = 600
_BARS_STALE_MAX_SEC = 24 * 3600


def _yahoo_chart_bars(symbol: str) -> List[Dict[str, Any]]:
    """Direct Yahoo chart API (independent of the yfinance session) as a fallback."""
    import requests

    r = requests.get(
        f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}.NS",
        params={"range": "1y", "interval": "1d"},
        headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                               "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"},
        timeout=10,
    )
    r.raise_for_status()
    res = r.json()["chart"]["result"][0]
    q = res["indicators"]["quote"][0]
    bars = []
    for i, ts in enumerate(res.get("timestamp") or []):
        o, h, l, c, v = (q[k][i] for k in ("open", "high", "low", "close", "volume"))
        if None in (o, h, l, c):
            continue
        bars.append({"date": datetime.fromtimestamp(ts), "open": o, "high": h, "low": l, "close": c, "volume": v or 0})
    return bars


def _get_bars(symbol: str) -> List[Dict[str, Any]]:
    """Daily bars with retry, a second data path, and last-good caching (Yahoo is flaky per machine)."""
    now = time.time()
    hit = _BARS_CACHE.get(symbol)
    if hit and now - hit[0] < _BARS_TTL_SEC:
        return hit[1]
    from market.yfinance_provider import yf_get_ohlcv

    bars: List[Dict[str, Any]] = []
    for attempt in range(2):
        bars = yf_get_ohlcv(symbol) or []
        if len(bars) >= 30:
            break
        time.sleep(1.0 * (attempt + 1))
    if len(bars) < 30:
        try:
            bars = _yahoo_chart_bars(symbol)
        except Exception as e:
            logger.info("[Alerts] direct Yahoo chart fallback failed for %s: %s", symbol, e)
    if len(bars) >= 30:
        _BARS_CACHE[symbol] = (now, bars)
        return bars
    if hit and now - hit[0] < _BARS_STALE_MAX_SEC:  # serve last good data rather than nothing
        return hit[1]
    return bars


def check_price_action(symbol: str) -> List[Dict[str, Any]]:
    bars = _get_bars(symbol)
    if len(bars) < 30:
        raise RuntimeError(f"only {len(bars)} price bars available")
    closes = [b["close"] for b in bars]
    highs = [b["high"] for b in bars]
    lows = [b["low"] for b in bars]
    vols = [b.get("volume") or 0 for b in bars]
    last, prev = closes[-1], closes[-2]
    out: List[Dict[str, Any]] = []
    src = "Price history (Yahoo Finance)"

    # 1. Day move
    chg = (last / prev - 1) * 100
    if chg <= -5:
        out.append(_a("error", "Sharp price drop", f"{symbol} is down {abs(chg):.1f}% today (₹{last:,.2f}).", "Price", src))
    elif chg <= -3:
        out.append(_a("warn", "Price falling", f"{symbol} is down {abs(chg):.1f}% today (₹{last:,.2f}).", "Price", src))
    elif chg >= 5:
        out.append(_a("warn", "Sharp rally", f"{symbol} is up {chg:.1f}% today (₹{last:,.2f}) — check for a news trigger before chasing.", "Price", src))
    elif chg >= 3:
        out.append(_a("info", "Strong move up", f"{symbol} is up {chg:.1f}% today (₹{last:,.2f}).", "Price", src))

    # 2. Opening gap
    gap = (bars[-1]["open"] / prev - 1) * 100
    if abs(gap) >= 2:
        out.append(_a("info", f"Gap {'up' if gap > 0 else 'down'} at open",
                      f"Opened {abs(gap):.1f}% {'above' if gap > 0 else 'below'} the previous close.", "Price", src))

    # 3. 52-week range (last ~252 sessions)
    win_h, win_l = max(highs[-252:]), min(lows[-252:])
    if last >= win_h * 0.995:
        out.append(_a("info", "At 52-week high", f"Trading at ₹{last:,.2f}, at/near its 52-week high of ₹{win_h:,.2f}.", "Price", src))
    elif last >= win_h * 0.97:
        out.append(_a("info", "Near 52-week high", f"{(1 - last / win_h) * 100:.1f}% below its 52-week high of ₹{win_h:,.2f}.", "Price", src))
    if last <= win_l * 1.005:
        out.append(_a("error", "At 52-week low", f"Trading at ₹{last:,.2f}, at/near its 52-week low of ₹{win_l:,.2f}.", "Price", src))
    elif last <= win_l * 1.03:
        out.append(_a("warn", "Near 52-week low", f"Only {(last / win_l - 1) * 100:.1f}% above its 52-week low of ₹{win_l:,.2f}.", "Price", src))

    # 4. Volume spike vs prior 20-session average
    avg20 = sum(vols[-21:-1]) / 20 if len(vols) >= 21 else 0
    if avg20 > 0 and vols[-1] >= 2 * avg20:
        out.append(_a("info", "Unusual volume", f"Volume is {vols[-1] / avg20:.1f}× the 20-day average ({vols[-1]:,.0f} shares).", "Price", src))

    # 5. RSI
    rsi = _rsi(closes)
    if rsi is not None:
        if rsi >= 70:
            out.append(_a("warn", "Overbought (RSI)", f"RSI(14) is {rsi:.0f} — momentum is stretched; pullback risk is higher.", "Technical", src))
        elif rsi <= 30:
            out.append(_a("warn", "Oversold (RSI)", f"RSI(14) is {rsi:.0f} — heavy selling; watch for a bounce or further weakness.", "Technical", src))

    # 6. Moving averages
    sma200 = _sma(closes, 200)
    if sma200 and last < sma200:
        out.append(_a("warn", "Below 200-DMA", f"Price ₹{last:,.2f} is {(1 - last / sma200) * 100:.1f}% below the 200-day average (₹{sma200:,.2f}) — long-term trend is weak.", "Technical", src))
    if len(closes) >= 206:
        def _diff(end):
            s50, s200 = _sma(closes, 50, end), _sma(closes, 200, end)
            return None if s50 is None or s200 is None else s50 - s200
        now_d, old_d = _diff(len(closes)), _diff(len(closes) - 5)
        if now_d is not None and old_d is not None:
            if old_d <= 0 < now_d:
                out.append(_a("info", "Golden cross", "The 50-day average crossed above the 200-day average in the last 5 sessions (bullish signal).", "Technical", src))
            elif old_d >= 0 > now_d:
                out.append(_a("warn", "Death cross", "The 50-day average crossed below the 200-day average in the last 5 sessions (bearish signal).", "Technical", src))
    return out


# ── Derivatives ─────────────────────────────────────────────────────────────

def check_options(symbol: str) -> List[Dict[str, Any]]:
    from market.nse_client import nse_client

    chain = nse_client.get_option_chain(symbol)
    rows = ((chain or {}).get("records") or {}).get("data") or []
    if not rows:
        raise RuntimeError("no option chain (symbol may not be F&O listed)")
    ce = sum((r.get("CE") or {}).get("openInterest") or 0 for r in rows)
    pe = sum((r.get("PE") or {}).get("openInterest") or 0 for r in rows)
    if ce <= 0:
        raise RuntimeError("zero call open interest")
    pcr = pe / ce
    src = "NSE option chain"
    if pcr >= 1.3:
        return [_a("warn", "High put-call ratio", f"PCR is {pcr:.2f} — heavy put positioning; traders are hedging or expecting downside.", "Derivatives", src)]
    if pcr <= 0.7:
        return [_a("warn", "Low put-call ratio", f"PCR is {pcr:.2f} — call-heavy positioning; limited downside hedging, so sentiment may be stretched.", "Derivatives", src)]
    return []


# ── Market-wide ─────────────────────────────────────────────────────────────

def check_vix(symbol: str) -> List[Dict[str, Any]]:
    from market.nse_client import nse_client

    now = datetime.now()
    rows = nse_client.get_vix_history((now - timedelta(days=12)).strftime("%d-%m-%Y"), now.strftime("%d-%m-%Y")) or []
    if not rows:
        raise RuntimeError("no VIX data")
    last = rows[-1]
    close = _num(last.get("EOD_CLOSE_INDEX_VAL"))
    pct = _num(last.get("VIX_PERC_CHG")) or 0.0
    out: List[Dict[str, Any]] = []
    src = "NSE India VIX"
    if close is not None and close >= 20:
        out.append(_a("error", "Market volatility very high", f"India VIX is {close:.1f} — expect large swings across all stocks.", "Market", src))
    elif close is not None and close >= 16:
        out.append(_a("warn", "Elevated market volatility", f"India VIX is {close:.1f} (above its calm range of ~12–15).", "Market", src))
    if pct >= 7:
        out.append(_a("warn", "Volatility spike", f"India VIX jumped {pct:.1f}% in the last session ({close:.1f}).", "Market", src))
    return out


def check_flows(symbol: str) -> List[Dict[str, Any]]:
    from market.nse_client import nse_client

    rows = nse_client.get_fii_dii() or []
    rows = [r for r in rows if r.get("fii_net_cr") is not None]
    if not rows:
        raise RuntimeError("no FII/DII data")
    r = rows[0]
    fii, dii, date = r["fii_net_cr"], r.get("dii_net_cr"), r.get("date")
    src = "NSE FII/DII activity"
    dii_txt = f", DIIs {'bought' if (dii or 0) >= 0 else 'sold'} ₹{abs(dii or 0):,.0f} Cr" if dii is not None else ""
    if fii <= -5000:
        return [_a("error", "Heavy FII selling", f"FIIs net sold ₹{abs(fii):,.0f} Cr on {date}{dii_txt}.", "Market", src)]
    if fii <= -2000:
        return [_a("warn", "FII net selling", f"FIIs net sold ₹{abs(fii):,.0f} Cr on {date}{dii_txt}.", "Market", src)]
    if fii >= 2000:
        return [_a("info", "FII net buying", f"FIIs net bought ₹{fii:,.0f} Cr on {date}{dii_txt}.", "Market", src)]
    return []


# ── Ownership ───────────────────────────────────────────────────────────────

def check_ownership(symbol: str) -> List[Dict[str, Any]]:
    from market.nse_client import nse_client

    rows = nse_client.get_shareholding(symbol) or []

    def _d(r):
        try:
            return datetime.strptime(str(r.get("date")).title(), "%d-%b-%Y")
        except ValueError:
            return datetime.min

    rows = sorted([r for r in rows if _num(r.get("pr_and_prgrp")) is not None], key=_d, reverse=True)
    if not rows:
        raise RuntimeError("no shareholding rows")
    cur = _num(rows[0]["pr_and_prgrp"])
    quarter = rows[0].get("date")
    src = "NSE shareholding pattern"
    out: List[Dict[str, Any]] = []
    if len(rows) > 1:
        delta = cur - _num(rows[1]["pr_and_prgrp"])
        if delta <= -1.0:
            out.append(_a("warn", "Promoter stake reduced", f"Promoter holding fell {abs(delta):.2f} pts to {cur:.2f}% in the {quarter} quarter.", "Ownership", src))
        elif delta >= 1.0:
            out.append(_a("info", "Promoter stake increased", f"Promoter holding rose {delta:.2f} pts to {cur:.2f}% in the {quarter} quarter.", "Ownership", src))
    if cur < 25 and not out:
        out.append(_a("info", "Low promoter holding", f"Promoters hold only {cur:.2f}% ({quarter}); common in professionally-run firms but means less insider alignment.", "Ownership", src))
    return out


# ── Events ──────────────────────────────────────────────────────────────────

def _parse_day(s: Any) -> Optional[datetime]:
    for fmt in ("%d-%b-%Y", "%d-%B-%Y", "%Y-%m-%d", "%d-%m-%Y"):
        try:
            return datetime.strptime(str(s).strip().title(), fmt)
        except ValueError:
            continue
    return None


def check_events(symbol: str) -> List[Dict[str, Any]]:
    from market.nse_client import nse_client

    out: List[Dict[str, Any]] = []
    today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)

    meetings = nse_client.get_board_meetings(symbol) or []
    upcoming = []
    for m in meetings:
        d = _parse_day(m.get("bm_date"))
        if d and d >= today:
            upcoming.append((d, m))
    if upcoming:
        d, m = min(upcoming, key=lambda x: x[0])
        days = (d - today).days
        desc = (m.get("bm_desc") or m.get("bm_purpose") or "").lower()
        what = "Financial results" + (" & dividend" if "dividend" in desc else "") if "result" in desc else (m.get("bm_purpose") or "Board meeting")
        when = "today" if days == 0 else f"in {days} day{'s' if days != 1 else ''}"
        sev = "warn" if days <= 7 else "info"
        out.append(_a(sev, f"{what} {when}", f"Board meeting on {d:%d %b %Y}: {m.get('bm_purpose', '')}. Volatility often rises around results.", "Events", "NSE board meetings"))

    actions = nse_client.get_actions(symbol) or []
    for act in actions:
        d = _parse_day(act.get("exDate"))
        if d and 0 <= (d - today).days <= 14:
            out.append(_a("info", "Upcoming ex-date", f"{act.get('subject', 'Corporate action')} — ex-date {d:%d %b %Y}.", "Events", "NSE corporate actions"))
            break
    return out


def check_deals(symbol: str) -> List[Dict[str, Any]]:
    from market.bulk_deals import get_deals_for_symbol

    deals = get_deals_for_symbol(symbol, days=7) or []
    if not deals:
        return []
    buy = sum(d.quantity for d in deals if d.deal_type == "BUY")
    sell = sum(d.quantity for d in deals if d.deal_type == "SELL")
    big = max(deals, key=lambda d: d.quantity * d.price)
    net = "net buying" if buy > sell else "net selling" if sell > buy else "balanced"
    return [_a("info", f"{len(deals)} bulk/block deal{'s' if len(deals) != 1 else ''} this week",
               f"{net.capitalize()} ({buy:,} bought vs {sell:,} sold). Largest: {big.client.title()} {big.deal_type.lower()} {big.quantity:,} @ ₹{big.price:,.2f}.",
               "Events", "NSE bulk & block deals")]


# ── News & filings ──────────────────────────────────────────────────────────

_CRITICAL = re.compile(r"\b(fraud|default(?:ed|s)?|insolvency|bankruptcy|raid(?:s|ed)?|arrest(?:ed)?|probe|scam|suspend(?:ed)?|delist(?:ing|ed)?|forensic|show[- ]cause|ed notice|cbi)\b", re.I)
_WARNING = re.compile(r"\b(penalty|penalis\w+|fine[sd]?|resign\w*|downgrade[sd]?|litigation|lawsuit|tax demand|auditor|cuts? target|plunge[sd]?|slump\w*|tumbl\w+|crash\w*|sebi (?:order|notice)|notice from|slashes|profit warning|miss(?:es|ed)? estimates)\b", re.I)
_POSITIVE = re.compile(r"\b(bags?|wins?|secures?|order win|new order|large deal|acquisition|acquires?|upgrade[sd]?|buyback|bonus issue|record (?:high|profit|revenue)|beats? estimates|raises? guidance|dividend|stock split)\b", re.I)


def _age_hours(item) -> Optional[float]:
    from market.news import parse_publication_date

    dt = parse_publication_date(getattr(item, "published", ""))
    if not dt:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - dt).total_seconds() / 3600


def check_news_risk(symbol: str) -> List[Dict[str, Any]]:
    from market.news import get_canonical_stock_news

    res = get_canonical_stock_news(symbol, n=15)
    items = list(res.get("announcements", [])) + list(res.get("news", []))
    out: List[Dict[str, Any]] = []
    seen = set()
    recent_filings = 0
    for it in items:
        age = _age_hours(it)
        if age is None or age > 72:
            continue
        if getattr(it, "source", "") in ("NSE", "BSE") and age <= 24:
            recent_filings += 1
        title = (getattr(it, "title", "") or "").strip()
        key = title.lower()[:60]
        if not title or key in seen:
            continue
        publisher = getattr(it, "publisher", "") or getattr(it, "source", "") or "News"
        text = f"{title} {getattr(it, 'summary', '')}"
        if _CRITICAL.search(text):
            sev, head = "error", "Critical headline"
        elif _WARNING.search(title):
            sev, head = "warn", "Risk headline"
        elif _POSITIVE.search(title):
            sev, head = "info", "Positive catalyst"
        else:
            continue
        seen.add(key)
        out.append(_a(sev, head, f"{title} — {publisher}", "News", publisher))
    # keep the most important few
    out.sort(key=lambda a: _SEV_ORDER[a["type"]])
    out = out[:4]
    if recent_filings >= 3:
        out.append(_a("info", "Burst of exchange filings", f"{recent_filings} NSE/BSE filings for {symbol} in the last 24 hours — review the News tab.", "News", "NSE/BSE"))
    return out


# ── SEBI Shield Regulatory Sanctions ───────────────────────────────────────

def check_regulatory_sebi(symbol: str) -> List[Dict[str, Any]]:
    """Screen the ticker and company against SEBI, NSE, and RBI sanctions via SEBI Shield."""
    try:
        from market.sebi_shield import screen_sebi_shield

        res = screen_sebi_shield(symbol)
        if not res.get("clean") and res.get("matches"):
            out = []
            for m in res["matches"][:2]:
                reg = m.get("regulator") or "SEBI"
                act = m.get("action_type") or "Regulatory action"
                st = m.get("status") or "ACTIVE"
                order_num = m.get("order_number")
                order_str = f" [Order: {order_num}]" if order_num else ""
                desc = m.get("description") or f"Listed in {reg} enforcement orders."
                ent = m.get("entity_name") or symbol
                out.append(_a(
                    "danger" if st == "ACTIVE" else "warning",
                    f"{reg} Regulatory Action: {act}",
                    f"{ent}: {desc}{order_str} (Status: {st})",
                    "Regulatory",
                    f"SEBI Shield ({reg})",
                ))
            return out
    except Exception as exc:
        logger.debug("[Alerts] SEBI Shield check failed for %s: %s", symbol, exc)
    return []


# ── Orchestrator ────────────────────────────────────────────────────────────

_CHECKS: Dict[str, Callable[[str], List[Dict[str, Any]]]] = {
    "price_action": check_price_action,
    "options": check_options,
    "vix": check_vix,
    "fii_dii": check_flows,
    "ownership": check_ownership,
    "events": check_events,
    "bulk_deals": check_deals,
    "news_risk": check_news_risk,
    "regulatory_sebi": check_regulatory_sebi,
}


def build_alerts(symbol: str) -> Dict[str, Any]:
    """Run every check concurrently (bounded by a deadline) and return ranked alerts."""
    sym = symbol.upper().strip().replace(".NS", "").replace(".BO", "")
    now = time.time()
    with _cache_lock:
        hit = _cache.get(sym)
    if hit and now - hit[0] < _CACHE_TTL_SEC:
        return hit[1]

    alerts: List[Dict[str, Any]] = []
    checks: Dict[str, str] = {}
    ex = concurrent.futures.ThreadPoolExecutor(max_workers=len(_CHECKS))
    try:
        futures = {ex.submit(fn, sym): name for name, fn in _CHECKS.items()}
        deadline = time.monotonic() + _DEADLINE_SEC
        for fut, name in futures.items():
            try:
                found = fut.result(timeout=max(0.1, deadline - time.monotonic()))
                alerts.extend(found)
                checks[name] = "ok"
            except concurrent.futures.TimeoutError:
                checks[name] = "timeout"
            except Exception as e:  # one broken source must not break the panel
                checks[name] = f"unavailable: {str(e)[:80]}"
                logger.info("[Alerts] %s check for %s unavailable: %s", name, sym, e)
    finally:
        ex.shutdown(wait=False, cancel_futures=True)

    seen, unique = set(), []
    for a in sorted(alerts, key=lambda a: _SEV_ORDER.get(a["type"], 3)):
        k = (a["title"], a["message"][:40])
        if k not in seen:
            seen.add(k)
            unique.append(a)
    unique = unique[:_MAX_ALERTS]

    ok_count = sum(1 for v in checks.values() if v == "ok")
    if not unique and ok_count:
        unique.append(_a("info", "All clear", f"No active risk or momentum alerts for {sym} ({ok_count}/{len(checks)} checks ran).", "Status"))

    result = {
        "symbol": sym,
        "alerts": unique,
        "checks": checks,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    # Only cache when most checks ran, so a transient outage isn't pinned for 2 minutes.
    if ok_count >= max(1, len(checks) // 2):
        with _cache_lock:
            _cache[sym] = (now, result)
    return result
