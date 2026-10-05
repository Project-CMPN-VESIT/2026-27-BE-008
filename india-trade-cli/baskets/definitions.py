"""
Basket definitions. A basket is just a set of rules, so adding one never needs new code:

    model      which legend score ranks the stocks
    caps       which cap segments are eligible (large = Nifty 100, mid = Midcap 150, small = Smallcap 250)
    n          number of holdings
    min_score  floor on the model score
    min_liq_cr minimum average daily traded value (Rs crore), so every holding is actually tradable
    max_weight cap on a single holding

Names say "-style" / "inspired by": these are rule-based baskets, not endorsed by the investors named.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Tuple

from baskets.scoring.models import MODELS


@dataclass(frozen=True)
class BasketDef:
    id: str
    name: str
    model: str
    caps: Tuple[str, ...]
    description: str
    n: int = 12
    min_score: float = 55.0
    min_liq_cr: float = 2.0
    max_weight: float = 0.12
    rebalance_days: int = 30
    min_bars: int = 126                # ~6 months of trading history: keeps just-listed IPOs out
    max_financials: int = 0            # 0 = derive from n (about one in six): lenders are scored on fewer rules
    hysteresis: float = 3.0           # score bonus for incumbents, so holdings do not churn on tiny score changes

    @property
    def cap_label(self) -> str:
        c = set(self.caps)
        if c == {"small", "mid"}:
            return "Small + Mid Cap"
        if c == {"large", "mid"}:
            return "Large + Mid Cap"
        if len(c) == 1:
            return f"{next(iter(c)).title()} Cap"
        return " + ".join(x.title() for x in self.caps) + " Cap"

    @property
    def model_label(self) -> str:
        return MODELS[self.model].label

    @property
    def financials_cap(self) -> int:
        return self.max_financials or max(2, round(self.n / 6))

    @property
    def max_per_sector(self) -> int:
        return max(2, round(self.n * 0.34))


_DEFS = [
    BasketDef("canslim-small-mid", "CANSLIM Small + Mid Cap Movers", "canslim", ("small", "mid"),
              "Small and mid caps with accelerating earnings that are leading the market near their highs.",
              n=15, min_liq_cr=3.0),
    BasketDef("jhunjhunwala-small", "Jhunjhunwala-style Small Cap Movers", "jhunjhunwala", ("small",),
              "Small caps with superior return ratios, strong growth and a market-confirmed uptrend.",
              n=12, min_liq_cr=2.0),
    BasketDef("jhunjhunwala-large", "Jhunjhunwala-style Large Cap Movers", "jhunjhunwala", ("large",),
              "Large caps combining high return ratios, durable growth and a bullish trend.",
              n=12, min_liq_cr=25.0),
    BasketDef("mayer-small", "100-Bagger Small Cap Movers", "hundred_baggers", ("small",),
              "Small, high-return compounders with long growth runways and owner-operator alignment "
              "(after Christopher Mayer's 100 Baggers).",
              n=12, min_liq_cr=2.0),
    BasketDef("lynch-small-mid", "Lynch-style Small + Mid Cap High Growth Movers", "lynch", ("small", "mid"),
              "Fast-growing small and mid caps still priced reasonably (growth at a reasonable price).",
              n=15, min_liq_cr=3.0),
    BasketDef("buffett-large", "Buffett-style Large Cap Compounders", "buffett", ("large",),
              "Large, profitable, low-debt businesses with stable margins at sensible valuations.",
              n=12, min_liq_cr=25.0),
    BasketDef("buffett-mid", "Buffett-style Mid Cap Quality", "buffett", ("mid",),
              "Mid caps with durable profitability, conservative balance sheets and fair prices.",
              n=12, min_liq_cr=5.0),
    BasketDef("canslim-large", "CANSLIM Large Cap Momentum Leaders", "canslim", ("large",),
              "Large caps with strong current earnings that are market leaders near 52-week highs.",
              n=10, min_liq_cr=25.0, max_weight=0.14),
]

BASKETS: Dict[str, BasketDef] = {d.id: d for d in _DEFS}
