import pytest
from datetime import datetime
from pydantic import BaseModel
from web.cyro_engine.context_views import build_user_content, _resolve_dot_path
from web.cyro_engine.models import StockResearchContext, EvidenceItem

def create_mock_context():
    return StockResearchContext(
        identity={"symbol": "TCS"},
        financials={"revenue": 1000},
        peer_table=[{"symbol": "INFY"}],
        rag=[
            {"category": "annual_report", "text": "Good year", "evidence_ids": ["ev_1"]},
            {"category": "transcript", "text": "Q1 call", "evidence_ids": ["ev_2"]}
        ],
        news=[{"title": "News 1", "evidence_ids": ["ev_3"]}],
        evidence_registry={
            "ev_1": EvidenceItem(id="ev_1", type="rag_primary_copy", source="doc", fetched_at="2023-01-01T00:00:00Z", source_quality="primary", ticker="TCS", content={}, category="annual_report", research_id="r1", source_name="docs", title="Doc 1", excerpt="Excerpt 1"),
            "ev_2": EvidenceItem(id="ev_2", type="rag_primary_copy", source="doc", fetched_at="2023-01-01T00:00:00Z", source_quality="primary", ticker="TCS", content={}, category="transcript", research_id="r1", source_name="docs", title="Doc 2", excerpt="Excerpt 2"),
            "ev_3": EvidenceItem(id="ev_3", type="news_media", source="web", fetched_at="2023-01-01T00:00:00Z", source_quality="news_media", ticker="TCS", content={}, research_id="r1", source_name="news", title="News 1", excerpt="News excerpt 1")
        }
    )

def test_fundamental_limits_output():
    context = create_mock_context()
    result = build_user_content("fundamental", context)
    
    assert "financials" in result
    assert "peer_table" in result
    assert "identity" in result
    assert "rag" in result
    assert "annual_report" in result["rag"]
    assert "news" not in result
    
def test_risk_bear_outputs_full_context():
    context = create_mock_context()
    result = build_user_content("risk_bear", context)
    
    assert "financials" in result
    assert "peer_table" in result
    assert "news" in result
    assert "rag" in result
    assert len(result["evidence_registry"]) == 3

def test_unverified_evidence_exception():
    context = create_mock_context()
    # Add an unverified evidence ID to a field
    context.rag[0]["evidence_ids"].append("ev_fake")
    
    with pytest.raises(ValueError, match="references evidence_id 'ev_fake' not found"):
        build_user_content("fundamental", context)

def test_dot_path_list_filtering():
    context = create_mock_context()
    resolved = _resolve_dot_path(context, "rag.annual_report")
    assert len(resolved) == 1
    assert resolved[0]["category"] == "annual_report"

def test_missing_dot_paths_graceful():
    context = create_mock_context()
    # Assume context has no policy_items but role asks for it
    result = build_user_content("sector_peer_macro", context)
    assert result.get("policy_items") == []
    assert result.get("identity.sector") is None

def test_evidence_registry_filtering():
    context = create_mock_context()
    result = build_user_content("fundamental", context)
    
    # "fundamental" only uses ev_1 (rag.annual_report) and maybe financials
    assert "ev_1" in result["evidence_registry"]
    # ev_3 is news, should NOT be in the registry for fundamental
    assert "ev_3" not in result["evidence_registry"]
