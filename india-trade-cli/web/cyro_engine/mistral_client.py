"""
web/cyro_engine/mistral_client.py
──────────────────────────────────
CYRO LangChain LLM Client.

Wraps LangChain's ChatOpenAI/ChatMistralAI with:
  - Structured output via .with_structured_output(PydanticModel)
  - Tool binding via .bind_tools(tools)
  - Backward-compatible query() method for legacy code paths
  - Automatic provider selection (Mistral / OpenAI / any OpenAI-compatible)

Environment variables:
  MISTRAL_API_KEY / CYRO_MISTRAL_API_KEY  → API key
  CYRO_MISTRAL_BASE_URL / OPENAI_BASE_URL → Base URL (default: Mistral API)
  CYRO_MODEL / CYRO_NORMAL_MODEL          → Model name
  OPENAI_API_KEY                          → Fallback if Mistral key absent
"""

from __future__ import annotations

import json
import logging
import os
import time
from typing import Any, List, Optional, Type, TypeVar

from pydantic import BaseModel

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)

# ── Key Pool (imported lazily to avoid circular deps) ──────────────────────

def _get_active_api_key() -> tuple[str, int]:
    """Get next API key from pool if available, else fall back to env var. Returns (key, slot)."""
    try:
        from web.cyro_engine.key_pool import get_next_key
        key, slot = get_next_key()
        if key:
            return key, slot
    except Exception:
        pass
    # Fallback to original single key
    for env_var in ("CYRO_MISTRAL_API_KEY", "MISTRAL_API_KEY", "OPENAI_API_KEY"):
        val = os.environ.get(env_var, "").strip()
        if val:
            return val, 0
    return "", 0


def _resolve_env(*keys: str, default: str = "") -> str:
    """Return first non-empty environment variable from the given keys."""
    for key in keys:
        val = os.environ.get(key, "").strip()
        if val:
            return val
    return default


import threading

# Global concurrency gate and throttle for LLM provider API limits
# A semaphore of 1 made the parallel specialist agents queue behind each other (each waiting for the
# previous LLM call to *finish*). Allow a few concurrent calls; only pace request *starts*.
_LLM_SEMAPHORE = threading.Semaphore(max(1, int(os.environ.get("CYRO_LLM_CONCURRENCY", "6"))))
_LLM_LOCK = threading.Lock()
_LAST_LLM_CALL = 0.0
_MIN_LLM_INTERVAL = float(os.environ.get("CYRO_LLM_MIN_INTERVAL", "0.25"))  # seconds between request starts

# function_calling is ~2x faster than Mistral's json_schema mode (measured 5s vs 10-12s) and equally valid.
_STRUCTURED_METHOD = os.environ.get("CYRO_STRUCTURED_METHOD", "function_calling")


def _classify_error(e: Exception) -> str:
    """rate_limit | auth_error | parse_error (schema/JSON validation) | timeout | request_error."""
    text = str(e)
    low = text.lower()
    name = type(e).__name__
    if "429" in text or "rate_limited" in low or "rate limit" in low:
        return "rate_limit"
    if "401" in text or "authentication" in low or "invalid api key" in low:
        return "auth_error"
    if name in ("ValidationError", "OutputParserException", "JSONDecodeError", "ValueError") or "validation error" in low             or "failed to parse" in low or "invalid json" in low or "json" in name.lower():
        return "parse_error"
    if "timeout" in name.lower() or "timed out" in low:
        return "timeout"
    return "request_error"


def _llm_throttle():
    global _LAST_LLM_CALL
    with _LLM_LOCK:
        now = time.monotonic()
        elapsed = now - _LAST_LLM_CALL
        if elapsed < _MIN_LLM_INTERVAL:
            time.sleep(_MIN_LLM_INTERVAL - elapsed)
        _LAST_LLM_CALL = time.monotonic()


def _throttled_chat_cls():
    """ChatOpenAI subclass that shares the global throttle (covers ReAct agents)."""
    from langchain_openai import ChatOpenAI

    class ThrottledChatOpenAI(ChatOpenAI):
        def _generate(self, *args, **kwargs):
            _llm_throttle()
            return super()._generate(*args, **kwargs)

    return ThrottledChatOpenAI


