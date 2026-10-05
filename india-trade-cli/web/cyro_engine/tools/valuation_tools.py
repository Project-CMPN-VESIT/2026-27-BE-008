"""
web/cyro_engine/tools/valuation_tools.py
─────────────────────────────────────────
LangChain @tool wrappers for valuation and financial analysis.

Tools provided:
  run_dcf_valuation       — 2-stage DCF with WACC computation
  compute_graham_number   — Benjamin Graham intrinsic value formula
  compute_pe_premium      — PE premium/discount vs historical median
  get_fundamental_snapshot — Full FundamentalSnapshot as structured dict
  compute_financial_health — Piotroski, Altman Z, DuPont, CFO/EBITDA composite

All tools return JSON-serializable dicts with a 'source' and 'symbol' key
so CYRO agents can register outputs as 'calculated' EvidenceItems.
"""

from __future__ import annotations

import json
import math
from typing import Optional

from langchain_core.tools import tool


@tool(parse_docstring=True)
def run_dcf_valuation(
    symbol: str,
    growth_rate: float = 12.0,
    wacc: Optional[float] = None,
) -> str:
    """
    Run a 2-stage Discounted Cash Flow (DCF) valuation for an NSE stock.

    Uses the existing analysis.dcf engine which computes WACC from beta,
    projects 5 years of FCF at the specified growth rate, then applies
    a Gordon Growth Model terminal value.

    Args:
        symbol: NSE ticker symbol (e.g. "INFY", "RELIANCE")
        growth_rate: Stage 1 FCF growth rate assumption in % (default 12%)
        wacc: Override WACC in % (default: auto-computed from beta and D/E)

    Returns:
        JSON string with intrinsic_value_per_share, margin_of_safety_pct,
        wacc_used, terminal_growth, assumptions, and source metadata.
    """
    try:
        from analysis.dcf import compute_wacc, compute_dcf_value
        from analysis.fundamental import analyse

        snap = analyse(symbol)
        beta = snap.beta or 1.0
        d_e = snap.debt_equity or 0.0

        effective_wacc = wacc if wacc is not None else compute_wacc(beta=beta, debt_equity=d_e)

        result = compute_dcf_value(
            symbol=symbol,
            growth_rate=growth_rate,
            wacc=effective_wacc,
        )

        if result is None:
            return json.dumps({
                "error": "DCF computation failed — insufficient financial data",
                "symbol": symbol.upper(),
                "source": "analysis.dcf",
            })

        return json.dumps({
            "symbol": symbol.upper(),
            "intrinsic_value_per_share": getattr(result, "intrinsic_value", None),
            "current_price": getattr(result, "current_price", None),
            "margin_of_safety_pct": getattr(result, "margin_of_safety", None),
            "wacc_used": round(effective_wacc, 2),
            "growth_rate_used": growth_rate,
            "terminal_growth": 4.0,
            "projection_years": 5,
            "source": "analysis.dcf (2-stage DCF + Gordon Growth Model)",
            "evidence_type": "calculated",
        }, default=str)

    except Exception as e:
        return json.dumps({"error": str(e), "symbol": symbol.upper(), "source": "analysis.dcf"})


@tool(parse_docstring=True)
def compute_graham_number(symbol: str) -> str:
    """
    Compute Benjamin Graham's intrinsic value formula for an NSE stock.

    Graham Number = sqrt(22.5 × EPS × Book Value Per Share)
    This provides a conservative 'floor price' for value investors.

    Args:
        symbol: NSE ticker symbol (e.g. "INFY", "HDFCBANK")

    Returns:
        JSON string with graham_number, current_price, discount_pct,
        eps_used, bvps_used, and interpretation.
    """
    try:
        from analysis.fundamental import analyse

        snap = analyse(symbol)
        result: dict = {"symbol": symbol.upper(), "source": "analysis.fundamental (Graham Number)"}

        # EPS proxy from PE and price
        cmp = None
        eps: Optional[float] = None

        # Use yfinance for current price via fundamental snapshot
        if snap.week52_high and snap.week52_low:
            cmp = (snap.week52_high + snap.week52_low) / 2  # mid-year price proxy

        if snap.pe and snap.pe > 0 and cmp:
            eps = round(cmp / snap.pe, 2)

        # Book value per share = Price / PB
        bvps: Optional[float] = None
        if snap.pb and snap.pb > 0 and cmp:
            bvps = round(cmp / snap.pb, 2)

        if eps and bvps and eps > 0 and bvps > 0:
            graham_number = round(math.sqrt(22.5 * eps * bvps), 2)
            discount = round((graham_number - cmp) / cmp * 100, 1) if cmp else None
            result.update({
                "graham_number": graham_number,
                "current_price_proxy": cmp,
                "discount_pct": discount,
                "eps_used": eps,
                "bvps_used": bvps,
                "pe_used": snap.pe,
                "pb_used": snap.pb,
                "interpretation": (
                    "Stock is UNDERVALUED vs Graham Number" if discount and discount > 0
                    else "Stock is OVERVALUED vs Graham Number"
                ),
                "evidence_type": "calculated",
            })
        else:
            result["error"] = "Insufficient data for Graham Number (need PE and PB)"

        return json.dumps(result, default=str)
    except Exception as e:
        return json.dumps({"error": str(e), "symbol": symbol.upper()})


