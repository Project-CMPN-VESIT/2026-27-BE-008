import os
import sqlite3
import pytest
from unittest.mock import patch, MagicMock

from web.cyro_engine.intent_router.security_master import SecurityMaster
from web.cyro_engine.intent_router.router import IntentRouter, LLMIntentExtraction
from web.cyro_engine.models import ResearchRequest

# Provide a clean db for testing
TEST_DB = "test_security_master.db"

@pytest.fixture
def security_master():
    if os.path.exists(TEST_DB):
        os.remove(TEST_DB)
    sm = SecurityMaster(db_path=TEST_DB)
    # Refresh to populate from the fallback map
    sm.refresh()
    yield sm
    if os.path.exists(TEST_DB):
        os.remove(TEST_DB)

def test_security_master_refresh_idempotency(security_master):
    # Get count after first refresh
    if security_master.is_postgres:
        import psycopg2
        conn = psycopg2.connect(security_master.database_url)
    else:
        conn = sqlite3.connect(TEST_DB)
        
    c = conn.cursor()
    c.execute('SELECT COUNT(*) FROM security_master')
    initial_count = c.fetchone()[0]
    conn.close()
    
    assert initial_count > 0, "Security master should have populated records."
    
    # Refresh again
    security_master.refresh()
    
    if security_master.is_postgres:
        conn = psycopg2.connect(security_master.database_url)
    else:
        conn = sqlite3.connect(TEST_DB)
        
    c = conn.cursor()
    c.execute('SELECT COUNT(*) FROM security_master')
    second_count = c.fetchone()[0]
    conn.close()
    
    # Count should remain the same
    assert initial_count == second_count, "Refresh should be idempotent and not create duplicates."

def test_security_master_resolution_exact(security_master):
    res = security_master.resolve("RELIANCE")
    assert res["status"] == "resolved"
    assert len(res["candidates"]) == 1
    assert res["candidates"][0]["nse_symbol"] == "RELIANCE"
    assert res["method"] == "exact_ticker"

def test_security_master_resolution_alias(security_master):
    res = security_master.resolve("hdfc bank")
    assert res["status"] == "resolved"
    assert len(res["candidates"]) == 1
    assert res["candidates"][0]["nse_symbol"] == "HDFCBANK"
    assert res["method"] == "exact_company" or res["method"] == "alias"

def test_security_master_resolution_typo(security_master):
    res = security_master.resolve("relianc")
    assert res["status"] in ["resolved", "ambiguous"]
    assert len(res["candidates"]) >= 1
    assert any(c["nse_symbol"] == "RELIANCE" for c in res["candidates"])
    assert res["method"] == "fuzzy"

@patch('web.cyro_engine.mistral_client.MistralClient')
def test_router_exact_match(MockClient):
    mock_client = MockClient.return_value
    mock_client.query.return_value = LLMIntentExtraction(
        research_horizon="short_term",
        focus=["technical"],
        requested_areas=["technical"],
        routing_agents=["technical"],
        wants_buy_sell=False,
        selected_candidate_id=None,
        requires_clarification=False
    )
    
    router = IntentRouter(client=mock_client, db_path=TEST_DB)
    # Ensure it's populated
    router.security_master.refresh()
    
    req = ResearchRequest(message="Analyse Reliance today", ticker="RELIANCE")
    route = router.route(req)
    
    assert route.entity.nse_symbol == "RELIANCE"
    assert route.resolution.status == "resolved"
    assert route.intent.research_horizon == "short_term"
    assert "technical" in route.routing.agents

@patch('web.cyro_engine.mistral_client.MistralClient')
def test_router_ambiguous_fallback(MockClient):
    mock_client = MockClient.return_value
    # Let Mistral disambiguate
    mock_client.query.return_value = LLMIntentExtraction(
        research_horizon="long_term",
        focus=["general"],
        requested_areas=["general"],
        routing_agents=["fundamental"],
        wants_buy_sell=False,
        selected_candidate_id="NSE:TATAMOTORS",
        requires_clarification=False
    )
    
    router = IntentRouter(client=mock_client, db_path=TEST_DB)
    router.security_master.refresh()
    
    # "tata" is highly ambiguous
    req = ResearchRequest(message="tata")
    route = router.route(req)
    
    assert route.resolution.status == "resolved"
    assert route.entity.nse_symbol == "TATAMOTORS"

@patch('web.cyro_engine.mistral_client.MistralClient')
def test_router_unknown(MockClient):
    mock_client = MockClient.return_value
    mock_client.query.return_value = LLMIntentExtraction(
        research_horizon="unspecified",
        focus=["general"],
        requested_areas=["general"],
        routing_agents=[],
        wants_buy_sell=False,
        selected_candidate_id=None,
        requires_clarification=True
    )
    
    router = IntentRouter(client=mock_client, db_path=TEST_DB)
    router.security_master.refresh()
    
    req = ResearchRequest(message="Analyse SomeUnknownCompany")
    route = router.route(req)
    
    assert route.resolution.status == "unresolved"
    assert route.constraints.requires_clarification is True
