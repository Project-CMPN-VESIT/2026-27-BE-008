"""
web/cyro_engine/tools/market_tools.py
───────────────────────────────────────
LangChain @tool wrappers for sector, FII/DII flows, options, and governance.

Tools provided:
  get_sector_peers         — Peer companies with comparative metrics
  get_fii_dii_flows        — Foreign and domestic institutional flow data
  get_option_chain_summary — Options PCR, max pain, IV summary
  get_governance_report    — Promoter pledge, auditor fees, tax forensics
"""

from __future__ import annotations

import json

from langchain_core.tools import tool


@tool(parse_docstring=True)
def get_sector_peers(symbol: str) -> str:
    """
    Get sector peer companies and comparative fundamental metrics.

    Identifies the sector for the given stock and returns peer companies
    with PE, ROE, and margin data for relative valuation analysis.

    Args:
        symbol: NSE ticker (e.g. "INFY", "HDFCBANK")

    Returns:
        JSON string with peer list, sector name, and comparative metrics.
    """
    try:
        from analysis.fundamental import analyse

        snap = analyse(symbol)
        sector = snap.sector or "Unknown"
        industry = snap.industry or "Unknown"

        # Curated peer mapping for major Indian sectors
        SECTOR_PEERS: dict[str, list[str]] = {
            "Information Technology": ["TCS", "INFY", "WIPRO", "HCLTECH", "TECHM", "LTM", "PERSISTENT"],
            "Banking": ["HDFCBANK", "ICICIBANK", "SBIN", "KOTAKBANK", "AXISBANK", "INDUSINDBK"],
            "Financial Services": ["BAJFINANCE", "BAJAJFINSV", "MUTHOOTFIN", "CHOLAFIN", "SHRIRAMFIN"],
            "Consumer Cyclical": ["TITAN", "MARUTI", "TATAMOTORS", "M&M", "BAJAJ-AUTO", "EICHERMOT"],
            "Consumer Defensive": ["HINDUNILVR", "ITC", "NESTLEIND", "BRITANNIA", "DABUR", "MARICO"],
            "Healthcare": ["SUNPHARMA", "CIPLA", "DRREDDY", "DIVISLAB", "APOLLOHOSP", "AUROPHARMA"],
            "Energy": ["RELIANCE", "ONGC", "BPCL", "IOC", "HINDPETRO", "GAIL"],
            "Basic Materials": ["TATASTEEL", "JSWSTEEL", "HINDALCO", "VEDL", "NATIONALUM"],
            "Industrials": ["LT", "SIEMENS", "ABB", "BHEL", "CUMMINSIND"],
            "Real Estate": ["DLF", "PRESTIGE", "SOBHA", "BRIGADE", "GODREJPROP"],
        }

        peers = SECTOR_PEERS.get(sector, [])
        if not peers:
            # Fallback: search if symbol is in any sector's peer list
            for sec_name, sec_peers in SECTOR_PEERS.items():
                if symbol.upper() in sec_peers:
                    sector = sec_name
                    peers = sec_peers
                    break
                    
        # Remove the subject ticker from peers list
        peers = [p for p in peers if p.upper() != symbol.upper()][:6]

        def _peer_row(peer_sym: str) -> dict:
            try:
                peer_snap = analyse(peer_sym)
                return {
                    "symbol": peer_sym,
                    "pe": peer_snap.pe,
                    "pb": peer_snap.pb,
                    "roe": peer_snap.roe,
                    "npm": peer_snap.npm,
                    "market_cap": peer_snap.market_cap,
                    "fundamental_score": peer_snap.score,
                }
            except Exception:
                return {"symbol": peer_sym, "error": "Data unavailable"}

        # Peers are independent network fetches: run them concurrently (was ~7 sequential calls),
        # preserving the original peer ordering.
        if peers:
            from concurrent.futures import ThreadPoolExecutor
            with ThreadPoolExecutor(max_workers=len(peers)) as pool:
                peer_data = list(pool.map(_peer_row, peers))
        else:
            peer_data = []

        return json.dumps({
            "symbol": symbol.upper(),
            "sector": sector,
            "industry": industry,
            "subject_metrics": {
                "pe": snap.pe,
                "pb": snap.pb,
                "roe": snap.roe,
                "npm": snap.npm,
                "market_cap": snap.market_cap,
            },
            "peers": peer_data,
            "source": "analysis.fundamental (Screener.in / yfinance) — curated peer map",
            "evidence_type": "trusted_secondary",
        }, default=str)

    except Exception as e:
        return json.dumps({"error": str(e), "symbol": symbol.upper()})