class LangChainClient:
    """
    LangChain-backed LLM client supporting structured output and tool calling.

    Replaces the raw OpenAI client with a proper LangChain ChatModel so that
    agents can use .bind_tools() for ReAct tool calling loops.
    """

    def __init__(self) -> None:
        try:
            from config.env_loader import reload_if_changed
            reload_if_changed()
        except Exception:
            pass

        self.api_key = _resolve_env(
            "CYRO_MISTRAL_API_KEY", "MISTRAL_API_KEY", "OPENAI_API_KEY"
        )
        # Also try pool for initial check
        _pool_key, _ = _get_active_api_key()
        if _pool_key and not self.api_key:
            self.api_key = _pool_key
        self.base_url = _resolve_env(
            "CYRO_MISTRAL_BASE_URL", "OPENAI_BASE_URL",
            default="https://api.mistral.ai/v1",
        )
        self.model = _resolve_env(
            "CYRO_MODEL", "CYRO_NORMAL_MODEL", "OPENAI_MODEL",
            default="ministral-8b-latest",
        )

        if not self.api_key:
            logger.warning(
                "[CyroLLM] No API key found. Set MISTRAL_API_KEY or OPENAI_API_KEY. "
                "LLM calls will fail until a key is configured."
            )

        self._chat_model = self._build_chat_model()

    def _build_chat_model(self):
        """
        Build a LangChain ChatOpenAI instance configured for the active provider.

        Uses ChatOpenAI with a custom base_url to support Mistral AI, local Ollama,
        or any OpenAI-compatible endpoint without provider-specific classes.
        """
        try:
            ChatCls = _throttled_chat_cls()

            return ChatCls(
                model=self.model,
                api_key=self.api_key or "NO_KEY_PROVIDED",
                base_url=self.base_url,
                temperature=0,
                timeout=90,
                max_retries=2,
            )
        except ImportError:
            logger.error(
                "[CyroLLM] langchain-openai not installed. "
                "Run: pip install langchain-openai"
            )
            return None

    # ── Public API ────────────────────────────────────────────────────────────

    def get_llm(self, tools: Optional[List[Any]] = None):
        """
        Return the raw LangChain ChatModel, optionally with tools bound.

        Use this when constructing a create_react_agent() or LCEL chain.

        Args:
            tools: Optional list of LangChain @tool functions to bind.

        Returns:
            LangChain ChatModel instance (with tools bound if provided).
        """
        if self._chat_model is None:
            raise RuntimeError("LangChain ChatModel not initialised — check logs for import errors.")

        if tools:
            return self._chat_model.bind_tools(tools)
        return self._chat_model

    def structured_output(self, response_model: Type[T], tools: Optional[List[Any]] = None):
        """
        Return a LangChain model configured for structured output.

        Uses .with_structured_output() which handles JSON schema enforcement
        via function calling — more reliable than manual JSON parsing.

        Args:
            response_model: A Pydantic BaseModel class to parse output into.
            tools: Optional tools to include alongside structured output.

        Returns:
            Runnable that outputs response_model instances.
        """
        if self._chat_model is None:
            raise RuntimeError("LangChain ChatModel not initialised.")

        return self._chat_model.with_structured_output(response_model)

    def query(
        self,
        system_prompt: str,
        user_content: str,
        response_model: Type[T],
        retries: int = 3,
        timeout: float = 90.0,
        research_id: str = "",
    ) -> Optional[T]:
        """
        Backward-compatible query() for existing agents.py callers.

        Internally uses LangChain's structured output for improved reliability
        over the previous raw JSON parsing approach.

        Args:
            system_prompt:  System-level instruction for the LLM
            user_content:   User message (stringified context dict)
            response_model: Pydantic model to parse the response into
            retries:        Number of retry attempts on failure
            timeout:        Not used directly (configured at client level)

        Returns:
            Parsed response_model instance or None on failure.
        """
        if self._chat_model is None:
            logger.error("[CyroLLM] query() called but chat model is None")
            return None

        # Truncate user_content if extremely long to avoid 400/429 limits
        max_chars = int(os.environ.get("CYRO_MAX_PROMPT_CHARS", "20000"))
        if len(user_content) > max_chars:
            logger.warning("[CyroLLM] user_content truncated from %d to %d chars", len(user_content), max_chars)
            user_content = user_content[:max_chars] + "\n...[Context truncated for model length]"

        from langchain_core.messages import HumanMessage, SystemMessage

        # ── Key pool: get rotating key for this call ───────────────────────
        pool_key, key_slot = _get_active_api_key()
        # Build a per-call model with the allocated key
        try:
            from langchain_openai import ChatOpenAI
            per_call_model = ChatOpenAI(
                model=self.model,
                api_key=pool_key or self.api_key or "NO_KEY",
                base_url=self.base_url,
                temperature=0,
                timeout=90,
                max_retries=0,
            )
        except Exception:
            per_call_model = self._chat_model  # fallback to default

        # Log safe call metadata (no key value)
        try:
            from web.cyro_engine import cyro_logger
            cyro_logger.llm_call(research_id, "mistral_client", key_slot,
                                 context_bytes=len(user_content),
                                 item_count=user_content.count("evidence_id"))
        except Exception:
            pass

        messages = [
            SystemMessage(content=system_prompt),
            HumanMessage(content=user_content),
        ]

        method = _STRUCTURED_METHOD
        for attempt in range(retries + 1):
            t0 = time.monotonic()
            try:
                with _LLM_SEMAPHORE:
                    _llm_throttle()
                    structured = per_call_model.with_structured_output(response_model, method=method)
                    result = structured.invoke(messages)
                latency_ms = int((time.monotonic() - t0) * 1000)
                if result is not None:
                    try:
                        from web.cyro_engine import cyro_logger
                        cyro_logger.llm_success(research_id, "mistral_client", key_slot, latency_ms)
                    except Exception:
                        pass
                    return result
            except Exception as e:
                latency_ms = int((time.monotonic() - t0) * 1000)
                error_type = _classify_error(e)
                is_rate_limit = error_type == "rate_limit"
                logger.warning(
                    "[CyroLLM] query() attempt %d/%d failed (%s, method=%s) %s: %s",
                    attempt + 1, retries + 1, error_type, method, type(e).__name__, str(e)[:300],
                )
                try:
                    from web.cyro_engine import cyro_logger
                    cyro_logger.llm_failure(research_id, "mistral_client", key_slot, error_type, latency_ms,
                                            detail=f"{type(e).__name__}: {str(e)[:200]}")
                except Exception:
                    pass
                if is_rate_limit:
                    try:
                        from web.cyro_engine.key_pool import mark_rate_limited
                        mark_rate_limited(key_slot)
                    except Exception:
                        pass
                if attempt < retries:
                    if error_type == "parse_error":
                        # The key is healthy; the model's output didn't fit the schema. Retry immediately,
                        # switching to the stricter json_schema mode, instead of sleeping and rotating keys.
                        method = "json_schema" if method == "function_calling" else "function_calling"
                        continue
                    # On retriable error try next key from pool
                    pool_key, key_slot = _get_active_api_key()
                    try:
                        per_call_model = ChatOpenAI(
                            model=self.model,
                            api_key=pool_key or self.api_key or "NO_KEY",
                            base_url=self.base_url,
                            temperature=0, timeout=90, max_retries=0,
                        )
                    except Exception:
                        pass
                    sleep_sec = (6.0 * (attempt + 1)) if is_rate_limit else (2.0 ** attempt)
                    time.sleep(sleep_sec)
                else:
                    # Final fallback: raw JSON parse
                    try:
                        return self._query_raw_json(system_prompt, user_content, response_model)
                    except Exception as e2:
                        logger.error("[CyroLLM] All query attempts failed: %s", e2)
                        return None

        return None

    def _query_raw_json(
        self,
        system_prompt: str,
        user_content: str,
        response_model: Type[T],
    ) -> Optional[T]:
        """
        Raw JSON fallback using model JSON prompt.
        Used when structured_output() is unavailable for the provider.
        """
        try:
            from langchain_core.messages import HumanMessage, SystemMessage
            prompt = (
                f"{system_prompt}\n\n"
                f"IMPORTANT: Output ONLY valid JSON matching this schema: {response_model.model_json_schema()}"
            )
            from langchain_openai import ChatOpenAI
            fb_key, _ = _get_active_api_key()
            fb_model = ChatOpenAI(
                model=self.model,
                api_key=fb_key or self.api_key or "NO_KEY",
                base_url=self.base_url,
                temperature=0, timeout=90, max_retries=0,
            )
            with _LLM_SEMAPHORE:
                _llm_throttle()
                msg = fb_model.invoke([
                    SystemMessage(content=prompt),
                    HumanMessage(content=user_content),
                ])
            raw = getattr(msg, "content", "")
            if not raw:
                return None

            # Extract JSON block
            raw_str = str(raw)
            json_start = raw_str.find("{")
            json_end = raw_str.rfind("}") + 1
            if json_start != -1 and json_end > json_start:
                raw_str = raw_str[json_start:json_end]

            parsed = json.loads(raw_str)
            # Unwrap if nested under model name
            model_name = response_model.__name__
            if isinstance(parsed, dict) and len(parsed) == 1:
                first_key = list(parsed.keys())[0]
                if first_key.lower() == model_name.lower():
                    parsed = parsed[first_key]

            return response_model.model_validate(parsed)
        except Exception as e:
            logger.error("[CyroLLM] Raw JSON fallback failed: %s", e)
            return None


# ── Module-level alias for drop-in backward compatibility ────────────────────
# Existing code imports: from web.cyro_engine.mistral_client import MistralClient
MistralClient = LangChainClient
