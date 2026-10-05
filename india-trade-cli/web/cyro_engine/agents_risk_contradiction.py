import logging
import uuid
from typing import List, Dict, Set, Any
from pydantic import BaseModel, Field

from web.cyro_engine.models import IntentRoute, StockResearchContext, AgentReport, AnalystClaim

logger = logging.getLogger(__name__)

class RiskFlag(BaseModel):
    risk_id: str
    category: str
    severity: str  # HIGH, MEDIUM, LOW, INFORMATIONAL
    title: str
    description: str
    source_agent: str
    evidence_ids: List[str]
    deterministic_basis: str
    affected_security: str

class ContradictionFlag(BaseModel):
    contradiction_id: str
    category: str
    agents_involved: List[str]
    description: str
    evidence_ids: List[str]
    resolution_status: str  # TIME_HORIZON_DIFFERENCE, DIFFERENT_ANALYTICAL_DIMENSION, PERIOD_MISMATCH, SOURCE_CONFLICT, TRUE_ANALYTICAL_CONTRADICTION

class RiskContradictionSnapshot(BaseModel):
    security_id: str
    high_risk_flags: List[RiskFlag] = Field(default_factory=list)
    medium_risk_flags: List[RiskFlag] = Field(default_factory=list)
    low_risk_flags: List[RiskFlag] = Field(default_factory=list)
    contradictions: List[ContradictionFlag] = Field(default_factory=list)
    missing_evidence_warnings: List[str] = Field(default_factory=list)
    limitations: List[str] = Field(default_factory=list)
    evidence_ids: List[str] = Field(default_factory=list)

def detect_risks(claims: List[AnalystClaim], target_security: str) -> List[RiskFlag]:
    risks = []
    
    # Simple deterministic mapping based on text or stance
    for c in claims:
        # Ignore claims without valid evidence
        if not c.evidence_ids:
            continue
            
        txt = c.text.upper()
        severity = None
        category = c.category
        
        # 1. News/Catalysts
        if category == "news_catalyst":
            if "MAJOR_NEGATIVE_CATALYST" in txt:
                severity = "HIGH"
            elif c.stance.upper() == "NEGATIVE":
                severity = "MEDIUM" if c.importance.upper() != "HIGH" else "HIGH"
                
        # 2. Technical
        elif category == "technical":
            if "BEARISH_TREND" in txt or "BREAKDOWN" in txt:
                severity = "HIGH"
            elif c.stance.upper() == "NEGATIVE":
                severity = "MEDIUM"
                
        # 3. Fundamental/Valuation
        elif category == "fundamental":
            if any(term in txt for term in ["DETERIORATION", "WEAK", "EXTREME", "DOWNSIDE", "CONCERN"]):
                severity = "HIGH"
            elif c.stance.upper() == "NEGATIVE":
                severity = "MEDIUM"
                
        # 4. Governance
        elif category == "filings_governance":
            if any(term in txt for term in ["RESIGNATION", "QUALIFICATION", "TURNOVER"]):
                severity = "HIGH"
            elif c.stance.upper() == "NEGATIVE":
                severity = "MEDIUM"
                
        # 5. Sector/Peer
        elif category == "sector_peer_macro":
            if "UNDERPERFORMS_SECTOR" in txt or "PEER_VALUATION_PREMIUM" in txt: # Premium valuation is a risk in some contexts, but usually stance would be Negative
                severity = "MEDIUM"
            if c.stance.upper() == "NEGATIVE":
                severity = "HIGH" if c.importance.upper() == "HIGH" else "MEDIUM"
                
        if severity:
            risks.append(RiskFlag(
                risk_id=str(uuid.uuid4()),
                category=category,
                severity=severity,
                title=f"Risk from {category}",
                description=c.text,
                source_agent=category,
                evidence_ids=c.evidence_ids,
                deterministic_basis="Keyword/Stance detection",
                affected_security=target_security
            ))
            
    return risks

def detect_contradictions(claims: List[AnalystClaim]) -> List[ContradictionFlag]:
    contradictions = []
    
    # We group claims by stance and category roughly, looking for extreme clashes.
    positive_claims = [c for c in claims if c.stance.upper() == "POSITIVE" and c.evidence_ids]
    negative_claims = [c for c in claims if c.stance.upper() == "NEGATIVE" and c.evidence_ids]
    
    # E.g. Fundamental Strong vs Technical Bearish
    f_pos = [c for c in positive_claims if c.category == "fundamental"]
    t_neg = [c for c in negative_claims if c.category == "technical"]
    
    if f_pos and t_neg:
        eids = list(set(f_pos[0].evidence_ids + t_neg[0].evidence_ids))
        contradictions.append(ContradictionFlag(
            contradiction_id=str(uuid.uuid4()),
            category="Cross-Domain",
            agents_involved=["fundamental", "technical"],
            description="Fundamental analysis is POSITIVE while Technical analysis is NEGATIVE.",
            evidence_ids=eids,
            resolution_status="TIME_HORIZON_DIFFERENCE"  # Fundamentals usually longer term than Technicals
        ))
        
    # E.g. Sector Outperforms but News Negative
    s_pos = [c for c in positive_claims if c.category == "sector_peer_macro"]
    n_neg = [c for c in negative_claims if c.category == "news_catalyst"]
    
    if s_pos and n_neg:
        eids = list(set(s_pos[0].evidence_ids + n_neg[0].evidence_ids))
        contradictions.append(ContradictionFlag(
            contradiction_id=str(uuid.uuid4()),
            category="Cross-Domain",
            agents_involved=["sector_peer_macro", "news_catalyst"],
            description="Sector context is POSITIVE but recent News is NEGATIVE.",
            evidence_ids=eids,
            resolution_status="DIFFERENT_ANALYTICAL_DIMENSION"
        ))
        
    # Exact same domain contradictions (TRUE_ANALYTICAL_CONTRADICTION)
    for category in set(c.category for c in claims):
        c_pos = [c for c in positive_claims if c.category == category]
        c_neg = [c for c in negative_claims if c.category == category]
        if c_pos and c_neg:
            eids = list(set(c_pos[0].evidence_ids + c_neg[0].evidence_ids))
            contradictions.append(ContradictionFlag(
                contradiction_id=str(uuid.uuid4()),
                category=category,
                agents_involved=[category],
                description=f"Conflicting stances within {category}.",
                evidence_ids=eids,
                resolution_status="TRUE_ANALYTICAL_CONTRADICTION"
            ))
            
    return contradictions

