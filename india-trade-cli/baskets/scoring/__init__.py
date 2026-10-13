from baskets.scoring.helpers import ModelSpec, Rule, ScoreResult, score_model, scale  # noqa: F401
from baskets.scoring.models import MODELS  # noqa: F401


def score_all(factors: dict) -> dict:
    """Score one stock under every legend model -> {model_id: ScoreResult}."""
    return {mid: score_model(spec, factors) for mid, spec in MODELS.items()}
