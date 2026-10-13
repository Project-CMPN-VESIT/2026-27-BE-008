"""Human-readable labels, units and philosophies for the legend models (used by the UI and AI summaries)."""

from __future__ import annotations

from typing import Dict, List, Optional, Tuple

from baskets.scoring.helpers import Factors, ModelSpec, num, score_model

# rule key -> (label, factor key, unit)   unit: "%", "x" (ratio), "cr" (Rs crore), "bool", ""
RULE_META: Dict[str, Tuple[str, str, str]] = {
    "roe": ("Return on equity", "roe", "%"),
    "roce": ("Return on capital employed", "roce", "%"),
    "roe_years": ("Years with ROE of 15%+", "roe_years_ok", "share"),
    "debt": ("Debt to equity", "debt_equity", "x"),
    "op_margin": ("Operating margin", "op_margin", "%"),
    "margin_stability": ("Margin volatility (lower is better)", "margin_std", "pp"),
    "fcf": ("Free cash flow / net profit", "fcf_conv", "x"),
    "growth": ("Earnings growth (CAGR)", "profit_cagr", "%"),
    "eps_growth": ("Earnings growth (CAGR)", "profit_cagr", "%"),
    "profit_growth": ("Profit growth (CAGR)", "profit_cagr", "%"),
    "rev_growth": ("Revenue growth (CAGR)", "revenue_cagr", "%"),
    "a_growth": ("Annual earnings growth (CAGR)", "profit_cagr", "%"),
    "a_roe": ("Return on equity", "roe", "%"),
    "pe": ("Price to earnings", "pe", "x"),
    "pb": ("Price to book", "pb", "x"),
    "valuation": ("Price to earnings", "pe", "x"),
    "peg": ("PEG ratio", "peg", "x"),
    "under_owned": ("Institutional ownership", "inst_pct", "%"),
    "i_inst": ("Institutional ownership", "inst_pct", "%"),
    "q_growth": ("Latest quarter EPS growth (YoY)", "q_eps_yoy", "%"),
    "c_eps": ("Latest quarter EPS growth (YoY)", "q_eps_yoy", "%"),
    "c_rev": ("Latest quarter sales growth (YoY)", "q_rev_yoy", "%"),
    "trend_200": ("Price vs 200-day average", "above_200dma", "bool"),
    "momentum_6m": ("6-month return", "ret_6m", "%"),
    "momentum_3m": ("3-month return", "ret_3m", "%"),
    "promoter": ("Promoter holding", "promoter_pct", "%"),
    "small_base": ("Market capitalisation", "mcap_cr", "cr"),
    "reinvest": ("Dividend yield (lower = reinvests more)", "div_yield", "%"),
    "margin_trend": ("Change in operating margin", "op_margin_trend", "pp"),
    "n_high": ("Distance below 52-week high", "dist_high_pct", "%"),
    "s_volume": ("Recent volume vs 1-year average", "vol_surge", "x"),
    "l_leader": ("1-year return vs NIFTY 50", "rel_strength_12m", "pp"),
}

PHILOSOPHY: Dict[str, str] = {
    "buffett": "durable, consistently profitable businesses with conservative balance sheets, stable margins and "
               "strong cash generation, bought at a sensible price",
    "lynch": "growth at a reasonable price (a low PEG ratio): fast earnings growth, low debt, and a company the "
             "market has not yet crowded into",
    "jhunjhunwala": "structural growth stories with superior return ratios and healthy margins, confirmed by a "
                    "positive price trend and committed promoters",
    "hundred_baggers": "small, high-return compounders that reinvest earnings, fund growth without debt, are run by "
                       "aligned owners and have a long runway ahead",
    "canslim": "accelerating current earnings, strong annual growth and market leadership near 52-week highs, "
               "backed by rising demand and institutional sponsorship",
}


def band(score: Optional[float]) -> str:
    if score is None:
        return "Unrated"
    for floor, name in ((80, "Excellent"), (65, "Strong"), (50, "Moderate"), (35, "Weak")):
        if score >= floor:
            return name
    return "Poor"


def format_value(factor: str, unit: str, value) -> Optional[str]:
    if value is None:
        return None
    if unit == "bool":
        return "Above" if value else "Below"
    try:
        v = float(value)
    except (TypeError, ValueError):
        return str(value)
    if unit == "%":
        return f"{v:.1f}%"
    if unit == "pp":
        return f"{v:+.1f} pts"
    if unit == "x":
        return f"{v:.2f}x"
    if unit == "share":
        return f"{v * 100:.0f}%"
    if unit == "cr":
        return f"₹{v:,.0f} cr"
    return f"{v:.2f}"


def breakdown(spec: ModelSpec, factors: Factors) -> List[dict]:
    """Per-rule transparency for one model: what was measured, its value, weight and 0-100 sub-score."""
    res = score_model(spec, factors)
    is_fin = bool(factors.get("is_financial"))
    out: List[dict] = []
    for r in spec.rules:
        if is_fin and r.skip_financials:
            continue
        sub = res.detail.get(r.key)
        label, factor, unit = RULE_META.get(r.key, (r.key, r.key, ""))
        value = factors.get(factor)
        out.append({
            "key": r.key, "label": label, "weight": r.weight,
            "value": value if not isinstance(value, bool) else bool(value),
            "display": format_value(factor, unit, value),
            "subscore": None if sub is None else round(sub * 100),
        })
    out.sort(key=lambda x: -x["weight"])
    return out
