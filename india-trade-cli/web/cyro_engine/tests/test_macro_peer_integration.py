import pytest
from unittest.mock import patch, MagicMock

from web.cyro_engine.models import (
    ResearchRequest, 
    IntentRoute, 
    EntityData, 
    IntentData, 
    RoutingData
)
from web.cyro_engine.adapters.macro import MacroAdapter
from web.cyro_engine.adapters.peer import PeerAdapter
from web.cyro_engine.adapters.fetch_plan import FetchPlan
from web.cyro_engine.context_builder import ContextBuilder

# 1. Test Macro Adapter
def test_macro_adapter():
    adapter = MacroAdapter()
    
    mock_macro_ctx = {
        "usd_inr": 83.5,
        "brent_crude_usd": 85.2,
        "repo_rate_pct": 6.5,
        "_flags": []
    }
    
    mock_linkages = {
        "summary": "Tailwinds: USD/INR",
        "linkages": [
            {"factor": "USD/INR", "sensitivity": 0.8, "impact": "TAILWIND"}
        ]
    }
    
    with patch("market.cyro_macro.get_macro_context", return_value=mock_macro_ctx):
        with patch("market.macro.get_stock_macro_linkages", return_value=mock_linkages):
            res = adapter.fetch("TCS")
            assert res.error is None
            assert res.data["snapshot"]["usd_inr"] == 83.5
            assert res.data["linkages"]["summary"] == "Tailwinds: USD/INR"
            
            ev_items = adapter.to_evidence_items("TCS", "res_123", res)
            assert len(ev_items) == 1
            assert ev_items[0]["type"] == "macro"
            assert "USD/INR: 83.5" in ev_items[0]["excerpt"]

# 2. Test Peer Adapter
def test_peer_adapter():
    adapter = PeerAdapter()
    
    mock_peer_json = '{"sector": "IT", "peers": [{"symbol": "INFY", "pe": 25.5}]}'
    
    with patch("web.cyro_engine.tools.market_tools.get_sector_peers", return_value=mock_peer_json):
        res = adapter.fetch("TCS")
        assert res.error is None
        assert res.data["sector"] == "IT"
        
        ev_items = adapter.to_evidence_items("TCS", "res_123", res)
        assert len(ev_items) == 2
        
        sector_ev = next(e for e in ev_items if e["type"] == "sector_indicators")
        assert sector_ev["title"] == "Sector: IT"
        assert sector_ev["ticker"] == "MARKET"
        
        peer_ev = next(e for e in ev_items if e["type"] == "peer_table")
        assert peer_ev["ticker"] == "INFY"
        assert peer_ev["facts"][0]["pe"] == 25.5

# 3. Test FetchPlan integration
def test_fetch_plan_includes_macro_peer():
    route = IntentRoute(
        request_id="req_1",
        raw_query="Compare INFY vs peers and macro",
        entity=EntityData(security_id="tcs_1", nse_symbol="TCS", company_name="TCS", exchange="NSE"),
        resolution={"status": "resolved", "confidence": 1.0, "candidates_considered": 1},
        intent=IntentData(research_horizon="long_term", focus=["sector_peer_macro"]),
        routing=RoutingData(agents=["sector_peer_macro"]),
        constraints={"wants_buy_sell": False, "requires_clarification": False},
        metadata={"router_version": "1.0.0", "created_at": "now", "latency_ms": 10}
    )
    
    plan = FetchPlan(route)
    assert "macro" in plan.required_adapters
    assert "peer" in plan.required_adapters

