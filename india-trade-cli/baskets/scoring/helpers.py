"""Building blocks for transparent, rule-based legend scores."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional

Factors = Dict[str, object]


def scale(x: Optional[float], lo: float, hi: float) -> Optional[float]:
    """Linear 0..1 map of x between lo and hi (hi < lo gives an inverse scale). None stays None."""
    if x is None:
        return None
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    if x != x:  # NaN
        return None
    if hi == lo:
        return 1.0 if x >= hi else 0.0
    t = (x - lo) / (hi - lo)
    return max(0.0, min(1.0, t))


def flag(v: Optional[bool]) -> Optional[float]:
    """Boolean -> 1.0 / 0.0 (None stays None)."""
    return None if v is None else (1.0 if v else 0.0)


def num(f: Factors, key: str) -> Optional[float]:
    v = f.get(key)
    if v is None:
        return None
    try:
        v = float(v)
    except (TypeError, ValueError):
        return None
    return None if v != v else v


@dataclass(frozen=True)
class Rule:
    """One weighted factor of a legend model. fn returns a 0..1 sub-score or None when data is missing."""
    key: str
    weight: float
    fn: Callable[[Factors], Optional[float]]
    pos: str          # tag shown when the factor scores high
    neg: str          # tag shown when it scores low
    skip_financials: bool = False   # not meaningful for banks/NBFCs (ROCE, margins, FCF, D/E): drop from the score


@dataclass(frozen=True)
class ModelSpec:
    id: str
    label: str
    investor: str
    rules: List[Rule]

    def total_weight(self) -> float:
        return sum(r.weight for r in self.rules)


@dataclass
class ScoreResult:
    score: float                 # 0..100
    coverage: float              # share of rule weight that had data (0..1)
    tags_pos: List[str] = field(default_factory=list)
    tags_neg: List[str] = field(default_factory=list)
    detail: Dict[str, float] = field(default_factory=dict)   # rule key -> 0..1 sub-score


def score_model(spec: ModelSpec, factors: Factors, max_tags: int = 3) -> ScoreResult:
    """
    Weighted average of the sub-scores that are available, re-normalised over available weight.
    Coverage reports how much of the model's weight had data, so thin-data stocks can be excluded.
    """
    is_fin = bool(factors.get("is_financial"))
    rules = [r for r in spec.rules if not (is_fin and r.skip_financials)]
    total = sum(r.weight for r in rules)
    got_w = 0.0
    acc = 0.0
    subs: List[tuple] = []
    detail: Dict[str, float] = {}
    for r in rules:
        try:
            s = r.fn(factors)
        except Exception:
            s = None
        if s is None:
            continue
        got_w += r.weight
        acc += r.weight * s
        detail[r.key] = round(s, 3)
        subs.append((r, s))
    if got_w <= 0:
        return ScoreResult(score=0.0, coverage=0.0)
    pos = sorted((x for x in subs if x[1] >= 0.8), key=lambda x: x[0].weight * x[1], reverse=True)
    neg = sorted((x for x in subs if x[1] <= 0.25), key=lambda x: x[0].weight * (1 - x[1]), reverse=True)
    return ScoreResult(
        score=round(100.0 * acc / got_w, 1),
        coverage=round(got_w / total, 3),
        tags_pos=[x[0].pos for x in pos[:max_tags]],
        tags_neg=[x[0].neg for x in neg[:max_tags]],
        detail=detail,
    )
