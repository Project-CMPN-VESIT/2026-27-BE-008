import json
import logging
from typing import Any, Dict, List
from .base import SourceAdapter, AdapterResult
from web.cyro_engine.models import EvidenceItem

logger = logging.getLogger(__name__)

class PeerAdapter(SourceAdapter):
    def __init__(self):
        super().__init__(name="CYRO Sector/Peer Engine", default_quality="calculated", timeout=30, cache_ttl=3600)
        
    def _fetch_primary(self, symbol: str, **kwargs) -> Any:
        from web.cyro_engine.tools.market_tools import get_sector_peers
        
        # get_sector_peers returns a JSON string, we need to parse it
        peer_json_str = get_sector_peers.invoke({"symbol": symbol})
        try:
            peer_data = json.loads(peer_json_str)
        except json.JSONDecodeError:
            raise ValueError(f"Failed to parse peer data JSON: {peer_json_str}")
            
        if not peer_data or "peers" not in peer_data:
            raise ValueError(f"Invalid peer data format for {symbol}")
            
        if not peer_data["peers"]:
            raise ValueError(f"No peers found for {symbol} in sector {peer_data.get('sector', 'Unknown')}")
            
        return peer_data

    def _fetch_fallback(self, symbol: str, **kwargs) -> tuple[Any, str]:
        raise Exception("No fallback configured for sector/peer engine")

    def _build_evidence(self, symbol: str, research_id: str, result: AdapterResult) -> List[Dict[str, Any]]:
        if not result.data:
            return []
            
        peer_data = result.data
        sector_name = peer_data.get("sector", "Unknown")
        peers = peer_data.get("peers", [])
        
        items = []
        
        # 1. Sector Identity/Average
        sector_ev_id = f"ev_{symbol.lower()}_sector_idx"
        valid_pes = [p.get("pe") for p in peers if p.get("pe") is not None]
        avg_pe = sum(valid_pes) / len(valid_pes) if valid_pes else None
        
        items.append(
            EvidenceItem(
                id=sector_ev_id, 
                research_id=research_id, 
                ticker="MARKET", # Applies to sector broadly
                type="sector_indicators",
                category="sector",
                source_quality=result.source_quality,
                source_name=result.source_name,
                title=f"Sector: {sector_name}",
                fetched_at=result.fetched_at, 
                excerpt=f"Sector '{sector_name}' containing {len(peers)} identified peers. Average PE: {avg_pe:.2f}" if avg_pe else f"Sector '{sector_name}' with {len(peers)} peers.",
                facts=[{"pe_ratio": avg_pe, "sector": sector_name}],
                freshness=result.freshness,
            ).model_dump()
        )
        
        # 2. Peer Table Evidence
        for peer in peers:
            peer_sym = peer.get("symbol")
            if not peer_sym:
                continue
                
            peer_ev_id = f"ev_{peer_sym.lower()}_peer"
            
            items.append(
                EvidenceItem(
                    id=peer_ev_id, 
                    research_id=research_id, 
                    ticker=peer_sym,
                    security_id=peer_sym, # Best effort without full resolver
                    type="peer_table",
                    category="peer",
                    source_quality=result.source_quality,
                    source_name=result.source_name,
                    title=f"Peer Metrics — {peer_sym}",
                    fetched_at=result.fetched_at, 
                    excerpt=f"Peer: {peer_sym} (PE: {peer.get('pe')}, ROE: {peer.get('roe')})",
                    facts=[peer],
                    freshness=result.freshness,
                ).model_dump()
            )
            
        return items