@tool(parse_docstring=True)
def get_fii_dii_flows() -> str:
    """
    Get recent FII (Foreign Institutional Investor) and DII (Domestic Institutional)
    daily net buy/sell flows in Indian equity markets.

    FII outflows + DII inflows is a typical defensive pattern.
    Both buying together is a strong bullish signal.

    Returns:
        JSON string with last 10 trading days of FII/DII activity in ₹ Crores.
    """
    try:
        from market.nse_client import nse_client

        flows = nse_client.get_fii_dii()
        if not flows:
            return json.dumps({
                "error": "FII/DII data unavailable",
                "source": "NSE FII/DII API",
                "hint": "NSE session may have expired — restart CYRO engine",
            })

        # Compute net trend
        recent = flows[:10]
        fii_net_total = sum(r.get("fii_net_cr") or 0 for r in recent)
        dii_net_total = sum(r.get("dii_net_cr") or 0 for r in recent)

        if fii_net_total > 1000 and dii_net_total > 1000:
            sentiment = "BULLISH — Both FII and DII are net buyers"
        elif fii_net_total < -1000 and dii_net_total > 1000:
            sentiment = "DEFENSIVE — FII selling, DII supporting market"
        elif fii_net_total > 1000 and dii_net_total < -1000:
            sentiment = "FII-DRIVEN — FII buying, DII booking profits"
        elif fii_net_total < -1000 and dii_net_total < -1000:
            sentiment = "BEARISH — Both FII and DII net sellers"
        else:
            sentiment = "NEUTRAL — Mixed institutional flows"

        return json.dumps({
            "last_10_days_summary": {
                "fii_net_cr": round(fii_net_total, 0),
                "dii_net_cr": round(dii_net_total, 0),
                "sentiment": sentiment,
            },
            "daily_data": recent,
            "source": "NSE FII/DII Activity Report",
            "evidence_type": "official_market_data",
        }, default=str)
    except Exception as e:
        return json.dumps({"error": str(e), "source": "NSE FII/DII"})


