"""
web/cyro_engine/tools/data_tools.py
────────────────────────────────────
LangChain @tool wrappers for live market data, news, filings, and events.

Tools provided:
  get_live_quote           — Real-time NSE quote (price, volume, 52w range)
  get_news_for_ticker      — Recent news articles from news-feed microservice
  get_corporate_filings    — Exchange announcements and board meeting data
  get_shareholding_pattern — Promoter/FII/DII shareholding history
  get_bulk_block_deals     — Recent bulk/block deal activity
  get_earnings_calendar    — Board meeting dates and earnings schedule
"""

from __future__ import annotations

import json

from langchain_core.tools import tool


@tool(parse_docstring=True)
def get_live_quote(symbol: str) -> str:
    """
    Get live NSE market quote for a stock.

    Returns current price, previous close, % change, 52-week high/low,
    traded volume, and market cap context.

    Args:
        symbol: NSE ticker (e.g. "INFY", "NIFTY 50")

    Returns:
        JSON string with price data and source metadata.
    """
    try:
        from market.nse_client import nse_client

        quote = nse_client.get_quote(symbol)
        if not quote:
            return json.dumps({
                "error": f"No quote data for {symbol}",
                "symbol": symbol.upper(),
                "source": "NSE API",
            })

        # Normalize common field name variations
        price = (
            quote.get("lastPrice") or
            quote.get("ltp") or
            quote.get("last") or
            quote.get("close")
        )
        prev_close = quote.get("previousClose") or quote.get("prev_close")
        change_pct = quote.get("pChange") or quote.get("change_pct")
        volume = quote.get("totalTradedVolume") or quote.get("volume")
        w52_high = quote.get("weekHigh") or quote.get("yearHigh")
        w52_low = quote.get("weekLow") or quote.get("yearLow")

        return json.dumps({
            "symbol": symbol.upper(),
            "last_price": price,
            "prev_close": prev_close,
            "change_pct": change_pct,
            "total_traded_volume": volume,
            "week52_high": w52_high,
            "week52_low": w52_low,
            "raw": {k: v for k, v in quote.items() if k not in ("securityInfo",)},
            "source": "NSE live API",
            "evidence_type": "official_market_data",
        }, default=str)
    except Exception as e:
        return json.dumps({"error": str(e), "symbol": symbol.upper()})


@tool(parse_docstring=True)
def get_news_for_ticker(symbol: str, limit: int = 10) -> str:
    """
    Retrieve recent news articles tagged to a specific NSE ticker.

    Queries the FinPilot News Feed microservice (port 8002) which ingests
    RSS from MoneyControl, Economic Times, LiveMint, Business Standard.

    Args:
        symbol: NSE ticker (e.g. "RELIANCE", "HDFCBANK")
        limit: Maximum number of articles to return (default 10)

    Returns:
        JSON array of news items with title, source, published_at, url, summary.
    """
    try:
        import httpx

        resp = httpx.get(
            f"http://127.0.0.1:8002/v1/news/{symbol.upper()}",
            timeout=8,
        )
        if resp.status_code == 200:
            data = resp.json()
            articles = data.get("results") or data.get("articles") or [] if isinstance(data, dict) else (data if isinstance(data, list) else [])
            return json.dumps({
                "symbol": symbol.upper(),
                "count": len(articles),
                "articles": articles[:limit],
                "source": "FinPilot News Feed (port 8002)",
                "evidence_type": "trusted_secondary",
            }, default=str)
        else:
            return json.dumps({
                "error": f"News service returned {resp.status_code}",
                "symbol": symbol.upper(),
                "hint": "Ensure news-feed service is running on port 8002",
            })
    except Exception as e:
        # Fallback: try NSE announcements
        try:
            from market.nse_client import nse_client
            announcements = nse_client.get_announcements(symbol) or []
            return json.dumps({
                "symbol": symbol.upper(),
                "count": len(announcements[:limit]),
                "articles": announcements[:limit],
                "source": "NSE Announcements (news-feed fallback)",
                "evidence_type": "exchange_filing",
            }, default=str)
        except Exception as e2:
            return json.dumps({"error": f"News fetch failed: {e}; NSE fallback: {e2}", "symbol": symbol.upper()})


@tool(parse_docstring=True)
def get_corporate_filings(symbol: str, limit: int = 10) -> str:
    """
    Get recent corporate filings and exchange announcements for an NSE stock.

    Returns announcements, board meeting dates, and annual report links
    from NSE's corporate disclosure feed.

    Args:
        symbol: NSE ticker (e.g. "TCS", "BAJFINANCE")
        limit: Maximum number of filings to return (default 10)

    Returns:
        JSON string with announcements, board meetings, and annual report URLs.
    """
    try:
        from market.nse_client import nse_client

        announcements = nse_client.get_announcements(symbol) or []
        board_meetings = nse_client.get_board_meetings(symbol) or []
        annual_reports = nse_client.get_annual_reports(symbol) or []

        return json.dumps({
            "symbol": symbol.upper(),
            "announcements": announcements[:limit],
            "board_meetings": board_meetings[:5],
            "annual_report_urls": [
                r.get("fileName") or r.get("url") or r
                for r in annual_reports[:3]
            ],
            "source": "NSE Exchange Filings",
            "evidence_type": "exchange_filing",
        }, default=str)
    except Exception as e:
        return json.dumps({"error": str(e), "symbol": symbol.upper()})


