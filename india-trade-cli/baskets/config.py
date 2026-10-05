"""Central configuration for the baskets engine (all overridable via environment)."""

from __future__ import annotations

import os
from pathlib import Path

_PKG_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.getenv("BASKETS_DATA_DIR", _PKG_DIR.parent / "data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)

# Local SQLite by default (fast, zero setup). Point at Postgres/Neon to share data across machines.
DATABASE_URL = os.getenv("BASKETS_DATABASE_URL", f"sqlite:///{(DATA_DIR / 'baskets.db').as_posix()}")

# ── Universe: official NSE indices define the cap segments (auto-updates as NSE reconstitutes) ──
CAP_INDICES = {
    "large": "NIFTY 100",
    "mid": "NIFTY MIDCAP 150",
    "small": "NIFTY SMALLCAP 250",
}
BENCHMARK_SYMBOL = "^NSEI"          # NIFTY 50, stored in the price table next to the stocks
FD_RATE = float(os.getenv("BASKETS_FD_RATE", "0.07"))   # fixed-deposit comparison line

# ── Data refresh ──
PRICE_HISTORY_PERIOD = os.getenv("BASKETS_PRICE_PERIOD", "2y")
PRICE_CHUNK_SIZE = int(os.getenv("BASKETS_PRICE_CHUNK", "50"))
FUNDAMENTALS_TTL_DAYS = float(os.getenv("BASKETS_FUNDAMENTALS_TTL_DAYS", "3"))
FUNDAMENTALS_WORKERS = int(os.getenv("BASKETS_FUNDAMENTALS_WORKERS", "6"))
MIN_PRICE_BARS = 200                 # need ~200 sessions for 200-DMA / 12-month factors

# ── Selection guards shared by all baskets (individual baskets may tighten them) ──
MIN_COVERAGE = float(os.getenv("BASKETS_MIN_COVERAGE", "0.70"))   # share of a model's factor weight that must be available
AUTO_REFRESH = os.getenv("BASKETS_AUTO_REFRESH", "1") == "1"
SCHEDULER_TICK_SECONDS = int(os.getenv("BASKETS_SCHEDULER_TICK", "900"))
REFRESH_AFTER_HOUR_IST = int(os.getenv("BASKETS_REFRESH_AFTER_HOUR_IST", "16"))   # after market close
REFRESH_MIN_AGE_HOURS = float(os.getenv("BASKETS_REFRESH_MIN_AGE_HOURS", "20"))

DISCLAIMER = (
    "Educational research only — not investment advice. Baskets are rule-based, inspired by public investing "
    "styles, and are not endorsed by or affiliated with the investors named. Past or simulated performance "
    "does not guarantee future returns."
)