@tool(parse_docstring=True)
def compute_pe_premium(symbol: str) -> str:
    """
    Compute PE premium or discount vs historical median and sector peers.

    Provides context on whether the current valuation multiple is stretched
    or compressed relative to the company's own history and sector average.

    Args:
        symbol: NSE ticker symbol (e.g. "TCS", "RELIANCE")

    Returns:
        JSON string with current_pe, sector_median_pe, premium_discount_pct,
        verdict (PREMIUM/DISCOUNT/FAIR), and analyst target implied PE.
    """
    try:
        from analysis.fundamental import analyse

        snap = analyse(symbol)
        result: dict = {"symbol": symbol.upper(), "source": "analysis.fundamental (PE analysis)"}

        current_pe = snap.pe
        forward_pe = snap.forward_pe
        sector = snap.sector

        # Sector PE benchmarks (India-specific, curated from historical averages)
        SECTOR_MEDIAN_PE: dict[str, float] = {
            "Information Technology": 25.0,
            "Financial Services": 18.0,
            "Banking": 15.0,
            "Consumer Cyclical": 35.0,
            "Consumer Defensive": 40.0,
            "Healthcare": 28.0,
            "Energy": 12.0,
            "Basic Materials": 14.0,
            "Industrials": 22.0,
            "Real Estate": 20.0,
            "Utilities": 16.0,
            "Communication Services": 20.0,
        }

        sector_median = SECTOR_MEDIAN_PE.get(sector or "", 22.0)  # India market median ~22x

        premium_disc: Optional[float] = None
        verdict = "UNAVAILABLE"

        if current_pe and current_pe > 0:
            premium_disc = round((current_pe - sector_median) / sector_median * 100, 1)
            if premium_disc > 20:
                verdict = "PREMIUM (Expensive vs sector)"
            elif premium_disc > -10:
                verdict = "FAIR VALUE"
            else:
                verdict = "DISCOUNT (Cheap vs sector)"

        result.update({
            "current_pe": current_pe,
            "forward_pe": forward_pe,
            "sector": sector,
            "sector_median_pe": sector_median,
            "premium_discount_pct": premium_disc,
            "verdict": verdict,
            "analyst_target_upside_pct": snap.target_upside_pct,
            "analyst_count": snap.analyst_count,
            "analyst_rating": snap.analyst_rating,
            "evidence_type": "calculated",
        })

        return json.dumps(result, default=str)
    except Exception as e:
        return json.dumps({"error": str(e), "symbol": symbol.upper()})