@tool(parse_docstring=True)
def get_shareholding_pattern(symbol: str) -> str:
    """
    Retrieve quarterly shareholding pattern for an NSE stock.

    Returns promoter, FII, DII, public holding percentages with
    trend across up to 4 recent quarters.

    Args:
        symbol: NSE ticker (e.g. "HDFC", "SUNPHARMA")

    Returns:
        JSON string with quarterly holding data, pledge %, and trend commentary.
    """
    try:
        from market.nse_client import nse_client

        sh = nse_client.get_shareholding(symbol)
        if not sh:
            return json.dumps({
                "error": f"Shareholding data unavailable for {symbol}",
                "symbol": symbol.upper(),
                "source": "NSE Shareholding API",
            })

        return json.dumps({
            "symbol": symbol.upper(),
            "shareholding": sh,
            "source": "NSE Shareholding Pattern (XBRL)",
            "evidence_type": "exchange_filing",
        }, default=str)
    except Exception as e:
        return json.dumps({"error": str(e), "symbol": symbol.upper()})


@tool(parse_docstring=True)
def get_bulk_block_deals(symbol: str, days: int = 30) -> str:
    """
    Retrieve recent bulk and block deals for an NSE stock.

    Bulk deals: trades > 0.5% of listed shares.
    Block deals: large trades in the special 8:45–9:00 AM window.
    Tracks institutional (FII/MF/DII) and promoter buy/sell activity.

    Args:
        symbol: NSE ticker (e.g. "INFY", "RELIANCE")
        days: Lookback window in calendar days (default 30)

    Returns:
        JSON string with deals list, entity breakdown, and net buy/sell summary.
    """
    try:
        from market.bulk_deals import get_deals_for_symbol

        deals = get_deals_for_symbol(symbol, days=days)
        if not deals:
            return json.dumps({
                "symbol": symbol.upper(),
                "count": 0,
                "message": f"No bulk/block deals found in last {days} days",
                "source": "NSE Bulk/Block Deal API",
                "evidence_type": "official_market_data",
            })

        # Build summary
        buys = [d for d in deals if d.deal_type == "BUY"]
        sells = [d for d in deals if d.deal_type == "SELL"]
        entity_summary: dict[str, dict] = {}
        for d in deals:
            e = entity_summary.setdefault(d.entity_type, {"buy_qty": 0, "sell_qty": 0})
            if d.deal_type == "BUY":
                e["buy_qty"] += d.quantity
            else:
                e["sell_qty"] += d.quantity

        return json.dumps({
            "symbol": symbol.upper(),
            "period_days": days,
            "count": len(deals),
            "total_buys": len(buys),
            "total_sells": len(sells),
            "entity_breakdown": entity_summary,
            "deals": [
                {
                    "date": d.date,
                    "client": d.client,
                    "type": d.deal_type,
                    "qty": d.quantity,
                    "price": d.price,
                    "entity": d.entity_type,
                    "class": d.deal_class,
                }
                for d in deals[:20]  # cap at 20 most recent
            ],
            "source": "NSE Bulk/Block Deal API",
            "evidence_type": "official_market_data",
        }, default=str)
    except Exception as e:
        return json.dumps({"error": str(e), "symbol": symbol.upper()})


@tool(parse_docstring=True)
def get_earnings_calendar(symbol: str) -> str:
    """
    Get upcoming and recent earnings dates and board meeting schedule for a stock.

    Returns next earnings date, board meeting schedule, and recent quarterly
    results filing metadata from NSE.

    Args:
        symbol: NSE ticker (e.g. "INFY", "WIPRO")

    Returns:
        JSON string with earnings dates, board meetings, and results filing info.
    """
    try:
        from market.nse_client import nse_client
        from analysis.fundamental import analyse

        snap = analyse(symbol)
        board_meetings = nse_client.get_board_meetings(symbol) or []
        financial_results = nse_client.get_financial_results(symbol) or {}

        return json.dumps({
            "symbol": symbol.upper(),
            "next_earnings_date": snap.next_earnings_date,
            "earnings_estimate_eps": snap.earnings_estimate,
            "board_meetings": board_meetings[:5],
            "quarterly_results_meta": financial_results,
            "source": "NSE Board Meetings + analysis.fundamental",
            "evidence_type": "exchange_filing",
        }, default=str)
    except Exception as e:
        return json.dumps({"error": str(e), "symbol": symbol.upper()})


@tool(parse_docstring=True)
def screen_sebi_shield(symbol: str, company_name: str = "") -> str:
    """
    Screen an equity ticker and registered company against the SEBI Shield regulatory database.

    Checks SEBI, NSE, and RBI debarment registers and enforcement orders (1,600+ orders)
    via microservice (port 8000) with automatic zero-failure fallback to local SQLite.

    Args:
        symbol: NSE ticker (e.g. "RELIANCE", "INFY")
        company_name: Optional registered entity name (e.g. "Reliance Industries Limited")

    Returns:
        JSON string with screening verdict (clean: bool, sanction_status, matches, evidence_type).
    """
    try:
        from market.sebi_shield import screen_sebi_shield as _screen

        res = _screen(symbol, company_name=company_name or None)
        return json.dumps({
            "symbol": res.get("symbol", symbol.upper()),
            "company_name": res.get("company_name", ""),
            "clean": res.get("clean", True),
            "sanction_status": res.get("sanction_status", "CLEAN"),
            "matches_count": res.get("matches_count", 0),
            "matches": res.get("matches", []),
            "summary": res.get("summary", ""),
            "source": res.get("source", "SEBI Shield"),
            "evidence_type": "regulatory_sanction",
        }, default=str)
    except Exception as e:
        return json.dumps({
            "error": str(e),
            "symbol": symbol.upper(),
            "clean": True,
            "evidence_type": "regulatory_sanction",
        })
