import pytest
from datetime import datetime, timedelta
from unittest.mock import patch

from web.cyro_engine.models import (
    IntentRoute, EntityData, IntentData, RoutingData,
    StockResearchContext, EvidenceItem
)
from web.cyro_engine.quality_gate import QualityGate

@pytest.fixture
def base_intent():
    return IntentRoute(
        request_id="req1",
        raw_query="Analyse INFY",
        entity=EntityData(security_id="INFY", nse_symbol="INFY"),
        resolution={"status": "resolved", "method": "exact", "confidence": 1.0, "candidates_considered": 1},
        intent=IntentData(research_horizon="long_term"),
        routing=RoutingData(agents=["fundamental", "technical"]),
        constraints={"wants_buy_sell": False, "requires_clarification": False},
        metadata={"router_version": "1.0", "created_at": "2026-08-28T00:00:00Z", "latency_ms": 10}
    )

def create_evidence(ev_id, sec_id, ev_type, source_q, fetched_dt, facts=None, title=""):
    return EvidenceItem(
        id=ev_id,
        research_id="req1",
        security_id=sec_id,
        ticker=sec_id or "UNKNOWN",
        type=ev_type,
        source_quality=source_q,
        source_name="TestSource",
        title=title,
        fetched_at=fetched_dt.isoformat() + "Z",
        excerpt="test",
        facts=facts or []
    )

def test_scenario_a_valid_evidence(base_intent):
    gate = QualityGate()
    base_intent.routing.agents = [] # Don't require other categories
    dt = datetime.utcnow()
    ev = create_evidence("ev1", "INFY", "official_market_data", "official_market_data", dt)
    ctx = StockResearchContext(evidence_registry={"ev1": ev})
    
    res = gate.verify(base_intent, ctx)
    assert res.gate_status == "PASS"
    assert "ev1" in res.accepted_evidence
    assert res.accepted_evidence["ev1"].validation_status == "ACCEPTED"

def test_scenario_b_missing_security_id(base_intent):
    gate = QualityGate()
    ev = create_evidence("ev1", None, "news", "trusted_secondary", datetime.utcnow())
    ctx = StockResearchContext(evidence_registry={"ev1": ev})
    
    res = gate.verify(base_intent, ctx)
    assert "ev1" in res.rejected_evidence
    assert res.rejected_evidence["ev1"].rejection_reason == "MISSING_SECURITY_ID"
    assert "MISSING_SECURITY_ID" in [f.code for f in res.flags]

def test_scenario_c_wrong_security(base_intent):
    gate = QualityGate()
    ev = create_evidence("ev1", "TCS", "news", "trusted_secondary", datetime.utcnow())
    ctx = StockResearchContext(evidence_registry={"ev1": ev})
    
    res = gate.verify(base_intent, ctx)
    assert "ev1" in res.rejected_evidence
    assert res.rejected_evidence["ev1"].rejection_reason == "SECURITY_SCOPE_MISMATCH"

def test_scenario_e_missing_source(base_intent):
    gate = QualityGate()
    ev = create_evidence("ev1", "INFY", "news", "trusted_secondary", datetime.utcnow())
    ev.source_name = "" # Remove mandatory field
    ctx = StockResearchContext(evidence_registry={"ev1": ev})
    
    res = gate.verify(base_intent, ctx)
    assert "ev1" in res.rejected_evidence
    assert res.rejected_evidence["ev1"].rejection_reason == "MALFORMED_EVIDENCE"

def test_scenario_f_missing_timestamp(base_intent):
    gate = QualityGate()
    ev = create_evidence("ev1", "INFY", "news", "trusted_secondary", datetime.utcnow())
    ev.fetched_at = "" # Missing fetched_at
    ctx = StockResearchContext(evidence_registry={"ev1": ev})
    
    res = gate.verify(base_intent, ctx)
    assert "ev1" in res.rejected_evidence
    assert res.rejected_evidence["ev1"].rejection_reason == "MALFORMED_EVIDENCE"

def test_scenario_g_stale_market_data(base_intent):
    gate = QualityGate()
    base_intent.intent.research_horizon = "intraday"
    
    # 2 hours old
    dt = datetime.utcnow() - timedelta(hours=2)
    ev = create_evidence("ev1", "INFY", "official_market_data", "official", dt)
    ctx = StockResearchContext(evidence_registry={"ev1": ev})
    
    res = gate.verify(base_intent, ctx)
    assert "ev1" in res.rejected_evidence
    assert res.rejected_evidence["ev1"].rejection_reason == "STALE_DATA"

