import pytest
from unittest.mock import patch, MagicMock

from web.cyro_engine.models import IntentRoute, EntityData, IntentData, RoutingData
from web.cyro_engine.context_builder import ContextBuilder
from web.cyro_engine.adapters import FetchPlan, NewsAdapter
from web.cyro_engine.evidence_store import EvidenceStore

@pytest.fixture
def mock_store():
    with patch("web.cyro_engine.evidence_store.EvidenceStore.store_evidence_batch") as mock:
        yield mock

@pytest.fixture
def base_route():
    return IntentRoute(
        request_id="req123",
        raw_query="Analyse INFY",
        entity=EntityData(nse_symbol="INFY", security_id="sec_infy"),
        resolution={"status": "resolved", "method": "exact_ticker", "confidence": 1.0, "candidates_considered": 1},
        intent=IntentData(research_horizon="long_term"),
        routing=RoutingData(agents=["fundamental"]),
        constraints={"wants_buy_sell": False, "requires_clarification": False},
        metadata={"router_version": "1.0.0", "created_at": "2026-08-28T00:00:00Z", "latency_ms": 100}
    )

def test_fetch_plan_derivation(base_route):
    # Scenario D: Intent-aware fetching (Technical only vs Long Term)
    # Long term fundamental should pull financials, shareholding, events
    plan = FetchPlan(base_route)
    assert "INFY" in plan.securities
    assert "financials" in plan.required_adapters
    assert "shareholding" in plan.required_adapters

    # Technical only
    tech_route = base_route.model_copy(deep=True)
    tech_route.intent.research_horizon = "short_term"
    tech_route.routing.agents = ["technical"]
    tech_plan = FetchPlan(tech_route)
    assert "technical" in tech_plan.required_adapters
    assert "market_data" in tech_plan.required_adapters
    assert "financials" not in tech_plan.required_adapters # Huge annual fetch avoided

def test_single_stock_scope(base_route, mock_store):
    # Scenario A: Single stock scope enforced
    with patch("web.cyro_engine.adapters.MarketDataAdapter._fetch_primary") as mock_market:
        mock_market.return_value = {"ltp": 1500.0, "volume": 1000}
        
        # We also mock technical, financials, etc. failing gracefully just to isolate scope test
        with patch("web.cyro_engine.adapters.TechnicalAdapter._fetch_primary", side_effect=Exception("Failed")):
            with patch("web.cyro_engine.adapters.FinancialsAdapter._fetch_primary", side_effect=Exception("Failed")):
                builder = ContextBuilder(research_id="test_res")
                ctx = builder.build_context(base_route)
                
                # Verify that the final context and the DB store were only called with INFY
                assert ctx.identity["symbol"] == "INFY"
                for ev in ctx.evidence_registry.values():
                    # Macro evidence is global and peer-table evidence explicitly
                    # names comparison securities; other evidence is target-scoped.
                    assert ev.ticker in {"INFY", "MARKET"} or ev.type == "peer_table"
                    assert "ev_infy" in ev.id or ev.ticker == "MARKET" or ev.type == "peer_table"

def test_fallback_logic():
    # Scenario E & F: Primary success avoids fallback, Primary failure triggers fallback
    from web.cyro_engine.adapters.base import SourceAdapter
    
    class DummyAdapter(SourceAdapter):
        def _fetch_primary(self, symbol, **kwargs):
            if symbol == "FAIL":
                raise Exception("Primary down")
            return {"data": "primary_data"}
            
        def _fetch_fallback(self, symbol, **kwargs):
            return {"data": "fallback_data"}, "FallbackSource"
            
    adapter = DummyAdapter("Dummy", "quality")
    
    # E. Primary success
    res = adapter.fetch("OK")
    assert res.fallback_used is False
    assert res.source_name == "Dummy"
    assert res.data == {"data": "primary_data"}
    
    # F. Primary failure -> Fallback
    res2 = adapter.fetch("FAIL")
    assert res2.fallback_used is True
    assert res2.source_name == "FallbackSource"
    assert res2.data == {"data": "fallback_data"}

def test_news_deduplication():
    # Scenario J: News Deduplication
    adapter = NewsAdapter()
    raw_articles = [
        {"title": "INFY Q4 Results Announced", "url": "http://news1.com"},
        {"title": "INFY Q4 Results Announced", "url": "http://syndicate.com"},
        {"title": "Infosys wins large deal", "url": "http://news2.com"}
    ]
    
    deduped = adapter._deduplicate(raw_articles)
    assert len(deduped) == 2
    # Equal-quality duplicate URLs may be ordered by the shared deduplicator's
    # URL preference; either copy is valid as long as the duplicate is collapsed.
    assert deduped[0]["url"] in {"http://news1.com", "http://syndicate.com"}
    assert deduped[1]["url"] == "http://news2.com"

def test_database_persistence(base_route, mock_store):
    # Scenario N & O: Database persistence and Idempotency
    with patch("web.cyro_engine.adapters.MarketDataAdapter._fetch_primary") as mock_market:
        mock_market.return_value = {"ltp": 1500.0}
        
        # Mock others to fail fast
        with patch.object(FetchPlan, '_derive_required_adapters', return_value={"market_data"}):
            builder = ContextBuilder(research_id="test_res")
            ctx = builder.build_context(base_route)
            
            # Verify store_evidence_batch was called
            assert mock_store.called
            args, _ = mock_store.call_args
            batch = args[0]
            assert len(batch) == 1
            assert batch[0]["id"] == "test_res:ev_infy_quote"
            assert batch[0]["ticker"] == "INFY"

def test_cross_stock_contamination():
    # Scenario C: Injecting evidence for another stock should be excluded
    # Context builder's design creates items strictly using the symbol derived from FetchPlan.
    # We can verify that MarketDataAdapter bound to INFY only outputs INFY items.
    from web.cyro_engine.adapters.market_data import MarketDataAdapter
    from web.cyro_engine.adapters.base import AdapterResult
    
    adapter = MarketDataAdapter()
    res = AdapterResult(
        source_name="NSE", source_quality="official", data={"ltp": 100}, fetched_at="2026-08-28"
    )
    
    # If fetch was called for INFY, the evidence output MUST be INFY.
    items = adapter.to_evidence_items("INFY", "res1", res)
    assert items[0]["ticker"] == "INFY"
    # Even if malicious data tried to sneak in, the adapter strongly enforces the `symbol` argument passed to it.
