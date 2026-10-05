"""
web/cyro_engine/quality_gate.py
────────────────────────────────
CYRO Agent 3: Evidence & Data Quality Gate
Deterministic firewall before Specialist LLM Agents.
"""

import math
from datetime import datetime
from typing import Dict, List, Any, Set, Tuple

from web.cyro_engine.models import (
    IntentRoute,
    StockResearchContext,
    DataQualityFlag,
    EvidenceItem,
    QualityGateResult
)

SOURCE_TRUST_RANK = {
    "primary": 1,
    "exchange_filing": 1,
    "official_market_data": 2,
    "trusted_secondary": 3,
    "rag_primary_copy": 4,
    "calculated": 5,
    "user_provided": 6,
    "news_media": 7
}

class QualityGate:
    def __init__(self):
        pass

    def verify(self, intent_route: IntentRoute, context: StockResearchContext) -> QualityGateResult:
        """
        Agent 3 Core Logic:
        1. Parse allowed security scope.
        2. Evaluate each EvidenceItem deterministically.
        3. Identify conflicts and duplicates.
        4. Validate category completeness against IntentRoute.
        5. Emit clean QualityGateResult isolating accepted evidence.
        """
        flags: List[DataQualityFlag] = []
        accepted_registry: Dict[str, EvidenceItem] = {}
        rejected_registry: Dict[str, EvidenceItem] = {}

        # 1. Derive Allowed Security Scope
        allowed_security_ids = set()
        requested_tickers = []
        if intent_route.entity.security_id:
            allowed_security_ids.add(intent_route.entity.security_id)
            requested_tickers.append(intent_route.entity.nse_symbol)
            
        # 2. Evaluate Items
        for ev_id, ev in context.evidence_registry.items():
            ev.validation_status = "PENDING"
            reject_reason = None
            
            # --- Rule 1: Security Scope Validation (CRITICAL) ---
            if not ev.security_id:
                reject_reason = "MISSING_SECURITY_ID"
            elif ev.security_id not in allowed_security_ids:
                reject_reason = "SECURITY_SCOPE_MISMATCH"
            # Optional consistency check
            elif ev.ticker and ev.ticker not in requested_tickers and ev.ticker != "MARKET":
                flags.append(DataQualityFlag(
                    module="scope", status="warning", code="SECURITY_IDENTITY_MISMATCH", severity="WARNING",
                    message=f"Evidence {ev_id} ticker {ev.ticker} differs from requested identity", evidence_id=ev_id
                ))

            # --- Rule 2: Category-Aware Completeness & Numeric/Temporal Sanity (ERROR) ---
            if not reject_reason:
                reject_reason = self._validate_completeness_and_sanity(ev, flags)

            # --- Rule 3: Horizon-Aware Freshness (WARNING/ERROR) ---
            if not reject_reason:
                is_stale, freshness_flag = self._evaluate_freshness(ev, intent_route.intent.research_horizon)
                if freshness_flag:
                    flags.append(freshness_flag)
                # Intraday strictness: stale market data is an error
                if is_stale and intent_route.intent.research_horizon == "intraday" and ev.type == "official_market_data":
                    reject_reason = "STALE_DATA"

            # --- Rule: Source Fallback ---
            if not reject_reason and "fallback" in ev.source_name.lower():
                flags.append(DataQualityFlag(
                    module="source", status="info", code="FALLBACK_SOURCE", severity="INFO",
                    message=f"Evidence {ev_id} used fallback source: {ev.source_name}", evidence_id=ev_id
                ))
            
            # Resolve Accept/Reject
            if reject_reason:
                ev.validation_status = "REJECTED"
                ev.rejection_reason = reject_reason
                rejected_registry[ev_id] = ev
                flags.append(DataQualityFlag(
                    module="gate", status="rejected", code=reject_reason, severity="ERROR",
                    message=f"Evidence {ev_id} rejected due to {reject_reason}", evidence_id=ev_id
                ))
            else:
                ev.validation_status = "ACCEPTED"
                accepted_registry[ev_id] = ev

        # 3. Duplicate and Conflict Detection (Operates on ACCEPTED items only)
        self._detect_duplicates_and_conflicts(accepted_registry, flags)

        # 4. Intent-Driven Category Completeness
        cat_status, cat_flags = self._evaluate_category_completeness(intent_route, accepted_registry)
        flags.extend(cat_flags)
        
        # Determine overall Gate Status
        critical_errors = [f for f in flags if f.severity in ["ERROR", "CRITICAL"]]
        warnings = [f for f in flags if f.severity == "WARNING"]
        
        gate_status = "PASS"
        if len(critical_errors) > 0:
            if len(accepted_registry) > 0:
                gate_status = "PARTIAL"
            else:
                gate_status = "FAIL"
        elif len(warnings) > 0:
            gate_status = "PASS_WITH_WARNINGS"

        # Final Result
        return QualityGateResult(
            gate_status=gate_status,
            security_scope={
                "requested": list(allowed_security_ids),
                "validated": list(set(ev.security_id for ev in accepted_registry.values() if ev.security_id))
            },
            evidence_summary={
                "total": len(context.evidence_registry),
                "accepted": len(accepted_registry),
                "rejected": len(rejected_registry),
                "warnings": len(warnings)
            },
            flags=flags,
            accepted_evidence=accepted_registry,
            rejected_evidence=rejected_registry,
            category_status=cat_status,
            metadata={
                "gate_version": "2.0.0",
                "validated_at": datetime.utcnow().isoformat() + "Z"
            }
        )

    def _validate_completeness_and_sanity(self, ev: EvidenceItem, flags: List[DataQualityFlag]) -> str | None:
        """Category-aware completeness and numeric/temporal sanity checks."""
        # Common Mandatory
        if not ev.type or not ev.source_name or not ev.fetched_at:
            return "MALFORMED_EVIDENCE"
            
        # Temporal Sanity
        try:
            fetched_dt = datetime.fromisoformat(ev.fetched_at.replace("Z", ""))
            # If there's a published_at, it cannot be in the future of fetched_at
            if ev.published_at:
                pub_dt = datetime.fromisoformat(ev.published_at.replace("Z", ""))
                if pub_dt > fetched_dt:
                    return "INVALID_PERIOD"
        except Exception:
            flags.append(DataQualityFlag(
                module="temporal", status="warning", code="INVALID_PERIOD", severity="WARNING",
                message=f"Malformed timestamp in {ev.id}", evidence_id=ev.id
            ))

        # Numeric Sanity
        for fact in ev.facts:
            for k, v in fact.items():
                if isinstance(v, float):
                    if math.isnan(v) or math.isinf(v):
                        return "INVALID_NUMERIC_VALUE"

        # Category Specific
        if ev.type == "news":
            if not ev.title or (not ev.url and "headline" not in ev.excerpt.lower()):
                return "MALFORMED_EVIDENCE"
                
        if ev.type == "exchange_filing":
            if not ev.published_at and "annual" not in ev.title.lower(): # Annuals from upstox might miss strict published_at
                flags.append(DataQualityFlag(
                    module="completeness", status="warning", code="MISSING_TIMESTAMP", severity="WARNING",
                    message=f"Filing {ev.id} is missing published_at", evidence_id=ev.id
                ))
                
        return None

    def _evaluate_freshness(self, ev: EvidenceItem, horizon: str) -> Tuple[bool, DataQualityFlag | None]:
        """Horizon-aware freshness calculation."""
        try:
            fetched_dt = datetime.fromisoformat(ev.fetched_at.replace("Z", ""))
            age_seconds = (datetime.utcnow() - fetched_dt).total_seconds()
        except Exception:
            ev.freshness = "unknown"
            return False, DataQualityFlag(
                module="freshness", status="unknown", code="UNKNOWN_FRESHNESS", severity="WARNING",
                message=f"Unknown freshness for {ev.id}", evidence_id=ev.id
            )

        thresholds = {
            "intraday": {"official_market_data": 300, "news": 3600, "calculated": 600, "exchange_filing": 86400 * 90, "macro": 86400, "peer_table": 86400, "sector_indicators": 86400},
            "short_term": {"official_market_data": 3600, "news": 86400, "calculated": 3600, "exchange_filing": 86400 * 90, "macro": 86400 * 7, "peer_table": 86400 * 7, "sector_indicators": 86400 * 7},
            "medium_term": {"official_market_data": 86400, "news": 86400 * 7, "calculated": 86400, "exchange_filing": 86400 * 365, "macro": 86400 * 14, "peer_table": 86400 * 14, "sector_indicators": 86400 * 14},
            "long_term": {"official_market_data": 86400 * 7, "news": 86400 * 30, "calculated": 86400 * 7, "exchange_filing": 86400 * 365 * 2, "macro": 86400 * 30, "peer_table": 86400 * 30, "sector_indicators": 86400 * 30},
        }

        # Default to long term thresholds if unspecified
        h_thresholds = thresholds.get(horizon, thresholds["long_term"])
        allowed_age = h_thresholds.get(ev.type, 86400 * 7) # 7 days default fallback

        if age_seconds > allowed_age:
            ev.freshness = "stale"
            ev.validation_status = "ACCEPTED_WITH_WARNING"
            flag = DataQualityFlag(
                module="freshness", status="stale", code="STALE_DATA", severity="WARNING",
                message=f"Evidence {ev.id} is stale for {horizon} horizon (age: {int(age_seconds)}s)", evidence_id=ev.id
            )
            return True, flag
            
        ev.freshness = "fresh"
        return False, None

    def _detect_duplicates_and_conflicts(self, registry: Dict[str, EvidenceItem], flags: List[DataQualityFlag]):
        """
        Cross-reference accepted items.
        If exact duplicate -> Flag DUPLICATE_EVIDENCE (but retain).
        If conflicting facts -> Flag CONFLICTING_EVIDENCE and mark preferred, but RETAIN BOTH.
        """
        items = list(registry.values())
        for i in range(len(items)):
            for j in range(i + 1, len(items)):
                a = items[i]
                b = items[j]

                # News Deduplication
                if a.type == "news" and b.type == "news":
                    if a.url == b.url or (a.title and a.title.lower() == b.title.lower()):
                        flags.append(DataQualityFlag(
                            module="deduplication", status="info", code="DUPLICATE_NEWS", severity="INFO",
                            message=f"Syndicated news overlap: {a.id} and {b.id}", evidence_id=b.id
                        ))
                
                # Conflict Detection (Same security, same type, overlapping facts keys)
                if a.security_id == b.security_id and a.type == b.type and a.title == b.title:
                    # Compare facts
                    if a.facts and b.facts:
                        # Simplified conflict detection for demonstration: 
                        # If they are exactly the same type/title but different sources/values
                        a_rank = SOURCE_TRUST_RANK.get(a.source_quality, 99)
                        b_rank = SOURCE_TRUST_RANK.get(b.source_quality, 99)
                        
                        flags.append(DataQualityFlag(
                            module="conflict", status="warning", code="CONFLICTING_EVIDENCE", severity="WARNING",
                            message=f"Potential conflict between {a.id} and {b.id}. Source '{a.source_name}' vs '{b.source_name}'",
                            evidence_id=a.id, affected_fields=[b.id]
                        ))
                        # Both are preserved in registry, LLM will see them with the metadata

    def _evaluate_category_completeness(self, intent_route: IntentRoute, registry: Dict[str, EvidenceItem]) -> Tuple[Dict[str, str], List[DataQualityFlag]]:
        """Intent-driven completeness check."""
        flags = []
        status = {}
        
        has_market = any(ev.type == "official_market_data" for ev in registry.values())
        has_technical = any(ev.type == "calculated" for ev in registry.values())
        has_financials = any("exchange_filing" in ev.type or "trusted_secondary" in ev.type for ev in registry.values())
        has_news = any(ev.type == "news" for ev in registry.values())
        has_macro = any(ev.type == "macro" for ev in registry.values())
        has_peers = any(ev.type == "peer_table" for ev in registry.values())

        agents = intent_route.routing.agents
        
        # Core: Market data always requested implicitly
        if not has_market:
            status["market"] = "fail"
            flags.append(DataQualityFlag(
                module="completeness", status="error", code="INCOMPLETE_CATEGORY", severity="ERROR",
                message="Live market quote completely unavailable"
            ))
        else:
            status["market"] = "pass"

        # Technical 
        if "technical" in agents:
            if not has_technical:
                status["technical"] = "fail"
                flags.append(DataQualityFlag(
                    module="completeness", status="error", code="INCOMPLETE_CATEGORY", severity="ERROR",
                    message="Technical analysis requested but no technical indicators available"
                ))
            else:
                status["technical"] = "pass"

        # Fundamental
        if "fundamental" in agents:
            if not has_financials:
                status["fundamental"] = "fail"
                flags.append(DataQualityFlag(
                    module="completeness", status="error", code="INCOMPLETE_CATEGORY", severity="ERROR",
                    message="Fundamental analysis requested but no financial filings/ratios available"
                ))
            else:
                status["fundamental"] = "pass"

        # Sector/Peer/Macro
        if "sector_peer_macro" in agents:
            if not has_macro and not has_peers:
                status["sector_peer_macro"] = "fail"
                flags.append(DataQualityFlag(
                    module="completeness", status="error", code="INCOMPLETE_CATEGORY", severity="ERROR",
                    message="Sector/Peer/Macro analysis requested but no macro or peer data available"
                ))
            else:
                status["sector_peer_macro"] = "pass"

        return status, flags
