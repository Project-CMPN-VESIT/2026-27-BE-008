from typing import Dict, Any, List
from .base import SourceAdapter, AdapterResult
from .db_utils import get_pipeline_data

class InsiderAdapter(SourceAdapter):
    """Fetches insider trading and bulk/block deals from the pipeline DB."""
    
    def __init__(self):
        super().__init__(name="Insider and Deals", default_quality="official_disclosure")

    def _fetch_primary(self, symbol: str, **kwargs) -> Any:
        data = get_pipeline_data(symbol)
        if not data:
            raise Exception(f"No pipeline data found for {symbol}")
            
        insider_trading = data.get("insider_trading", [])
        deals = data.get("deals", [])
        
        return {
            "insider_trading": insider_trading,
            "deals": deals
        }

    def _build_evidence(self, symbol: str, research_id: str, result: AdapterResult) -> List[Dict[str, Any]]:
        evidence_list = []
        insider_trading = (result.data or {}).get("insider_trading", [])
        deals = (result.data or {}).get("deals", [])
        
        # Insider Trading
        for idx, item in enumerate(insider_trading[:5]):
            date_str = item.get("date", "")
            acquirer = item.get("acquirer", item.get("personName", "Unknown Insider"))
            mode = item.get("acquisition_mode", item.get("modeOfAcquisition", ""))
            sec_acq = item.get("sec_acquired", item.get("secAcquired", 0))
            sec_disp = item.get("sec_disposed", item.get("secDisposed", 0))
            
            fact = f"Insider {acquirer} "
            if int(sec_acq) > 0:
                fact += f"acquired {sec_acq} shares via {mode}"
            elif int(sec_disp) > 0:
                fact += f"disposed {sec_disp} shares via {mode}"
            else:
                fact += f"reported transaction via {mode}"
                
            evidence = {
                "id": f"ev_{symbol.lower()}_insider_{idx}",
                "research_id": research_id,
                "ticker": symbol.upper(),
                "type": "regulatory_disclosure",
                "category": "insider_activity",
                "source_quality": result.source_quality,
                "source_name": result.source_name,
                "title": f"Insider Transaction: {acquirer}",
                "published_at": date_str,
                "fetched_at": result.fetched_at,
                "excerpt": fact,
                "facts": [{"insider_transaction": fact}],
                "freshness": result.freshness
            }
            evidence_list.append(evidence)
            
        # Deals
        for idx, item in enumerate(deals[:5]):
            date_str = item.get("date", item.get("dealDate", ""))
            client = item.get("client_name", item.get("clientName", "Unknown"))
            deal_type = item.get("deal_type", item.get("buyOrSell", ""))
            qty = item.get("quantity", item.get("quantityTraded", 0))
            price = item.get("price", item.get("tradePrice", 0))
            
            fact = f"Institution {client} {deal_type.lower()}ed {qty} shares at {price}"
                
            evidence = {
                "id": f"ev_{symbol.lower()}_deal_{idx}",
                "research_id": research_id,
                "ticker": symbol.upper(),
                "type": "regulatory_disclosure",
                "category": "block_deals",
                "source_quality": result.source_quality,
                "source_name": result.source_name,
                "title": f"Institutional Deal: {client}",
                "published_at": date_str,
                "fetched_at": result.fetched_at,
                "excerpt": fact,
                "facts": [{"institutional_deal": fact}],
                "freshness": result.freshness
            }
            evidence_list.append(evidence)
            
        return evidence_list
