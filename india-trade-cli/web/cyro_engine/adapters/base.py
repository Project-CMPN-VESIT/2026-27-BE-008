import logging
import queue
import threading
from typing import Dict, Any, List, Optional, Tuple
from datetime import datetime
from pydantic import BaseModel

logger = logging.getLogger(__name__)

class AdapterResult(BaseModel):
    source_name: str
    source_quality: str
    data: Optional[Dict[str, Any]] = None
    list_data: Optional[List[Dict[str, Any]]] = None
    error: Optional[str] = None
    primary_error: Optional[str] = None
    fallback_used: bool = False
    fetched_at: str
    as_of: Optional[str] = None
    freshness: str = "current"

class SourceAdapter:
    """Base class for all CYRO context source adapters."""
    
    def __init__(self, name: str, default_quality: str, timeout: int = 10, cache_ttl: int = 300):
        self.name = name
        self.default_quality = default_quality
        self.timeout = timeout
        self.cache_ttl = cache_ttl
        self._active_calls = threading.BoundedSemaphore(2)

    def _with_timeout(self, fn, *args, **kwargs):
        """Bound the caller's wait even when a legacy provider ignores its own timeout."""
        if not self._active_calls.acquire(timeout=max(0.1, float(self.timeout))):
            raise TimeoutError(f"{self.name} has too many outstanding provider calls")
        result_queue: queue.Queue = queue.Queue(maxsize=1)

        def invoke():
            try:
                result_queue.put((True, fn(*args, **kwargs)))
            except BaseException as exc:  # propagate provider exceptions to the caller
                result_queue.put((False, exc))
            finally:
                self._active_calls.release()

        try:
            threading.Thread(target=invoke, name=f"cyro-source-{self.name[:24]}", daemon=True).start()
        except Exception:
            self._active_calls.release()
            raise
        try:
            ok, value = result_queue.get(timeout=max(0.1, float(self.timeout)))
        except queue.Empty as exc:
            raise TimeoutError(f"{self.name} exceeded {self.timeout}s timeout") from exc
        if not ok:
            raise value
        return value

    @staticmethod
    def _empty(value: Any) -> bool:
        return value is None or value == {} or value == []

    @staticmethod
    def _split_fallback(value: Any) -> Tuple[Any, str, Optional[str]]:
        if not isinstance(value, tuple) or len(value) not in (2, 3):
            raise TypeError("Fallback must return (data, source_name[, source_quality])")
        data, name = value[0], value[1]
        quality = value[2] if len(value) == 3 else None
        return data, str(name), str(quality) if quality else None
        
    def fetch(self, symbol: str, **kwargs) -> AdapterResult:
        """
        Orchestrates fetch with timeout and fallback handling.
        Returns a structured AdapterResult.
        """
        fetched_at = datetime.utcnow().isoformat() + "Z"
        
        primary_error: Optional[str] = None
        try:
            data = self._with_timeout(self._fetch_primary, symbol, **kwargs)
            if not self._empty(data):
                return AdapterResult(
                    source_name=self.name,
                    source_quality=self.default_quality,
                    data=data if isinstance(data, dict) else None,
                    list_data=data if isinstance(data, list) else None,
                    fetched_at=fetched_at,
                )
            primary_error = "Primary source returned no data"
            logger.info("[%s] Primary fetch returned no data for %s; trying fallback", self.name, symbol)
        except Exception as exc:
            primary_error = str(exc)
            logger.warning("[%s] Primary fetch failed for %s: %s", self.name, symbol, exc)

        try:
            fallback_data, fallback_source, fallback_quality = self._split_fallback(
                self._with_timeout(self._fetch_fallback, symbol, **kwargs)
            )
            empty = self._empty(fallback_data)
            quality = fallback_quality or "FALLBACK"
            return AdapterResult(
                source_name=fallback_source,
                source_quality=quality,
                data=fallback_data if isinstance(fallback_data, dict) else None,
                list_data=fallback_data if isinstance(fallback_data, list) else None,
                primary_error=primary_error,
                fallback_used=True,
                fetched_at=fetched_at,
                freshness="empty" if empty else "current",
            )
        except Exception as fallback_exc:
            logger.error("[%s] Fallback fetch failed for %s: %s", self.name, symbol, fallback_exc)
            return AdapterResult(
                source_name=self.name,
                source_quality=self.default_quality,
                error=f"Primary: {primary_error}; fallback: {fallback_exc}",
                primary_error=primary_error,
                freshness="unavailable",
                fetched_at=fetched_at,
            )

    def _fetch_primary(self, symbol: str, **kwargs) -> Any:
        """To be implemented by subclasses. Should raise exception on failure."""
        raise NotImplementedError

    def _fetch_fallback(self, symbol: str, **kwargs) -> tuple[Any, str]:
        """
        To be implemented by subclasses. 
        Returns (data, fallback_source_name). Raises exception if no fallback.
        """
        raise Exception("No fallback configured")

    def to_evidence_items(self, symbol: str, research_id: str, result: AdapterResult) -> List[Dict[str, Any]]:
        """
        Transforms the adapter result into standardized CYRO EvidenceItem dictionaries 
        ready for the EvidenceStore and StockResearchContext.
        """
        if result.error or result.freshness == "empty" or (not result.data and not result.list_data):
            return []
            
        return self._build_evidence(symbol, research_id, result)
        
    def _build_evidence(self, symbol: str, research_id: str, result: AdapterResult) -> List[Dict[str, Any]]:
        """To be implemented by subclasses to handle specific normalizations."""
        return []
