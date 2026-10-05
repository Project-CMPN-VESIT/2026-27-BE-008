import time
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime
from pydantic import BaseModel

logger = logging.getLogger(__name__)

class AdapterResult(BaseModel):
    source_name: str
    source_quality: str
    data: Optional[Dict[str, Any]] = None
    list_data: Optional[List[Dict[str, Any]]] = None
    error: Optional[str] = None
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
        
    def fetch(self, symbol: str, **kwargs) -> AdapterResult:
        """
        Orchestrates fetch with timeout and fallback handling.
        Returns a structured AdapterResult.
        """
        fetched_at = datetime.utcnow().isoformat() + "Z"
        
        try:
            # Attempt primary
            data = self._fetch_primary(symbol, **kwargs)
            return AdapterResult(
                source_name=self.name,
                source_quality=self.default_quality,
                data=data if isinstance(data, dict) else None,
                list_data=data if isinstance(data, list) else None,
                fetched_at=fetched_at
            )
        except Exception as e:
            logger.warning(f"[{self.name}] Primary fetch failed for {symbol}: {e}")
            
            # Attempt fallback
            try:
                fallback_data, fallback_source = self._fetch_fallback(symbol, **kwargs)
                return AdapterResult(
                    source_name=fallback_source,
                    source_quality=self.default_quality, # Assuming fallback shares same tier for now
                    data=fallback_data if isinstance(fallback_data, dict) else None,
                    list_data=fallback_data if isinstance(fallback_data, list) else None,
                    fallback_used=True,
                    fetched_at=fetched_at
                )
            except Exception as fallback_e:
                logger.error(f"[{self.name}] Fallback fetch failed for {symbol}: {fallback_e}")
                return AdapterResult(
                    source_name=self.name,
                    source_quality=self.default_quality,
                    error=str(e),
                    freshness="unavailable",
                    fetched_at=fetched_at
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
        if result.error or (not result.data and not result.list_data):
            return []
            
        return self._build_evidence(symbol, research_id, result)
        
    def _build_evidence(self, symbol: str, research_id: str, result: AdapterResult) -> List[Dict[str, Any]]:
        """To be implemented by subclasses to handle specific normalizations."""
        return []
