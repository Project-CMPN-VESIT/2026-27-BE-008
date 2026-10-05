"""
web/cyro_engine/tools/risk_tools.py
────────────────────────────────────
LangChain @tool wrappers for risk metrics and macro analysis.

Tools provided:
  compute_var_for_symbol     — Historical VaR (95%, 99%), CVaR, max drawdown
  get_macro_snapshot         — USD/INR, Brent crude, Gold, US10Y, DXY
  get_stock_macro_sensitivity — Stock-specific macro factor sensitivity scores
"""

from __future__ import annotations

import json

from langchain_core.tools import tool


@tool(parse_docstring=True)
def compute_var_for_symbol(
    symbol: str,
    confidence: float = 0.95,
    lookback_days: int = 252,
) -> str:
    """
    Compute Value-at-Risk (VaR) and key risk metrics for a single NSE stock.

    Uses historical price returns to calculate:
      - 1-day VaR at 95% and 99% confidence levels
      - Conditional VaR (CVaR / Expected Shortfall)
      - Annualized volatility
      - Maximum drawdown over the lookback period
      - Beta vs NIFTY 50

    Args:
        symbol: NSE ticker (e.g. "INFY", "TATASTEEL")
        confidence: VaR confidence level (0.95 or 0.99, default 0.95)
        lookback_days: Historical lookback in trading days (default 252 = 1 year)

    Returns:
        JSON string with VaR, CVaR, volatility, max drawdown, and beta.
    """
    try:
        import numpy as np
        from market.yfinance_provider import yf_get_ohlcv

        # Fetch historical OHLCV data
        ohlcv = yf_get_ohlcv(symbol, period="1y")

        if not ohlcv or len(ohlcv) < 30:
            return json.dumps({
                "error": f"Insufficient price history for {symbol} ({len(ohlcv) if ohlcv else 0} bars)",
                "symbol": symbol.upper(),
                "source": "yfinance",
            })

        closes = np.array([bar["close"] for bar in ohlcv])
        returns = np.diff(closes) / closes[:-1]  # simple daily returns
        returns_arr = returns
        n = len(returns_arr)

        # Historical VaR
        sorted_returns = np.sort(returns_arr)
        var_95 = float(-np.percentile(returns_arr, 5))
        var_99 = float(-np.percentile(returns_arr, 1))

        # CVaR (Expected Shortfall at 95%)
        cutoff_95 = int(n * 0.05)
        cvar_95 = float(-np.mean(sorted_returns[:cutoff_95])) if cutoff_95 > 0 else var_95

        # Annualized volatility
        daily_vol = float(np.std(returns_arr))
        annual_vol = round(daily_vol * np.sqrt(252) * 100, 2)

        # Max drawdown
        cumulative = np.cumprod(1 + returns_arr)
        rolling_max = np.maximum.accumulate(cumulative)
        drawdown = (cumulative - rolling_max) / rolling_max
        max_drawdown = float(np.min(drawdown)) * 100

        # Beta vs NIFTY 50 (using yf_get_ohlcv)
        beta = None
        try:
            nifty_ohlcv = yf_get_ohlcv("NIFTY 50", period="1y")
            if nifty_ohlcv and len(nifty_ohlcv) >= 2:
                nifty_closes = np.array([bar["close"] for bar in nifty_ohlcv])
                nifty_returns = np.diff(nifty_closes) / nifty_closes[:-1]
                min_len = min(len(returns_arr), len(nifty_returns))
                if min_len >= 20:
                    r = returns_arr[-min_len:]
                    nr = nifty_returns[-min_len:]
                    cov = np.cov(r, nr)
                    beta = round(cov[0, 1] / cov[1, 1], 2) if cov[1, 1] != 0 else None
        except Exception:
            pass

        return json.dumps({
            "symbol": symbol.upper(),
            "lookback_days": n,
            "var_95_pct": round(var_95 * 100, 2),
            "var_99_pct": round(var_99 * 100, 2),
            "cvar_95_pct": round(cvar_95 * 100, 2),
            "annual_volatility_pct": annual_vol,
            "max_drawdown_pct": round(max_drawdown, 2),
            "beta_vs_nifty50": beta,
            "data_points": n,
            "source": "yfinance historical OHLCV (historical VaR)",
            "evidence_type": "calculated",
        }, default=str)

    except Exception as e:
        # Fallback to engine.risk_metrics if yfinance provider unavailable
        try:
            from engine.risk_metrics import compute_var
            result = compute_var(symbol, confidence=confidence)
            if result:
                return json.dumps({
                    "symbol": symbol.upper(),
                    "var_95_pct": result.var_95,
                    "var_99_pct": result.var_99,
                    "cvar_95_pct": result.cvar_95,
                    "annual_volatility_pct": result.volatility,
                    "source": "engine.risk_metrics",
                    "evidence_type": "calculated",
                }, default=str)
        except Exception:
            pass
        return json.dumps({"error": str(e), "symbol": symbol.upper()})


