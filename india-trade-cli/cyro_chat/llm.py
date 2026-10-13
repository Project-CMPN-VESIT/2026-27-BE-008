"""LLM access for the chat agent: structured planning + streamed answers, with key rotation and 429 handling."""

from __future__ import annotations

import json
import logging
import time
from typing import Iterator, List, Optional, Tuple, Type, TypeVar

from pydantic import BaseModel

logger = logging.getLogger(__name__)
T = TypeVar("T", bound=BaseModel)

Message = Tuple[str, str]          # ("system" | "user" | "assistant", text)


def _endpoint() -> Tuple[str, str]:
    """(base_url, model) as configured for the rest of CYRO."""
    from web.cyro_engine.mistral_client import LangChainClient

    base = LangChainClient()
    return base.base_url, base.model


def _openai_client(key: str, base_url: str):
    # The plain `openai` SDK speaks to Mistral's OpenAI-compatible API and is a hard dependency of CYRO,
    # unlike langchain_openai, which is missing from some Python installs.
    from openai import OpenAI

    return OpenAI(api_key=key or "NO_KEY", base_url=base_url, timeout=60, max_retries=0)


def _rotate_on_429(exc: Exception, slot: int) -> None:
    text = str(exc)
    if "429" in text or "rate" in text.lower():
        try:
            from web.cyro_engine.key_pool import mark_rate_limited

            mark_rate_limited(slot)
        except Exception:
            pass


def structured(system: str, user: str, model_cls: Type[T], retries: int = 1) -> Optional[T]:
    """One structured-output call. Tries the shared client first, then plain JSON mode. None on failure."""
    try:
        from web.cyro_engine.mistral_client import LangChainClient

        out = LangChainClient().query(system, user, model_cls, retries=retries, research_id="cyro_chat_plan")
        if out is not None:
            return out
    except Exception as exc:
        logger.info("[CyroChat] shared structured client unavailable (%s); using JSON mode", exc)
    try:
        from web.cyro_engine.mistral_client import _get_active_api_key

        base_url, model = _endpoint()
        schema = json.dumps(model_cls.model_json_schema())
        prompt = f"{system}\n\nRespond with ONLY a JSON object that validates against this JSON schema:\n{schema}"
        last: Optional[Exception] = None
        for attempt in range(retries + 2):
            key, slot = _get_active_api_key()
            try:
                r = _openai_client(key, base_url).chat.completions.create(
                    model=model, temperature=0, response_format={"type": "json_object"},
                    messages=[{"role": "system", "content": prompt}, {"role": "user", "content": user}])
                return model_cls.model_validate_json(r.choices[0].message.content or "{}")
            except Exception as exc:                                   # noqa: BLE001
                last = exc
                _rotate_on_429(exc, slot)
                time.sleep(0.5 * (attempt + 1))
        logger.warning("[CyroChat] structured call failed: %s", last)
    except Exception as exc:                                           # noqa: BLE001
        logger.warning("[CyroChat] structured call failed: %s", exc)
    return None


def _to_openai(messages: List[Message]) -> List[dict]:
    return [{"role": r, "content": t} for r, t in messages]


def stream_text(messages: List[Message], temperature: float = 0.3, attempts: int = 3) -> Iterator[str]:
    """
    Stream an answer token by token. If a key is rate-limited before the first token, rotate to the next key.
    Raises RuntimeError if no attempt produced anything (the caller then falls back to a data-only answer).
    """
    from web.cyro_engine.mistral_client import _get_active_api_key

    base_url, model = _endpoint()
    last: Optional[Exception] = None
    for attempt in range(attempts):
        key, slot = _get_active_api_key()
        produced = False
        try:
            stream = _openai_client(key, base_url).chat.completions.create(
                model=model, temperature=temperature, stream=True, messages=_to_openai(messages))
            for chunk in stream:
                text = (chunk.choices[0].delta.content or "") if chunk.choices else ""
                if text:
                    produced = True
                    yield text
            if produced:
                return
            last = RuntimeError("empty response")
        except Exception as exc:                                       # noqa: BLE001
            if produced:                       # mid-answer failure: keep what the user already saw
                logger.warning("[CyroChat] stream interrupted: %s", exc)
                return
            last = exc
            _rotate_on_429(exc, slot)
        time.sleep(0.8 * (attempt + 1))
    raise RuntimeError(f"LLM unavailable: {last}")


def complete_text(messages: List[Message], temperature: float = 0.2) -> str:
    return "".join(stream_text(messages, temperature=temperature))
