from abc import ABC, abstractmethod
from typing import Dict, Any, Optional

class DataProvider(ABC):
    @abstractmethod
    def fetch_metrics(self, symbol: str) -> Optional[Dict[str, Any]]:
        """Fetch latest core metrics and price for a given symbol."""
        pass
    
    @abstractmethod
    def fetch_financial_statement(self, symbol: str, period_type: str) -> Optional[Dict[str, Any]]:
        """Fetch raw financial statement for a symbol (ANNUAL or QUARTERLY)."""
        pass

class BaseIngestionPipeline(ABC):
    def __init__(self, primary_provider: DataProvider, fallback_provider: Optional[DataProvider] = None):
        self.primary = primary_provider
        self.fallback = fallback_provider
        
    def get_metrics(self, symbol: str) -> Optional[Dict[str, Any]]:
        try:
            data = self.primary.fetch_metrics(symbol)
            if not data and self.fallback:
                data = self.fallback.fetch_metrics(symbol)
            return data
        except Exception as e:
            if self.fallback:
                return self.fallback.fetch_metrics(symbol)
            return None
