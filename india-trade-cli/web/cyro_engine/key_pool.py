"""
web/cyro_engine/key_pool.py
────────────────────────────
CYRO Mistral Testing Key Pool

Round-robin key allocation with thread-safe slot tracking and per-key
failure fallback. Designed exclusively for local testing.

SECURITY RULES:
  - Never log actual key values
  - Only log key_slot (1/2/3), not the key string
  - Keys are read from MISTRAL_API_KEY_1/2/3 environment variables
  - Falls back to MISTRAL_API_KEY if pool keys not configured
"""

from __future__ import annotations

import os
import threading
import time
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# ── Internal Pool State ──────────────────────────────────────────────────────

_pool_lock = threading.Lock()
_current_slot = 0  # 0-indexed internally; displayed as 1-indexed in logs
_cooldown_until: dict[int, float] = {}  # slot (1-indexed) -> monotonic time
_COOLDOWN_SEC = 60.0


def mark_rate_limited(slot: int) -> None:
    """Skip this slot in get_next_key() for a cooldown period."""
    if slot:
        _cooldown_until[slot] = time.monotonic() + _COOLDOWN_SEC


def _load_pool() -> list[str]:
    """Load configured testing keys from environment. Never returns key values in logs."""
    try:
        from config.env_loader import reload_if_changed
        reload_if_changed()  # picks up edited .env without a restart
    except Exception:
        pass
    keys = []
    for i in range(1, 11):
        val = os.environ.get(f"MISTRAL_API_KEY_{i}", "").strip()
        if val:
            keys.append(val)

    if not keys:
        # Fallback: single key from MISTRAL_API_KEY
        single = os.environ.get("MISTRAL_API_KEY", "").strip()
        if single:
            keys.append(single)

    return keys


def get_next_key() -> tuple[str, int]:
    """
    Thread-safely allocate the next key in round-robin order.

    Returns:
        (key_value, slot_number_1indexed)
    """
    global _current_slot
    pool = _load_pool()

    if not pool:
        logger.error("[KeyPool] No Mistral API keys configured. Set MISTRAL_API_KEY or MISTRAL_API_KEY_1/2/3.")
        return "", 0

    with _pool_lock:
        now = time.monotonic()
        slot_idx = _current_slot % len(pool)
        _current_slot += 1
        # Prefer a key that is not cooling down; if all are, use the round-robin pick.
        for _ in range(len(pool)):
            if _cooldown_until.get(slot_idx + 1, 0.0) <= now:
                break
            slot_idx = _current_slot % len(pool)
            _current_slot += 1

    slot_num = slot_idx + 1  # 1-indexed for logging
    logger.debug("[KeyPool] Allocated key_slot=%d of %d configured slots", slot_num, len(pool))
    return pool[slot_idx], slot_num


def try_call_with_pool(call_fn, agent_name: str = "unknown", max_attempts: Optional[int] = None) -> tuple[any, int]:
    """
    Execute call_fn() with automatic key-slot rotation on retriable failures.

    call_fn receives no arguments; the caller is expected to capture key from
    get_next_key() and use it in a closure.

    Args:
        call_fn:      Callable that performs the LLM request (no args).
        agent_name:   For observability logging only.
        max_attempts: Max attempts. Defaults to pool size (try each key once).

    Returns:
        (result, final_slot_used)
    """
    pool = _load_pool()
    if not pool:
        return None, 0

    attempts = max_attempts or len(pool)

    for attempt in range(attempts):
        key, slot = get_next_key()
        t_start = time.monotonic()

        try:
            result = call_fn(key, slot)
            latency_ms = int((time.monotonic() - t_start) * 1000)
            logger.info(
                "[KeyPool] AGENT=%s KEY_SLOT=%d STATUS=SUCCESS LATENCY_MS=%d",
                agent_name, slot, latency_ms
            )
            return result, slot

        except Exception as e:
            latency_ms = int((time.monotonic() - t_start) * 1000)
            err_str = str(e)
            is_rate_limit = "429" in err_str or "rate_limit" in err_str.lower()
            is_auth = "401" in err_str or "authentication" in err_str.lower() or "unauthorized" in err_str.lower()
            error_type = "rate_limit" if is_rate_limit else ("auth_error" if is_auth else "request_error")

            logger.warning(
                "[KeyPool] AGENT=%s KEY_SLOT=%d STATUS=FAILURE LATENCY_MS=%d ERROR_TYPE=%s attempt=%d/%d",
                agent_name, slot, latency_ms, error_type, attempt + 1, attempts
            )

            if is_auth and not is_rate_limit:
                # Auth errors are not transient — don't retry with same provider issue
                logger.error("[KeyPool] Auth failure on slot %d — skipping to next slot", slot)

            if attempt < attempts - 1:
                sleep_time = 3.0 if is_rate_limit else 1.0
                time.sleep(sleep_time)
            else:
                logger.error("[KeyPool] All %d key slots exhausted for agent=%s", attempts, agent_name)

    return None, 0


def pool_status() -> dict:
    """Return safe status dict (no key values)."""
    pool = _load_pool()
    return {
        "configured_slots": len(pool),
        "current_position": _current_slot % max(len(pool), 1) + 1,
        "pool_available": len(pool) > 0,
    }
