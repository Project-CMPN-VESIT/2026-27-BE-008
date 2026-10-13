"""
The five legend models. Each is a transparent weighted checklist (weights sum to 100) that rewards the
traits the investor is publicly known for. They are *inspired by* the styles, not endorsements.

Factor keys come from baskets.fundamentals (statements + holdings) and baskets.factors (price-derived).
Growth / return / margin factors are in percent; debt_equity is a ratio; mcap_cr is in Rs crore.
"""

from __future__ import annotations

from typing import Dict, Optional

from baskets.scoring.helpers import Factors, ModelSpec, Rule, flag, num, scale


def _promoter(f: Factors) -> Optional[float]:
    p = num(f, "promoter_pct")
    return p if p is not None else num(f, "insider_pct")


def _growth(f: Factors) -> Optional[float]:
    g = num(f, "profit_cagr")
    return g if g is not None else num(f, "revenue_cagr")


def _lynch_peg(f: Factors) -> Optional[float]:
    peg = num(f, "peg")
    if peg is not None:
        return scale(peg, 2.5, 0.5)
    # No PEG because growth is zero/negative: that is a failing grade, not "missing data".
    g = _growth(f)
    if num(f, "pe") is not None and g is not None and g <= 0:
        return 0.0
    return None


# --- Warren Buffett: durable, profitable, low-debt businesses at a sensible price -----------------------
BUFFETT = ModelSpec("buffett", "Warren Buffett", "Value investing", [
    Rule("roe", 15, lambda f: scale(num(f, "roe"), 8, 25), "Strong Return on Equity", "Weak Return on Equity"),
    Rule("roce", 10, lambda f: scale(num(f, "roce"), 10, 30), "Exceptional Capital Returns", "Low Capital Returns", skip_financials=True),
    Rule("roe_years", 10, lambda f: scale(num(f, "roe_years_ok"), 0.4, 1.0), "Consistent Profitability", "Inconsistent Returns"),
    Rule("debt", 15, lambda f: scale(num(f, "debt_equity"), 1.5, 0.1), "Conservative Balance Sheet", "High Debt", skip_financials=True),
    Rule("op_margin", 8, lambda f: scale(num(f, "op_margin"), 8, 30), "Wide Operating Margins", "Thin Margins", skip_financials=True),
    Rule("margin_stability", 7, lambda f: scale(num(f, "margin_std"), 8, 0.5), "Stable Operating Margins", "Volatile Margins", skip_financials=True),
    Rule("fcf", 10, lambda f: scale(num(f, "fcf_conv"), 0.3, 1.0), "Strong Cash Conversion", "Weak Cash Conversion", skip_financials=True),
    Rule("growth", 10, lambda f: scale(_growth(f), 0, 15), "Steady Earnings Growth", "Stagnant Earnings"),
    Rule("pe", 10, lambda f: scale(num(f, "pe"), 45, 12), "Reasonable Valuation", "Expensive Valuation"),
    Rule("pb", 5, lambda f: scale(num(f, "pb"), 8, 1.5), "Attractive Price-to-Book", "Rich Price-to-Book"),
])

# --- Peter Lynch: growth at a reasonable price (GARP) --------------------------------------------------
LYNCH = ModelSpec("lynch", "Peter Lynch", "GARP investing", [
    Rule("peg", 25, _lynch_peg, "Prime PEG Ratio", "Unattractive PEG"),
    Rule("eps_growth", 20, lambda f: scale(_growth(f), 5, 25), "Strong Earnings Growth", "Slow Earnings Growth"),
    Rule("rev_growth", 10, lambda f: scale(num(f, "revenue_cagr"), 5, 20), "Healthy Sales Growth", "Slow Sales Growth"),
    Rule("debt", 15, lambda f: scale(num(f, "debt_equity"), 1.2, 0.1), "Low Debt", "High Debt", skip_financials=True),
    Rule("pe", 10, lambda f: scale(num(f, "pe"), 50, 10), "Sensible P/E", "Stretched P/E"),
    Rule("roe", 10, lambda f: scale(num(f, "roe"), 8, 20), "Good Return on Equity", "Low Return on Equity"),
    Rule("under_owned", 5, lambda f: scale(num(f, "inst_pct"), 60, 10), "Low Institutional Crowding", "Crowded by Institutions"),
    Rule("q_growth", 5, lambda f: scale(num(f, "q_eps_yoy"), 0, 25), "Accelerating Quarterly Earnings", "Quarterly Earnings Slowing"),
])

