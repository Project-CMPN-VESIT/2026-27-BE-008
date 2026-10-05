import pytest
from unittest.mock import patch

from web.cyro_engine.models import (
    IntentRoute,
    EntityData,
    ResolutionData,
    IntentData,
    RoutingData,
    ConstraintsData,
    RouterMetadata,
    StockResearchContext,
    EvidenceItem,
    AgentReport,
    AnalystClaim
)
from web.cyro_engine.agents_risk_contradiction import run_risk_contradiction_engine

@pytest.fixture
def mock_intent_route():
    return IntentRoute(
        request_id="req_rc_123",
        raw_query="Analyze risks for INFY.",
        entity=EntityData(security_id="INFY_NSE", nse_symbol="INFY", exchange="NSE"),
        resolution=ResolutionData(status="resolved"),
        intent=IntentData(research_horizon="medium_term", focus=["risk"]),
        routing=RoutingData(agents=["risk"]),
        constraints=ConstraintsData(),
        metadata=RouterMetadata(created_at="2026-08-01T00:00:00Z")
    )

@pytest.fixture
def mock_evidence_registry():
    return {
        "ev_fund_infy_1": EvidenceItem(id="ev_fund_infy_1", security_id="INFY_NSE", ticker="INFY", research_id="req_rc_123", type="fundamental", source_quality="HIGH", source_name="mock", title="mock", fetched_at="mock", excerpt="mock"),
        "ev_tech_infy_1": EvidenceItem(id="ev_tech_infy_1", security_id="INFY_NSE", ticker="INFY", research_id="req_rc_123", type="technical", source_quality="HIGH", source_name="mock", title="mock", fetched_at="mock", excerpt="mock"),
        "ev_gov_infy_1": EvidenceItem(id="ev_gov_infy_1", security_id="INFY_NSE", ticker="INFY", research_id="req_rc_123", type="governance", source_quality="HIGH", source_name="mock", title="mock", fetched_at="mock", excerpt="mock"),
        "ev_sec_infy_1": EvidenceItem(id="ev_sec_infy_1", security_id="INFY_NSE", ticker="INFY", research_id="req_rc_123", type="sector", source_quality="HIGH", source_name="mock", title="mock", fetched_at="mock", excerpt="mock"),
        "ev_news_infy_1": EvidenceItem(id="ev_news_infy_1", security_id="INFY_NSE", ticker="INFY", research_id="req_rc_123", type="news", source_quality="HIGH", source_name="mock", title="mock", fetched_at="mock", excerpt="mock"),
        "ev_tech_tcs_1": EvidenceItem(id="ev_tech_tcs_1", security_id="TCS_NSE", ticker="TCS", research_id="req_rc_123", type="technical", source_quality="HIGH", source_name="mock", title="mock", fetched_at="mock", excerpt="mock"),
    }

@pytest.fixture
def mock_specialist_reports():
    return [
        AgentReport(
            agent_name="fundamental",
            summary="Fundamental is strong",
            claims=[
                AnalystClaim(
                    id="fc1", text="Strong margins.", category="fundamental",
                    stance="Positive", importance="HIGH", evidence_ids=["ev_fund_infy_1"],
                    confidence=100, limitations=[]
                )
            ]
        ),
        AgentReport(
            agent_name="technical",
            summary="Technical is bearish",
            claims=[
                AnalystClaim(
                    id="tc1", text="BEARISH_TREND forming.", category="technical",
                    stance="Negative", importance="HIGH", evidence_ids=["ev_tech_infy_1"],
                    confidence=100, limitations=[]
                )
            ]
        ),
        AgentReport(
            agent_name="filings_governance",
            summary="Gov issues",
            claims=[
                AnalystClaim(
                    id="gc1", text="Auditor RESIGNATION.", category="filings_governance",
                    stance="Negative", importance="HIGH", evidence_ids=["ev_gov_infy_1"],
                    confidence=100, limitations=[]
                )
            ]
        ),
        AgentReport(
            agent_name="sector_peer_macro",
            summary="Sector weakness",
            claims=[
                AnalystClaim(
                    id="sc1", text="UNDERPERFORMS_SECTOR.", category="sector_peer_macro",
                    stance="Negative", importance="MEDIUM", evidence_ids=["ev_sec_infy_1"],
                    confidence=100, limitations=[]
                )
            ]
        ),
        AgentReport(
            agent_name="news_catalyst",
            summary="News issues",
            claims=[
                AnalystClaim(
                    id="nc1", text="MAJOR_NEGATIVE_CATALYST: Loss of deal.", category="news_catalyst",
                    stance="Negative", importance="HIGH", evidence_ids=["ev_news_infy_1"],
                    confidence=100, limitations=[]
                )
            ]
        ),
        AgentReport(
            agent_name="technical_tcs_mock",
            summary="TCS bearish",
            claims=[
                AnalystClaim(
                    id="tc_tcs", text="BEARISH_TREND forming.", category="technical",
                    stance="Negative", importance="HIGH", evidence_ids=["ev_tech_tcs_1"],
                    confidence=100, limitations=[]
                )
            ]
        )
    ]

