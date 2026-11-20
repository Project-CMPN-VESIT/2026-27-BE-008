"""
Ready-made screens. The thresholds are FinPilot's own; they are not NSE's. Each preset is a plain list of
conditions, so a user can load it, inspect it and change it.
"""

from __future__ import annotations

from typing import Dict, List


def C(field: str, op: str, value) -> dict:
    return {"field": field, "op": op, "value": value}


PRESETS: List[Dict] = [
    {"id": "all", "name": "All stocks", "blurb": "The whole Nifty 500 universe.", "conditions": []},
    {"id": "growth_discount", "name": "Growth at a discount",
     "blurb": "Profitable growers that are not expensive: profit growth of at least 15% a year at a P/E of 25 or less.",
     "conditions": [C("pe", ">", 0), C("pe", "<=", 25), C("profit_cagr", ">=", 15), C("roe", ">=", 12)]},
    {"id": "income_safety", "name": "Income + safety",
     "blurb": "Dividend payers with a clean balance sheet: yield of 2% or more, debt/equity of 0.5 or less.",
     "conditions": [C("div_yield", ">=", 2), C("debt_equity", "<=", 0.5), C("roe", ">=", 10)]},
    {"id": "momentum_breakout", "name": "Momentum + breakout",
     "blurb": "Strong trend near the high: above the 200-day average, within 5% of the 52-week high, 3-month gain of 10% or more.",
     "conditions": [C("above_200dma", "==", True), C("dist_high_pct", "<=", 5), C("ret_3m", ">=", 10), C("vol_surge", ">=", 1)]},
    {"id": "quality_safety", "name": "Quality + safety",
     "blurb": "High returns on capital with low debt: ROE and ROCE of 15% or more, debt/equity of 0.5 or less.",
     "conditions": [C("roe", ">=", 15), C("roce", ">=", 15), C("debt_equity", "<=", 0.5), C("profit_cagr", ">=", 10)]},
    {"id": "value_growth", "name": "Value growth",
     "blurb": "Cheap on earnings and book value while still growing: P/E of 20 or less, P/B of 3 or less, growth of 10% or more.",
     "conditions": [C("pe", ">", 0), C("pe", "<=", 20), C("pb", "<=", 3), C("revenue_cagr", ">=", 10), C("profit_cagr", ">=", 10)]},
    {"id": "promoter_eps", "name": "High promoter holding + EPS growth",
     "blurb": "Owner-run companies whose latest quarter is growing: promoter holding of 60% or more, EPS growth of 15% or more.",
     "conditions": [C("promoter_pct", ">=", 60), C("q_eps_yoy", ">=", 15)]},
    {"id": "dividend_low_pe", "name": "High dividend + low P/E",
     "blurb": "Income at a modest price: yield of 3% or more at a P/E of 15 or less.",
     "conditions": [C("div_yield", ">=", 3), C("pe", ">", 0), C("pe", "<=", 15)]},
]

PRESET_BY_ID: Dict[str, Dict] = {p["id"]: p for p in PRESETS}