def test_scenario_h_older_fundamental_data(base_intent):
    gate = QualityGate()
    # base_intent is long_term
    # 3 months old filing should be accepted with warning or fresh depending on thresholds (90 days vs 2 yrs)
    # Long term allows 2 years for exchange_filing
    dt = datetime.utcnow() - timedelta(days=90)
    ev = create_evidence("ev1", "INFY", "exchange_filing", "primary", dt)
    ctx = StockResearchContext(evidence_registry={"ev1": ev})
    
    res = gate.verify(base_intent, ctx)
    assert "ev1" in res.accepted_evidence
    assert res.accepted_evidence["ev1"].freshness == "fresh"

def test_scenario_i_duplicate_news(base_intent):
    gate = QualityGate()
    dt = datetime.utcnow()
    ev1 = create_evidence("ev1", "INFY", "news", "media", dt, title="Earnings Miss")
    ev1.url = "http://news.com"
    ev2 = create_evidence("ev2", "INFY", "news", "media", dt, title="Earnings Miss")
    ev2.url = "http://syndicate.com"
    
    ctx = StockResearchContext(evidence_registry={"ev1": ev1, "ev2": ev2})
    res = gate.verify(base_intent, ctx)
    
    assert "ev1" in res.accepted_evidence
    assert "ev2" in res.accepted_evidence
    assert "DUPLICATE_NEWS" in [f.code for f in res.flags]

def test_scenario_k_conflicting_financial_values(base_intent):
    gate = QualityGate()
    dt = datetime.utcnow()
    # Same title, type, security -> potential conflict
    ev1 = create_evidence("ev1", "INFY", "calculated", "calculated", dt, title="Revenue", facts=[{"rev": 100}])
    ev2 = create_evidence("ev2", "INFY", "calculated", "calculated", dt, title="Revenue", facts=[{"rev": 120}])
    
    ctx = StockResearchContext(evidence_registry={"ev1": ev1, "ev2": ev2})
    res = gate.verify(base_intent, ctx)
    
    assert "ev1" in res.accepted_evidence
    assert "ev2" in res.accepted_evidence
    assert "CONFLICTING_EVIDENCE" in [f.code for f in res.flags]

def test_scenario_m_invalid_numeric_data(base_intent):
    import math
    gate = QualityGate()
    dt = datetime.utcnow()
    ev = create_evidence("ev1", "INFY", "calculated", "calculated", dt, facts=[{"val": math.nan}])
    ctx = StockResearchContext(evidence_registry={"ev1": ev})
    
    res = gate.verify(base_intent, ctx)
    assert "ev1" in res.rejected_evidence
    assert res.rejected_evidence["ev1"].rejection_reason == "INVALID_NUMERIC_VALUE"

def test_scenario_n_invalid_period(base_intent):
    gate = QualityGate()
    dt = datetime.utcnow()
    ev = create_evidence("ev1", "INFY", "news", "trusted", dt)
    # Published in the future!
    ev.published_at = (dt + timedelta(days=1)).isoformat() + "Z"
    ctx = StockResearchContext(evidence_registry={"ev1": ev})
    
    res = gate.verify(base_intent, ctx)
    assert "ev1" in res.rejected_evidence
    assert res.rejected_evidence["ev1"].rejection_reason == "INVALID_PERIOD"

def test_scenario_p_fallback_source(base_intent):
    gate = QualityGate()
    dt = datetime.utcnow()
    ev = create_evidence("ev1", "INFY", "official_market_data", "trusted", dt)
    ev.source_name = "Yahoo Finance (Fallback)"
    ctx = StockResearchContext(evidence_registry={"ev1": ev})
    
    res = gate.verify(base_intent, ctx)
    assert "ev1" in res.accepted_evidence
    assert "FALLBACK_SOURCE" in [f.code for f in res.flags]

def test_scenario_q_incomplete_category(base_intent):
    gate = QualityGate()
    # Fundamental & Technical requested, but NO evidence supplied
    ctx = StockResearchContext(evidence_registry={})
    res = gate.verify(base_intent, ctx)
    
    assert res.gate_status == "FAIL"
    codes = [f.code for f in res.flags]
    assert codes.count("INCOMPLETE_CATEGORY") >= 3 # market, technical, fundamental missing
