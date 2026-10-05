from __future__ import annotations
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional

class ResearchRequest(BaseModel):
    message: str
    ticker: Optional[str] = None
    session_id: str = "default"
    request_id: Optional[str] = None
    research_id: Optional[str] = None
    mode: str = "normal"  # "normal" | "deep"

# --- INTENT ROUTER SCHEMAS ---

class EntityData(BaseModel):
    security_id: Optional[str] = None
    company_name: Optional[str] = None
    nse_symbol: Optional[str] = None
    bse_code: Optional[str] = None
    exchange: str = "NSE"

class ResolutionData(BaseModel):
    status: str  # resolved, ambiguous, unresolved
    method: Optional[str] = None  # exact_ticker, exact_company, alias, fuzzy, mistral_disambiguation
    confidence: float = 0.0
    candidates_considered: int = 0

class IntentData(BaseModel):
    research_horizon: str = "unspecified" # intraday, short_term, medium_term, long_term, unspecified
    focus: List[str] = Field(default_factory=list) # fundamental, valuation, technical, news, governance, risk, sector_macro, general
    requested_areas: List[str] = Field(default_factory=list)

class RoutingData(BaseModel):
    agents: List[str] = Field(default_factory=list) # fundamental, filings_governance, technical, sector_peer_macro, news_catalyst, risk, committee

class ConstraintsData(BaseModel):
    wants_buy_sell: bool = False
    requires_clarification: bool = False

class RouterMetadata(BaseModel):
    router_version: str = "1.0.0"
    created_at: str
    latency_ms: int = 0

class IntentRoute(BaseModel):
    request_id: str
    raw_query: str
    entity: EntityData = Field(default_factory=EntityData)
    resolution: ResolutionData
    intent: IntentData = Field(default_factory=IntentData)
    routing: RoutingData = Field(default_factory=RoutingData)
    constraints: ConstraintsData = Field(default_factory=ConstraintsData)
    metadata: RouterMetadata

# --- EXISTING SCHEMAS ---

class ResearchPlan(BaseModel):
    research_type: str = Field(description="Type of research, e.g. company_research, valuation, etc.")
    symbol: str
    exchange: str = "NSE"
    horizon: str = "long_term"
    focus: List[str] = Field(default_factory=list)
    required_context: List[str] = Field(default_factory=list)
    run_agents: List[str] = Field(default_factory=list)

class EvidenceLocator(BaseModel):
    page: Optional[int] = None
    section: Optional[str] = None
    table: Optional[str] = None

class EvidenceItem(BaseModel):
    id: str
    research_id: str
    security_id: Optional[str] = None
    ticker: str
    type: str
    source_quality: str
    source_name: str
    title: str
    url: Optional[str] = None
    published_at: Optional[str] = None
    fetched_at: str
    locator: Optional[EvidenceLocator] = None
    excerpt: str
    facts: List[Dict[str, Any]] = Field(default_factory=list)
    freshness: str = "current"
    content_hash: Optional[str] = None
    category: Optional[str] = None
    validation_status: str = "PENDING" # PENDING, ACCEPTED, ACCEPTED_WITH_WARNING, REJECTED
    rejection_reason: Optional[str] = None

class DataQualityFlag(BaseModel):
    module: str
    status: str
    message: str
    code: str = "UNKNOWN_ISSUE"
    severity: str = "INFO" # INFO, WARNING, ERROR, CRITICAL
    evidence_id: Optional[str] = None
    affected_fields: List[str] = Field(default_factory=list)

class QualityGateResult(BaseModel):
    gate_status: str  # PASS, PASS_WITH_WARNINGS, PARTIAL, FAIL
    security_scope: Dict[str, List[str]] # requested vs validated
    evidence_summary: Dict[str, int]
    flags: List[DataQualityFlag] = Field(default_factory=list)
    accepted_evidence: Dict[str, EvidenceItem] = Field(default_factory=dict)
    rejected_evidence: Dict[str, EvidenceItem] = Field(default_factory=dict)
    category_status: Dict[str, str] = Field(default_factory=dict)
    metadata: Dict[str, Any] = Field(default_factory=dict)

class PeerMetric(BaseModel):
    symbol: str
    pe: Optional[float] = None
    roe: Optional[float] = None
    margin: Optional[float] = None

class MacroSnapshot(BaseModel):
    usd_inr: Optional[float] = None
    brent_crude: Optional[float] = None
    repo_rate: Optional[float] = None
    repo_rate_asof: Optional[str] = None

class ShareholdingRecord(BaseModel):
    quarter: str
    promoter_pct: Optional[float] = None
    public_pct: Optional[float] = None

class SectorIndexPoint(BaseModel):
    index_name: str
    level: Optional[float] = None
    change_pct: Optional[float] = None

class PolicyItem(BaseModel):
    source: str
    title: str
    date: str
    url: Optional[str] = None

class StockResearchContext(BaseModel):
    security_id: Optional[str] = None
    identity: Dict[str, Any] = Field(default_factory=dict)
    market_snapshot: Dict[str, Any] = Field(default_factory=dict)
    technical_market_data: Dict[str, Any] = Field(default_factory=dict)
    financials: Dict[str, Any] = Field(default_factory=dict)
    filings: List[Dict[str, Any]] = Field(default_factory=list)
    news: List[Dict[str, Any]] = Field(default_factory=list)
    sector_peer_macro: Dict[str, Any] = Field(default_factory=dict)
    events: List[Dict[str, Any]] = Field(default_factory=list)
    rag: List[Dict[str, Any]] = Field(default_factory=list)
    evidence_registry: Dict[str, EvidenceItem] = Field(default_factory=dict)
    
    peer_table: List[PeerMetric] = Field(default_factory=list)
    macro: Optional[MacroSnapshot] = None
    shareholding: List[ShareholdingRecord] = Field(default_factory=list)
    sector_indicators: List[SectorIndexPoint] = Field(default_factory=list)
    policy_items: List[PolicyItem] = Field(default_factory=list)

class AnalystClaim(BaseModel):
    id: str
    text: str
    category: str
    stance: str
    importance: str
    evidence_ids: List[str] = Field(default_factory=list)
    confidence: int
    limitations: List[str] = Field(default_factory=list)
    calculation_id: Optional[str] = None

class AgentReport(BaseModel):
    agent_name: str
    claims: List[AnalystClaim] = Field(default_factory=list)
    summary: str
    limitations: List[str] = Field(default_factory=list)

class FinalResearchReport(BaseModel):
    research_id: str
    symbol: str
    security_id: Optional[str] = None
    horizon: str
    conclusion: str
    confidence: int
    summary: str
    sections: List[Dict[str, Any]] = Field(default_factory=list)
    claims: List[AnalystClaim] = Field(default_factory=list)
    citation_map: Dict[str, EvidenceItem] = Field(default_factory=dict)
    data_quality: Dict[str, Any] = Field(default_factory=dict)
    data_limitations: List[str] = Field(default_factory=list)
    sources: List[EvidenceItem] = Field(default_factory=list)