@tool(parse_docstring=True)
def get_fundamental_snapshot(symbol: str) -> str:
    """
    Retrieve a comprehensive fundamental snapshot for an NSE stock.

    Fetches PE, PB, ROE, ROCE, NPM, D/E, FCF, promoter holding, pledge %,
    dividend yield, market cap, 52-week range, sector, and analyst consensus.

    Data sources: Screener.in (primary) → yfinance (fallback).

    Args:
        symbol: NSE ticker symbol (e.g. "INFY", "BAJFINANCE")

    Returns:
        JSON string with all available fundamental metrics and data quality flags.
    """
    try:
        from analysis.fundamental import analyse

        snap = analyse(symbol)
        # Convert dataclass to dict
        data = {
            "symbol": snap.symbol,
            "name": snap.name,
            # Valuation
            "pe": snap.pe,
            "pb": snap.pb,
            "ev_ebitda": snap.ev_ebitda,
            "forward_pe": snap.forward_pe,
            # Profitability
            "roe": snap.roe,
            "roce": snap.roce,
            "npm": snap.npm,
            "operating_margin": snap.operating_margin,
            "ebitda_margin": snap.ebitda_margin,
            # Growth
            "sales_growth": snap.sales_growth,
            "profit_growth": snap.profit_growth,
            # Balance sheet health
            "debt_equity": snap.debt_equity,
            "current_ratio": snap.current_ratio,
            "interest_coverage": snap.interest_coverage,
            "free_cash_flow": snap.free_cash_flow,
            # Ownership
            "promoter_holding": snap.promoter_holding,
            "institutional_holding": snap.institutional_holding,
            "pledged_pct": snap.pledged_pct,
            # Market data
            "market_cap": snap.market_cap,
            "dividend_yield": snap.dividend_yield,
            "week52_high": snap.week52_high,
            "week52_low": snap.week52_low,
            "pct_from_52w_high": snap.pct_from_52w_high,
            "beta": snap.beta,
            # Analyst consensus
            "analyst_count": snap.analyst_count,
            "analyst_rating": snap.analyst_rating,
            "target_price_mean": snap.target_price_mean,
            "target_upside_pct": snap.target_upside_pct,
            # Classification
            "sector": snap.sector,
            "industry": snap.industry,
            # Scoring
            "fundamental_score": snap.score,
            "fundamental_verdict": snap.verdict,
            "flags": [
                {"metric": f.metric, "value": str(f.value), "verdict": f.verdict, "detail": f.detail}
                for f in snap.flags
            ],
            # Metadata
            "source": "Screener.in (primary) / yfinance (fallback)",
            "evidence_type": "trusted_secondary",
        }
        return json.dumps(data, default=str)
    except Exception as e:
        return json.dumps({"error": str(e), "symbol": symbol.upper()})


@tool(parse_docstring=True)
def compute_financial_health(symbol: str) -> str:
    """
    Run a comprehensive financial health analysis for an NSE stock.

    Computes:
      - Piotroski F-Score (0–9): profitability, leverage, efficiency signals
      - Altman Z-Score: bankruptcy probability zone (SAFE/GREY/DISTRESS)
      - DuPont ROE decomposition: identifies primary ROE driver
      - CFO-to-EBITDA: cash flow quality / earnings quality ratio

    Args:
        symbol: NSE ticker symbol (e.g. "INFY", "TATASTEEL")

    Returns:
        JSON string with composite health report, individual sub-scores, and verdict.
    """
    try:
        from analysis.financial_health import full_health_report

        report = full_health_report(symbol)
        data = {
            "symbol": report.symbol,
            "overall_verdict": report.overall_verdict,
            "overall_score": report.overall_score,
            "summary": report.summary,
            "piotroski": {
                "score": report.piotroski.score if report.piotroski else None,
                "label": report.piotroski.label if report.piotroski else None,
                "notes": report.piotroski.notes if report.piotroski else [],
            },
            "altman_z": {
                "z_score": report.altman.z_score if report.altman else None,
                "zone": report.altman.zone if report.altman else None,
                "notes": report.altman.notes if report.altman else [],
            },
            "dupont": {
                "roe": report.dupont.roe if report.dupont else None,
                "npm": report.dupont.net_profit_margin if report.dupont else None,
                "asset_turnover": report.dupont.asset_turnover if report.dupont else None,
                "equity_multiplier": report.dupont.equity_multiplier if report.dupont else None,
                "primary_driver": report.dupont.primary_driver if report.dupont else None,
            },
            "cash_flow_quality": {
                "ratio": report.cash_flow_quality.ratio if report.cash_flow_quality else None,
                "verdict": report.cash_flow_quality.verdict if report.cash_flow_quality else None,
            },
            "source": "analysis.financial_health (deterministic computation)",
            "evidence_type": "calculated",
        }
        return json.dumps(data, default=str)
    except Exception as e:
        return json.dumps({"error": str(e), "symbol": symbol.upper()})
