"""Basket construction: eligibility -> ranking -> sector-capped selection -> capped score weighting. Pure logic."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, List, Optional, Sequence, Set

from baskets.config import MIN_COVERAGE
from baskets.definitions import BasketDef

MIN_HOLDINGS = 5          # below this a basket is considered "unavailable" rather than shown half-empty


@dataclass(frozen=True)
class Candidate:
    symbol: str
    cap_class: str
    sector: Optional[str]
    score: float
    coverage: float
    liq_cr: Optional[float]
    is_financial: bool = False
    bars: Optional[int] = None          # sessions of price history; None = unknown (not filtered)


@dataclass(frozen=True)
class Pick:
    symbol: str
    score: float
    weight: float            # 0..1
    sector: Optional[str]


def cap_weights(raw: Sequence[float], max_weight: float) -> List[float]:
    """Normalise raw weights to sum to 1 with no weight above max_weight (water-filling redistribution)."""
    n = len(raw)
    if n == 0:
        return []
    if max_weight * n < 1.0 - 1e-9:                      # cap infeasible: fall back to equal weight
        return [1.0 / n] * n
    total = float(sum(raw)) or 1.0
    w = [r / total for r in raw]
    capped: Set[int] = set()
    for _ in range(n + 1):
        over = [i for i in range(n) if i not in capped and w[i] > max_weight + 1e-12]
        if not over:
            break
        capped.update(over)
        for i in over:
            w[i] = max_weight
        free = [i for i in range(n) if i not in capped]
        remaining = 1.0 - max_weight * len(capped)
        base = sum(raw[i] for i in free)
        if not free:
            break
        for i in free:
            w[i] = remaining * (raw[i] / base if base else 1.0 / len(free))
    return w


def eligible(cands: Iterable[Candidate], d: BasketDef, min_coverage: float = MIN_COVERAGE) -> List[Candidate]:
    return [c for c in cands
            if c.cap_class in d.caps
            and c.coverage >= min_coverage
            and c.score >= d.min_score
            and (c.liq_cr or 0.0) >= d.min_liq_cr
            and (c.bars is None or c.bars >= d.min_bars)]


def select(cands: Iterable[Candidate], d: BasketDef, incumbents: Optional[Set[str]] = None,
           min_coverage: float = MIN_COVERAGE) -> List[Pick]:
    """Top-n eligible stocks by model score (incumbents get a small bonus), sector-capped, score-weighted."""
    incumbents = incumbents or set()
    pool = eligible(cands, d, min_coverage)
    # deterministic: score (+ incumbent bonus) desc, then symbol asc
    pool.sort(key=lambda c: (-(c.score + (d.hysteresis if c.symbol in incumbents else 0.0)), c.symbol))

    chosen: List[Candidate] = []
    per_sector: dict = {}
    n_fin = 0
    for c in pool:
        key = c.sector or f"?{c.symbol}"                     # unknown sector never blocks another stock
        if per_sector.get(key, 0) >= d.max_per_sector:
            continue
        if c.is_financial and n_fin >= d.financials_cap:     # banks/NBFCs are scored on fewer rules: limit their share
            continue
        chosen.append(c)
        per_sector[key] = per_sector.get(key, 0) + 1
        n_fin += 1 if c.is_financial else 0
        if len(chosen) >= d.n:
            break
    if len(chosen) < MIN_HOLDINGS:
        return []

    raw = [(c.score / 100.0) ** 3 for c in chosen]            # mild tilt towards the highest-scoring names
    weights = cap_weights(raw, d.max_weight)
    return [Pick(c.symbol, c.score, w, c.sector) for c, w in zip(chosen, weights)]


def needs_rebalance(last_as_of, today, d: BasketDef) -> bool:
    return last_as_of is None or (today - last_as_of).days >= d.rebalance_days