@tool(parse_docstring=True)
def get_option_chain_summary(symbol: str) -> str:
    """
    Get a summary of the options chain for an NSE stock or index.

    Returns Put-Call Ratio (PCR), maximum pain strike, near ATM IV,
    and top OI buildup strikes to assess market sentiment and positioning.

    Args:
        symbol: NSE ticker or index (e.g. "NIFTY", "BANKNIFTY", "INFY")

    Returns:
        JSON string with PCR, max pain, IV, and key OI levels.
    """
    try:
        from market.nse_client import nse_client

        chain = nse_client.get_option_chain(symbol)
        if not chain:
            return json.dumps({
                "error": f"Option chain unavailable for {symbol}",
                "symbol": symbol.upper(),
                "source": "NSE Option Chain",
                "hint": "Options may not be available for this symbol",
            })

        # Try to extract key metrics
        filtered = chain.get("filtered") or chain.get("data") or {}
        records = filtered.get("data") or (chain.get("records", {}).get("data") or [])

        total_ce_oi = 0
        total_pe_oi = 0
        ce_oi_by_strike: dict[float, int] = {}
        pe_oi_by_strike: dict[float, int] = {}

        for rec in records if isinstance(records, list) else []:
            strike = rec.get("strikePrice", 0)
            ce = rec.get("CE") or {}
            pe = rec.get("PE") or {}
            ce_oi = ce.get("openInterest", 0) or 0
            pe_oi = pe.get("openInterest", 0) or 0
            total_ce_oi += ce_oi
            total_pe_oi += pe_oi
            if ce_oi:
                ce_oi_by_strike[strike] = ce_oi
            if pe_oi:
                pe_oi_by_strike[strike] = pe_oi

        pcr = round(total_pe_oi / total_ce_oi, 2) if total_ce_oi else None

        # Max pain: strike where total OI loss (put writers + call writers) is minimum
        max_pain_strike = None
        if ce_oi_by_strike and pe_oi_by_strike:
            all_strikes = sorted(set(ce_oi_by_strike) | set(pe_oi_by_strike))
            if all_strikes:
                max_pain_strike = min(
                    all_strikes,
                    key=lambda s: (
                        sum(max(0, s - k) * v for k, v in ce_oi_by_strike.items()) +
                        sum(max(0, k - s) * v for k, v in pe_oi_by_strike.items())
                    )
                )

        top_ce_strikes = sorted(ce_oi_by_strike.items(), key=lambda x: x[1], reverse=True)[:3]
        top_pe_strikes = sorted(pe_oi_by_strike.items(), key=lambda x: x[1], reverse=True)[:3]

        interpretation = []
        if pcr:
            if pcr > 1.3:
                interpretation.append(f"PCR={pcr:.2f}: Bearish sentiment (heavy put buying)")
            elif pcr < 0.7:
                interpretation.append(f"PCR={pcr:.2f}: Bullish sentiment (heavy call buying)")
            else:
                interpretation.append(f"PCR={pcr:.2f}: Neutral positioning")

        return json.dumps({
            "symbol": symbol.upper(),
            "pcr": pcr,
            "max_pain_strike": max_pain_strike,
            "total_ce_oi": total_ce_oi,
            "total_pe_oi": total_pe_oi,
            "top_call_resistance": [{"strike": s, "oi": o} for s, o in top_ce_strikes],
            "top_put_support": [{"strike": s, "oi": o} for s, o in top_pe_strikes],
            "interpretation": interpretation,
            "source": "NSE Option Chain",
            "evidence_type": "official_market_data",
        }, default=str)
    except Exception as e:
        return json.dumps({"error": str(e), "symbol": symbol.upper()})


@tool(parse_docstring=True)
def get_governance_report(symbol: str) -> str:
    """
    Run governance forensics analysis for an NSE stock.

    Checks:
      1. Promoter pledge level and trend (increase = distress signal)
      2. Auditor fee anomaly detection and annual report link
      3. Effective tax rate vs statutory 25.17% (deviation = red flag)

    Args:
        symbol: NSE ticker (e.g. "INFY", "RCOM")

    Returns:
        JSON string with risk score, risk label, individual flags, and findings.
    """
    try:
        from analysis.governance import full_governance_report

        report = full_governance_report(symbol)
        flags_data = [
            {
                "metric": f.metric,
                "value": f.value,
                "severity": f.severity,
                "finding": f.finding,
                "evidence_hint": f.evidence_hint,
            }
            for f in report.flags
        ]

        return json.dumps({
            "symbol": report.symbol,
            "risk_score": report.risk_score,
            "risk_label": report.risk_label,
            "summary": report.summary,
            "flags": flags_data,
            "pledge": {
                "current_pct": report.pledge.current_pledge_pct if report.pledge else None,
                "prior_pct": report.pledge.prior_pledge_pct if report.pledge else None,
                "delta_pct": report.pledge.delta_pct if report.pledge else None,
                "severity": report.pledge.severity if report.pledge else None,
            },
            "tax_anomaly": {
                "effective_tax_rate": report.tax_anomaly.effective_tax_rate if report.tax_anomaly else None,
                "deviation_pct": report.tax_anomaly.deviation_pct if report.tax_anomaly else None,
                "anomaly_detected": report.tax_anomaly.anomaly_detected if report.tax_anomaly else None,
            },
            "source": "analysis.governance (pledge: NSE, tax: yfinance income_stmt)",
            "evidence_type": "calculated",
        }, default=str)
    except Exception as e:
        return json.dumps({"error": str(e), "symbol": symbol.upper()})
