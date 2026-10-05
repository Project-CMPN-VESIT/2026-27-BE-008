import pytest
from unittest.mock import patch, MagicMock
from web.cyro_engine.models import StockResearchContext, EvidenceItem
from web.cyro_engine.agents_fundamental import run_fundamental_analyst

@pytest.fixture
def mock_intent_route():
    class MockEntity:
        security_id = "INFY"
        ticker = "INFY"
        company_name = "Infosys Ltd"
        
    class MockIntent:
        research_horizon = "long_term"
        
    class MockRoute:
        entity = MockEntity()
        intent = MockIntent()
        
    return MockRoute()

@pytest.fixture
def valid_context():
    context = StockResearchContext()
    context.evidence_registry = {
        "ev_1": EvidenceItem(
            id="ev_1",
            research_id="test_res",
            ticker="INFY",
            type="financial",
            source_quality="high",
            source_name="test_source",
            title="test_title",
            fetched_at="2023-01-01T00:00:00Z",
            excerpt="test excerpt",
            security_id="INFY",
            category="financials",
            facts=[{
                "pe": 25.0,
                "roe": 30.0,
                "debt_equity": 0.0,
                "free_cash_flow": 15000,
                "npm": 15.0
            }]
        ),
        "ev_2": EvidenceItem(
            id="ev_2",
            research_id="test_res",
            ticker="INFY",
            type="financial",
            source_quality="high",
            source_name="test_source",
            title="test_title",
            fetched_at="2023-01-01T00:00:00Z",
            excerpt="test excerpt",
            security_id="INFY",
            category="financials",
            facts=[{
                "sales_growth": 12.0,
                "profit_growth": 10.0
            }]
        )
    }
    return context

@patch("web.cyro_engine.agents_fundamental.LangChainClient")
def test_valid_fundamental_context(mock_client, mock_intent_route, valid_context):
    """Scenario A: Valid INFY fundamental context"""
    mock_client.return_value.query.return_value.model_dump.return_value = {
        "summary": "Constructive",
        "claims": [{
            "id": "c1",
            "text": "Strong ROE",
            "category": "profitability",
            "stance": "positive",
            "importance": "high",
            "evidence_ids": ["ev_1"],
            "confidence": 90,
            "limitations": []
        }],
        "limitations": []
    }
    
    report = run_fundamental_analyst(mock_intent_route, valid_context)
    assert report.summary == "Constructive"
    assert len(report.claims) == 1
    assert report.claims[0].evidence_ids == ["ev_1"]


@patch("web.cyro_engine.agents_fundamental.LangChainClient")
def test_single_stock_isolation(mock_client, mock_intent_route, valid_context):
    """Scenario B: Single-stock isolation (inject malicious TCS evidence)"""
    mock_client.return_value.query.return_value.model_dump.return_value = {
        "summary": "Constructive", "claims": [], "limitations": []
    }
    
    # Inject malicious TCS evidence
    valid_context.evidence_registry["ev_tcs"] = EvidenceItem(
        id="ev_tcs",
        research_id="test_res",
        ticker="TCS",
        type="financial",
        source_quality="high",
        source_name="test_source",
        title="test_title",
        fetched_at="2023-01-01T00:00:00Z",
        excerpt="test excerpt",
        security_id="TCS",
        category="financials",
        facts=[{"roe": 50.0}]
    )
    
    run_fundamental_analyst(mock_intent_route, valid_context)
    
    # Verify the LLM prompt didn't receive TCS evidence
    prompt = mock_client.return_value.query.call_args[0][0]
    assert "ev_tcs" not in prompt
    assert "ev_1" in prompt


@patch("web.cyro_engine.agents_fundamental.LangChainClient")
def test_missing_evidence(mock_client, mock_intent_route):
    """Scenario D/E: Missing evidence yielding correct unavailable handling"""
    
    empty_context = StockResearchContext()
    report = run_fundamental_analyst(mock_intent_route, empty_context)
    
    assert "UNAVAILABLE" in report.summary
    assert not mock_client.return_value.query.called


@patch("web.cyro_engine.agents_fundamental.LangChainClient")
def test_llm_failure(mock_client, mock_intent_route, valid_context):
    """Scenario Q: LLM failure handled safely"""
    mock_client.return_value.query.side_effect = Exception("Mistral Timeout")
    
    report = run_fundamental_analyst(mock_intent_route, valid_context)
    assert "LLM_UNAVAILABLE" in report.summary


@patch("web.cyro_engine.agents_fundamental.LangChainClient")
def test_evidence_citation_validation(mock_client, mock_intent_route, valid_context):
    """Scenario S: Evidence citation validation"""
    # LLM hallucinates an evidence ID "ev_fake"
    mock_client.return_value.query.return_value.model_dump.return_value = {
        "summary": "Constructive",
        "claims": [{
            "id": "c1",
            "text": "Fake claim",
            "category": "health",
            "stance": "positive",
            "importance": "high",
            "evidence_ids": ["ev_1", "ev_fake"],
            "confidence": 90,
            "limitations": []
        }],
        "limitations": []
    }
    
    report = run_fundamental_analyst(mock_intent_route, valid_context)
    # The fake evidence ID should be stripped out!
    assert report.claims[0].evidence_ids == ["ev_1"]