@tool(parse_docstring=True)
def get_macro_snapshot() -> str:
    """
    Get current macro indicators relevant to Indian equity markets.

    Fetches: USD/INR rate, Brent crude price, Gold price (USD/oz),
    US 10-year treasury yield, and the Dollar Index (DXY).

    These macro variables directly impact FII flows, import costs,
    export revenues, and sector rotation in the Indian market.

    Returns:
        JSON string with current macro levels and % changes.
    """
    try:
        from market.macro import get_macro_snapshot as _get_macro

        snap = _get_macro()
        if snap is None:
            return json.dumps({"error": "Macro data unavailable", "source": "market.macro"})

        return json.dumps({
            "usd_inr": snap.usdinr,
            "usd_inr_change_pct": snap.usdinr_change,
            "brent_crude_usd": snap.crude_oil,
            "brent_change_pct": snap.crude_change,
            "gold_usd_oz": snap.gold,
            "gold_change_pct": snap.gold_change,
            "us_10y_yield_pct": snap.us_10y,
            "us_10y_change_bps": snap.us_10y_change,
            "dollar_index_dxy": snap.dxy,
            "dxy_change_pct": snap.dxy_change,
            "source": "yfinance (forex + commodity real-time data)",
            "evidence_type": "official_market_data",
        }, default=str)
    except Exception as e:
        return json.dumps({"error": str(e), "source": "market.macro"})


@tool(parse_docstring=True)
def get_stock_macro_sensitivity(symbol: str) -> str:
    """
    Get the macro factor sensitivity scores for a specific NSE stock.

    Returns how sensitive the stock's returns are to:
      - USD/INR movements (positive = benefits from weak INR, e.g. IT exporters)
      - Crude oil price changes (negative = hurt by high oil, e.g. aviation)
      - Gold price changes (positive = gold stocks/jewelers)
      - US 10Y yield changes (negative = FII outflows with high US rates)

    Scores are directional coefficients in [-1.0, +1.0].
    Available for major Nifty 50/100 stocks. Falls back to sector average.

    Args:
        symbol: NSE ticker (e.g. "INFY", "INDIGO", "TITAN")

    Returns:
        JSON string with per-factor sensitivity scores and interpretation.
    """
    try:
        from market.macro import get_stock_macro_linkages

        linkages = get_stock_macro_linkages(symbol)
        if linkages is None:
            return json.dumps({
                "symbol": symbol.upper(),
                "message": "No specific linkage mapping. Using sector defaults.",
                "source": "market.macro",
            })

        # Build interpretations
        interpretations = []
        usd_inr = linkages.get("usdinr", 0)
        crude = linkages.get("crude_oil", 0)
        gold = linkages.get("gold", 0)
        us10y = linkages.get("us_10y", 0)

        if abs(usd_inr) > 0.3:
            interpretations.append(
                f"USD/INR: {'Benefits from weak INR (exporter)' if usd_inr > 0 else 'Hurt by weak INR (importer)'} (sensitivity={usd_inr:+.1f})"
            )
        if abs(crude) > 0.3:
            interpretations.append(
                f"Crude: {'Crude-linked upside' if crude > 0 else 'High crude = input cost risk'} (sensitivity={crude:+.1f})"
            )
        if abs(gold) > 0.3:
            interpretations.append(
                f"Gold: {'Benefits from rising gold' if gold > 0 else 'Hurt by rising gold'} (sensitivity={gold:+.1f})"
            )
        if abs(us10y) > 0.2:
            interpretations.append(
                f"US 10Y: {'Positive rate sensitivity' if us10y > 0 else 'FII outflows when US yields rise'} (sensitivity={us10y:+.1f})"
            )

        return json.dumps({
            "symbol": symbol.upper(),
            "sensitivities": linkages,
            "interpretations": interpretations,
            "source": "market.macro (curated India-specific macro linkage map)",
            "evidence_type": "calculated",
        }, default=str)
    except Exception as e:
        return json.dumps({"error": str(e), "symbol": symbol.upper()})
