"""LLM access for the chat agent: structured planning + streamed answers, with key rotation and 429 handling."""

from __future__ import annotations

import logging
import time
from typing import Iterator, List, Optional, Tuple, Type, TypeVar

from pydantic import BaseModel

logger = logging.getLogger(__name__)
T = TypeVar("T", bound=BaseModel)

Message = Tuple[str, str]          # ("system" | "user" | "assistant", text)


def structured(system: str, user: str, model_cls: Type[T], retries: int = 1) -> Optional[T]:
    """One structured-output call (the shared client already rotates keys and retries). None on failure."""
    try:
        from web.cyro_engine.mistral_client import LangChainClient

        return LangChainClient().query(system, user, model_cls, retries=retries, research_id="cyro_chat_plan")
    except Exception as exc:
        logger.warning("[CyroChat] structured call failed: %s", exc)
        return None


def _to_lc(messages: List[Message]):
    from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

    cls = {"system": SystemMessage, "user": HumanMessage, "assistant": AIMessage}
    return [cls[r](content=t) for r, t in messages]


def stream_text(messages: List[Message], temperature: float = 0.3, attempts: int = 3) -> Iterator[str]:
    """
    Stream an answer token by token. If a key is rate-limited before the first token, rotate to the next key.
    Raises RuntimeError if no attempt produced anything (the caller then falls back to a data-only answer).
    """
    from langchain_openai import ChatOpenAI

    from web.cyro_engine.mistral_client import LangChainClient, _get_active_api_key

    base = LangChainClient()
    last: Optional[Exception] = None
    for attempt in range(attempts):
        key, slot = _get_active_api_key()
        llm = ChatOpenAI(model=base.model, api_key=key or base.api_key or "NO_KEY", base_url=base.base_url,
                         temperature=temperature, timeout=60, max_retries=0, streaming=True)
        produced = False
        try:
            for chunk in llm.stream(_to_lc(messages)):
                text = getattr(chunk, "content", "") or ""
                if text:
                    produced = True
                    yield text
            if produced:
                return
            last = RuntimeError("empty response")
        except Exception as exc:
            if produced:                       # mid-answer failure: keep what the user already saw
                logger.warning("[CyroChat] stream interrupted: %s", exc)
                return
            last = exc
            text = str(exc)
            if "429" in text or "rate" in text.lower():
                try:
                    from web.cyro_engine.key_pool import mark_rate_limited

                    mark_rate_limited(slot)
                except Exception:
                    pass
        time.sleep(0.8 * (attempt + 1))
    raise RuntimeError(f"LLM unavailable: {last}")


def complete_text(messages: List[Message], temperature: float = 0.2) -> str:
    return "".join(stream_text(messages, temperature=temperature))