def run_risk_contradiction_engine(
    intent_route: IntentRoute,
    context: StockResearchContext,
    specialist_reports: List[AgentReport]
) -> AgentReport:
    """
    CYRO Agent 9: Deterministic Risk & Contradiction Engine
    Consumes outputs from Agents 4-8. Absolutely NO LLM usage.
    
    DEFENSIVE VALIDATION: Ensures intent_route is valid before proceeding.
    """
    logger.info("Starting CYRO Agent 9 — Deterministic Risk & Contradiction Engine")
    
    # Defensive validation: ensure intent_route and security_id are present
    if not intent_route:
        raise ValueError("Agent 9: intent_route is None. Cannot proceed.")
    if not intent_route.entity or not intent_route.entity.security_id:
        raise ValueError("Agent 9: intent_route.entity.security_id is missing. Cannot proceed.")
    
    target_security_id = intent_route.entity.security_id
    
    all_claims: List[AnalystClaim] = []
    missing_warnings: List[str] = []
    valid_evidence_ids = set()
    
    # 1. Aggregate claims
    for rep in specialist_reports:
        if "No accepted recent news" in rep.summary:
            missing_warnings.append("Agent 8 (News/Catalyst) reported absence of evidence.")
        for claim in rep.claims:
            # Multi-stock safety: Check if the evidence belongs to the target security
            # We assume upstream agents only put valid evidence IDs in claim.evidence_ids
            # We explicitly filter out claims with zero evidence IDs
            if not claim.evidence_ids:
                continue
                
            all_valid_eids = []
            for eid in claim.evidence_ids:
                ev = context.evidence_registry.get(eid)
                if ev and ev.security_id == target_security_id:
                    all_valid_eids.append(eid)
                    valid_evidence_ids.add(eid)
                    
            if all_valid_eids:
                claim.evidence_ids = all_valid_eids
                all_claims.append(claim)
                
    # 2. Extract Risks
    risks = detect_risks(all_claims, target_security_id)
    
    high_risks = [r for r in risks if r.severity == "HIGH"]
    med_risks = [r for r in risks if r.severity == "MEDIUM"]
    low_risks = [r for r in risks if r.severity in ["LOW", "INFORMATIONAL"]]
    
    # 3. Detect Contradictions
    contradictions = detect_contradictions(all_claims)
    
    # 4. Create Snapshot
    snapshot = RiskContradictionSnapshot(
        security_id=target_security_id,
        high_risk_flags=high_risks,
        medium_risk_flags=med_risks,
        low_risk_flags=low_risks,
        contradictions=contradictions,
        missing_evidence_warnings=missing_warnings,
        limitations=["100% Deterministic extraction. No LLM used."],
        evidence_ids=list(valid_evidence_ids)
    )
    
    # 5. Build final report payload
    snapshot_claims = []
    
    # Encode risks as claims so Agent 10 can ingest them easily
    for r in high_risks + med_risks:
        snapshot_claims.append(AnalystClaim(
            id=r.risk_id,
            text=f"[RISK:{r.severity}] {r.title} - {r.description} ({r.deterministic_basis})",
            category="risk_contradiction",
            stance="Negative",
            importance=r.severity,
            evidence_ids=r.evidence_ids,
            confidence=100,
            limitations=[]
        ))
        
    for c in contradictions:
        snapshot_claims.append(AnalystClaim(
            id=c.contradiction_id,
            text=f"[CONTRADICTION:{c.resolution_status}] {c.description} (Agents: {', '.join(c.agents_involved)})",
            category="risk_contradiction",
            stance="Neutral",
            importance="HIGH" if c.resolution_status == "TRUE_ANALYTICAL_CONTRADICTION" else "MEDIUM",
            evidence_ids=c.evidence_ids,
            confidence=100,
            limitations=[]
        ))
    
    summary = f"Agent 9: Extracted {len(high_risks)} HIGH risks, {len(med_risks)} MEDIUM risks, and {len(contradictions)} contradictions deterministically."
    
    return AgentReport(
        agent_name="risk_contradiction_engine",
        summary=summary,
        claims=snapshot_claims,
        limitations=snapshot.limitations
    )
