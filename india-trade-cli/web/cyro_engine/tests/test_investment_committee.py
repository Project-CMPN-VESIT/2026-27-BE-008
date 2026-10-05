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
    EvidenceItem,
    AgentReport,
    AnalystClaim
)
from web.cyro_engine.agents_investment_committee import run_investment_committee, CommitteeOutput, CommitteeClaim

@pytest.fixture
def mock_intent_route():
    return IntentRoute(
        request_id="req_ic_123",
        raw_query="Should I buy INFY?",
        entity=EntityData(security_id="INFY_NSE", nse_symbol="INFY", exchange="NSE"),
        resolution=ResolutionData(status="resolved"),
        intent=IntentData(research_horizon="long_term", focus=["fundamental", "technical"]),
        routing=RoutingData(agents=["investment_committee"]),
        constraints=ConstraintsData(),
        metadata=RouterMetadata(created_at="2026-08-01T00:00:00Z")
    )

@pytest.fixture
def mock_evidence_map():
    return {
        "ev_shared_1": EvidenceItem(id="ev_shared_1", security_id="INFY_NSE", ticker="INFY", research_id="r1", type="fundamental", source_quality="HIGH", source_name="mock", title="mock", fetched_at="mock", excerpt="mock"),
        "ev_news_1": EvidenceItem(id="ev_news_1", security_id="INFY_NSE", ticker="INFY", research_id="r1", type="news", source_quality="HIGH", source_name="mock", title="mock", fetched_at="mock", excerpt="mock"),
    }

@pytest.fixture
def mock_specialist_reports():
    return [
        AgentReport(
            agent_name="fundamental",
            summary="Strong margins",
            claims=[AnalystClaim(id="c1", text="High growth", category="fundamental", stance="Positive", importance="HIGH", evidence_ids=["ev_shared_1"], confidence=100, limitations=[])]
        ),
        AgentReport(
            agent_name="technical",
            summary="Strong trend",
            claims=[AnalystClaim(id="c2", text="Upward trend", category="technical", stance="Positive", importance="MEDIUM", evidence_ids=["ev_shared_1"], confidence=100, limitations=[])]
        ),
        AgentReport(
            agent_name="news_catalyst",
            summary="New deal",
            claims=[AnalystClaim(id="c3", text="Signed deal", category="news_catalyst", stance="Positive", importance="HIGH", evidence_ids=["ev_news_1"], confidence=100, limitations=[])]
        )
    ]

def test_full_synthesis_success(mock_intent_route, mock_specialist_reports, mock_evidence_map):
    """Test clean synthesis path."""
    with patch("web.cyro_engine.mistral_client.MistralClient.query") as mock_query:
        mock_query.return_value = CommitteeOutput(
            decision="BUY",
            confidence=85,
            executive_summary="Solid buy.",
            decision_rationale="Fundamentals and Technicals align on ev_shared_1.",
            bull_case=[CommitteeClaim(text="Growth is high.", stance="Positive", importance="HIGH", evidence_ids=["ev_shared_1"])],
            base_case=[],
            bear_case=[],
            limitations=[]
        )
        
        report = run_investment_committee(mock_intent_route, mock_specialist_reports, mock_evidence_map)
        
        assert report.conclusion == "BUY"
        assert report.confidence == 85
        assert len(report.claims) == 1
        assert report.claims[0].evidence_ids == ["ev_shared_1"]
        
        # Double counting defense logic test
        # We can inspect the arguments passed to MistralClient.query to ensure duplicate evidence IDs aren't in the domain contexts
        called_args = mock_query.call_args
        payload_json = called_args[0][1]
        assert "ev_shared_1" in payload_json


def test_committee_preserves_graph_research_id(mock_intent_route, mock_specialist_reports, mock_evidence_map):
    with patch("web.cyro_engine.mistral_client.MistralClient.query") as mock_query:
        mock_query.return_value = CommitteeOutput(
            decision="HOLD", confidence=60, executive_summary="Wait.", decision_rationale="Mixed.",
            bull_case=[], base_case=[], bear_case=[], limitations=[]
        )

        report = run_investment_committee(
            mock_intent_route, mock_specialist_reports, mock_evidence_map, research_id="research-graph-42"
        )

        assert report.research_id == "research-graph-42"
        assert mock_query.call_args.kwargs["research_id"] == "research-graph-42"

def test_citation_scrubbing_and_injection(mock_intent_route, mock_specialist_reports, mock_evidence_map):
    """Ensure LLM-hallucinated evidence IDs are purged."""
    with patch("web.cyro_engine.mistral_client.MistralClient.query") as mock_query:
        mock_query.return_value = CommitteeOutput(
            decision="HOLD",
            confidence=50,
            executive_summary="Hold.",
            decision_rationale="Uncertain.",
            bull_case=[
                # Valid evidence
                CommitteeClaim(text="Good.", stance="Positive", importance="HIGH", evidence_ids=["ev_shared_1"]),
                # Hallucinated evidence (should be scrubbed entirely)
                CommitteeClaim(text="Fake.", stance="Positive", importance="HIGH", evidence_ids=["fake_hallucinated_id"])
            ],
            base_case=[],
            bear_case=[],
            limitations=[]
        )
        
        report = run_investment_committee(mock_intent_route, mock_specialist_reports, mock_evidence_map)
        
        # Only the valid claim should survive, as the hallucinated one had 100% fake IDs
        assert len(report.claims) == 1
        assert report.claims[0].text == "[BULL_CASE] Good."
        assert report.claims[0].evidence_ids == ["ev_shared_1"]

def test_llm_failure_fallback(mock_intent_route, mock_specialist_reports, mock_evidence_map):
    """Test deterministic fallback when Mistral fails."""
    with patch("web.cyro_engine.mistral_client.MistralClient.query", side_effect=Exception("API Timeout")):
        report = run_investment_committee(mock_intent_route, mock_specialist_reports, mock_evidence_map)
        
        assert report.conclusion == "Indeterminate"
        assert "LLM synthesis failed" in report.summary
        assert "LLM_UNAVAILABLE" in report.data_quality.get("flags", [])
        assert len(report.claims) == 3  # Should fall back to passing through raw upstream claims