# --- Rakesh Jhunjhunwala: structural growth + strong return ratios + a market-confirmed trend ---------
JHUNJHUNWALA = ModelSpec("jhunjhunwala", "Rakesh Jhunjhunwala", "Market trends & growth", [
    Rule("roe", 15, lambda f: scale(num(f, "roe"), 12, 28), "Superior Return Ratios", "Weak Return Ratios"),
    Rule("roce", 10, lambda f: scale(num(f, "roce"), 12, 30), "Efficient Capital Use", "Inefficient Capital Use", skip_financials=True),
    Rule("op_margin", 10, lambda f: scale(num(f, "op_margin"), 10, 28), "Robust Operating Margins", "Thin Operating Margins", skip_financials=True),
    Rule("profit_growth", 15, lambda f: scale(num(f, "profit_cagr"), 8, 30), "High Profit Growth", "Low Profit Growth"),
    Rule("rev_growth", 10, lambda f: scale(num(f, "revenue_cagr"), 8, 25), "Strong Revenue Growth", "Weak Revenue Growth"),
    Rule("trend_200", 10, lambda f: flag(f.get("above_200dma")), "Bullish Long-Term Trend", "Bearish Long-Term Trend"),
    Rule("momentum_6m", 10, lambda f: scale(num(f, "ret_6m"), -5, 35), "Strong Momentum", "Weak Momentum"),
    Rule("promoter", 8, lambda f: scale(_promoter(f), 25, 60), "High Promoter Commitment", "Low Promoter Holding"),
    Rule("debt", 7, lambda f: scale(num(f, "debt_equity"), 1.0, 0.2), "Manageable Debt", "Heavy Debt", skip_financials=True),
    Rule("valuation", 5, lambda f: scale(num(f, "pe"), 60, 15), "Valuation Not Stretched", "Stretched Valuation"),
])

# --- Christopher Mayer, "100 Baggers": small, high-return compounders with long growth runways ---------
HUNDRED_BAGGERS = ModelSpec("hundred_baggers", "100 Baggers", "Christopher Mayer", [
    Rule("roce", 15, lambda f: scale(num(f, "roce"), 15, 35), "Disciplined Capital Returns", "Low Capital Returns", skip_financials=True),
    Rule("roe", 10, lambda f: scale(num(f, "roe"), 15, 30), "Robust Return on Equity", "Low Return on Equity"),
    Rule("profit_growth", 15, lambda f: scale(_growth(f), 15, 40), "Compounding Earnings", "Slow Earnings Growth"),
    Rule("rev_growth", 10, lambda f: scale(num(f, "revenue_cagr"), 12, 30), "Rapid Revenue Growth", "Slow Revenue Growth"),
    Rule("debt", 10, lambda f: scale(num(f, "debt_equity"), 0.8, 0.05), "Self-Funded Growth", "Debt-Funded Growth", skip_financials=True),
    Rule("small_base", 10, lambda f: scale(num(f, "mcap_cr"), 25000, 1500), "Long Runway (Small Base)", "Large Base Limits Upside"),
    Rule("promoter", 10, lambda f: scale(_promoter(f), 35, 65), "Owner-Operator Alignment", "Low Promoter Holding"),
    Rule("reinvest", 5, lambda f: scale(num(f, "div_yield"), 2.0, 0.0), "Reinvests Earnings", "High Payout Limits Reinvestment"),
    Rule("peg", 10, lambda f: scale(num(f, "peg"), 2.0, 0.7), "Growth Not Overpaid For", "Overpaying For Growth"),
    Rule("margin_trend", 5, lambda f: scale(num(f, "op_margin_trend"), -2, 3), "Expanding Margins", "Contracting Margins", skip_financials=True),
])

# --- CANSLIM (William O'Neil): earnings acceleration + leadership near highs --------------------------
CANSLIM = ModelSpec("canslim", "CANSLIM", "William O'Neil", [
    Rule("c_eps", 20, lambda f: scale(num(f, "q_eps_yoy"), 10, 50), "Strong Current Quarterly Earnings", "Weak Current Earnings"),
    Rule("c_rev", 5, lambda f: scale(num(f, "q_rev_yoy"), 5, 30), "Quarterly Sales Surge", "Quarterly Sales Weak"),
    Rule("a_growth", 15, lambda f: scale(_growth(f), 10, 35), "Annual Earnings Strong", "Annual Earnings Weak"),
    Rule("a_roe", 10, lambda f: scale(num(f, "roe"), 12, 25), "High Return on Equity", "Low Return on Equity"),
    Rule("n_high", 15, lambda f: scale(num(f, "dist_high_pct"), 25, 0), "Near 52-Week High", "Far From 52-Week High"),
    Rule("s_volume", 5, lambda f: scale(num(f, "vol_surge"), 0.8, 1.5), "Rising Demand (Volume)", "Fading Volume"),
    Rule("l_leader", 20, lambda f: scale(num(f, "rel_strength_12m"), -10, 40), "Market Leader (Relative Strength)", "Market Laggard"),
    Rule("i_inst", 5, lambda f: scale(num(f, "inst_pct"), 5, 40), "Institutional Sponsorship", "Little Institutional Backing"),
    Rule("momentum_3m", 5, lambda f: scale(num(f, "ret_3m"), -5, 25), "Positive Recent Momentum", "Negative Recent Momentum"),
])

MODELS: Dict[str, ModelSpec] = {m.id: m for m in (BUFFETT, LYNCH, JHUNJHUNWALA, HUNDRED_BAGGERS, CANSLIM)}
