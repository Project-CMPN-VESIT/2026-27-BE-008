"""
Screenable fields. Every field has a label, a group, a unit and where its value comes from, so the API can
describe itself to the UI and a condition can be explained in plain words.

kind: "num" (numeric), "bool" (true/false) or "cat" (text category).
src : "stock" (column of the stocks table), "f" (fundamental factors) or "p" (price factors).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List


@dataclass(frozen=True)
class Field:
    key: str
    label: str
    group: str
    unit: str          # "", "%", "x", "Rs", "Rs Cr"
    kind: str = "num"
    src: str = "f"
    col: str = ""      # source key (defaults to key)
    hint: str = ""

    @property
    def source_key(self) -> str:
        return self.col or self.key


_F: List[Field] = [
    # market
    Field("price", "Price", "Market", "Rs", src="p", col="last_close"),
    Field("mcap_cr", "Market cap", "Market", "Rs Cr"),
    Field("cap_class", "Cap segment", "Market", "", kind="cat", src="stock"),
    Field("sector", "Sector", "Market", "", kind="cat", src="stock"),
    Field("avg_value_cr", "Avg daily traded value", "Market", "Rs Cr", src="p", hint="Liquidity"),
    # valuation
    Field("pe", "P/E", "Valuation", "x"),
    Field("pb", "P/B", "Valuation", "x"),
    Field("peg", "PEG", "Valuation", "x"),
    # earnings and growth
    Field("profit_cagr", "Profit growth (CAGR)", "Earnings & growth", "%"),
    Field("revenue_cagr", "Revenue growth (CAGR)", "Earnings & growth", "%"),
    Field("q_eps_yoy", "Latest quarter EPS growth (YoY)", "Earnings & growth", "%"),
    Field("q_rev_yoy", "Latest quarter sales growth (YoY)", "Earnings & growth", "%"),
    # quality and safety
    Field("roe", "Return on equity", "Quality & safety", "%"),
    Field("roce", "Return on capital employed", "Quality & safety", "%"),
    Field("op_margin", "Operating margin", "Quality & safety", "%"),
    Field("npm", "Net profit margin", "Quality & safety", "%"),
    Field("debt_equity", "Debt / equity", "Quality & safety", "x"),
    Field("fcf_conv", "Cash conversion (FCF / profit)", "Quality & safety", "x"),
    # dividends
    Field("div_yield", "Dividend yield", "Dividends", "%"),
    # ownership
    Field("promoter_pct", "Promoter holding", "Ownership", "%"),
    Field("promoter_change_qoq", "Promoter holding change (QoQ)", "Ownership", "%"),
    Field("inst_pct", "Institutional holding", "Ownership", "%"),
    # price trend
    Field("ret_1m", "1-month return", "Price trend", "%", src="p"),
    Field("ret_3m", "3-month return", "Price trend", "%", src="p"),
    Field("ret_6m", "6-month return", "Price trend", "%", src="p"),
    Field("ret_12m", "12-month return", "Price trend", "%", src="p"),
    Field("dist_high_pct", "Below 52-week high", "Price trend", "%", src="p", hint="0 means at the high"),
    Field("above_200dma", "Above 200-day average", "Price trend", "", kind="bool", src="p"),
    Field("rel_strength_12m", "12-month relative strength", "Price trend", "%", src="p", hint="vs NIFTY 50"),
    Field("vol_surge", "Volume vs average", "Price trend", "x", src="p"),
    Field("volatility_pct", "Volatility", "Price trend", "%", src="p"),
]

FIELDS: Dict[str, Field] = {f.key: f for f in _F}

# columns shown in the results table by default (the UI can show others)
DEFAULT_COLUMNS = ["price", "mcap_cr", "pe", "roe", "profit_cagr", "div_yield", "promoter_pct", "ret_3m", "ret_12m"]

NUM_OPS = (">", ">=", "<", "<=", "==", "!=", "between")
CAT_OPS = ("==", "!=", "in")
BOOL_OPS = ("==",)
MAX_CONDITIONS = 20