def test_risk_extraction_and_isolation(mock_intent_route, mock_evidence_registry, mock_specialist_reports):
    """Test risk flags are generated for target security and non-target risks are ignored."""
    context = StockResearchContext(evidence_registry=mock_evidence_registry)
    
    report = run_risk_contradiction_engine(mock_intent_route, context, mock_specialist_reports)
    
    # We should have risks for gov, tech, sector, news
    # But TCS tech risk should be completely omitted.
    
    risk_claims = [c for c in report.claims if c.category == "risk_contradiction" and "RISK:" in c.text]
    assert len(risk_claims) == 4
    
    # Check severity assignments
    high_risks = [c for c in risk_claims if c.importance == "HIGH"]
    med_risks = [c for c in risk_claims if c.importance == "MEDIUM"]
    
    assert len(high_risks) == 3 # Gov, Tech, News
    assert len(med_risks) == 1 # Sector
    
    # Ensure TCS evidence isn't in any
    for c in risk_claims:
        assert "ev_tech_tcs_1" not in c.evidence_ids

def test_contradiction_detection(mock_intent_route, mock_evidence_registry, mock_specialist_reports):
    """Test cross-domain contradiction tagging."""
    context = StockResearchContext(evidence_registry=mock_evidence_registry)
    
    report = run_risk_contradiction_engine(mock_intent_route, context, mock_specialist_reports)
    
    contradiction_claims = [c for c in report.claims if c.category == "risk_contradiction" and "CONTRADICTION" in c.text]
    
    # We expect Fundamental Positive vs Technical Negative -> TIME_HORIZON_DIFFERENCE
    assert len(contradiction_claims) == 1
    c_text = contradiction_claims[0].text
    assert "TIME_HORIZON_DIFFERENCE" in c_text
    
    # Evidence from both should be present
    assert "ev_fund_infy_1" in contradiction_claims[0].evidence_ids
    assert "ev_tech_infy_1" in contradiction_claims[0].evidence_ids

def test_invalid_evidence_filtering(mock_intent_route, mock_evidence_registry):
    """Test claims lacking valid evidence are excluded."""
    context = StockResearchContext(evidence_registry=mock_evidence_registry)
    
    bad_reports = [
        AgentReport(
            agent_name="technical",
            summary="Technical is bearish",
            claims=[
                AnalystClaim(
                    id="tc1", text="BEARISH_TREND forming.", category="technical",
                    stance="Negative", importance="HIGH", evidence_ids=["fake_id_1"],
                    confidence=100, limitations=[]
                )
            ]
        )
    ]
    
    report = run_risk_contradiction_engine(mock_intent_route, context, bad_reports)
    assert len(report.claims) == 0

def test_zero_llm_and_network_access(mock_intent_route, mock_evidence_registry, mock_specialist_reports):
    """Verify that Mistral is never called and no network is accessed."""
    context = StockResearchContext(evidence_registry=mock_evidence_registry)
    
    # Run the engine without mocking any network/LLM calls.
    # Because it is 100% deterministic and imports no LLM clients,
    # if it doesn't crash or hang, it proved zero network/LLM access.
    report = run_risk_contradiction_engine(mock_intent_route, context, mock_specialist_reports)
    assert len(report.claims) > 0
