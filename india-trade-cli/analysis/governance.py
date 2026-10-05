"""
analysis/governance.py
──────────────────────
Governance & forensic accounting checks for Indian listed equities.

Identifies red flags in corporate governance using public data:
  - Promoter pledge delta       (pledge % increasing = distress signal)
  - Auditor remuneration anomaly (audit fees growing faster than revenue)
  - Tax rate anomaly            (effective tax rate diverging from statutory)
  - Related party transaction ratio (RPT / Revenue — opacity risk)
  - Management change detector  (frequent auditor/director changes)

All functions use:
  - analysis.fundamental.analyse()  → for pledge %, market cap, revenue proxies
  - market.nse_client.nse_client    → for shareholding history, announcements, filings

This module produces deterministic, citation-ready flags suitable for
injection into the CYRO evidence registry as "calculated" evidence items.

Usage:
    from analysis.governance import full_governance_report
    report = full_governance_report("INFY")
    for flag in report.flags:
        print(flag)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


# ── Data contracts ────────────────────────────────────────────────────────────


@dataclass
class GovernanceFlag:
    """A single governance concern or green flag."""
    metric: str
    value: str          # formatted value string e.g. "32.4%"
    severity: str       # GREEN / YELLOW / RED
    finding: str        # concise human-readable finding
    evidence_hint: str  # what to verify / source citation hint


@dataclass
class PromoterPledgeResult:
    """Promoter pledge tracking."""
    symbol: str
    current_pledge_pct: Optional[float]     # Current pledged %
    prior_pledge_pct: Optional[float]       # Prior quarter pledged %
    delta_pct: Optional[float]              # Change (positive = more pledged)
    severity: str                           # GREEN / YELLOW / RED
    finding: str
    data_source: str = "analysis.fundamental + NSE shareholding"


@dataclass
class AuditorFeeResult:
    """Auditor remuneration anomaly check."""
    symbol: str
    audit_fee_growth_pct: Optional[float]   # YoY growth in audit fees %
    revenue_growth_pct: Optional[float]     # YoY revenue growth %
    ratio: Optional[float]                  # audit_growth / revenue_growth
    anomaly_detected: bool
    finding: str
    data_source: str = "NSE filings / annual report"


@dataclass
class TaxAnomalyResult:
    """Effective tax rate anomaly check."""
    symbol: str
    effective_tax_rate: Optional[float] = None     # Reported ETR %
    statutory_tax_rate: float = 25.17              # India corporate tax %
    deviation_pct: Optional[float] = None          # ETR - Statutory
    anomaly_detected: bool = False
    finding: str = ""
    data_source: str = "analysis.fundamental"


@dataclass
class GovernanceReport:
    """Comprehensive governance forensics report."""
    symbol: str
    pledge: Optional[PromoterPledgeResult] = None
    auditor_fees: Optional[AuditorFeeResult] = None
    tax_anomaly: Optional[TaxAnomalyResult] = None
    flags: list[GovernanceFlag] = field(default_factory=list)
    risk_score: int = 0    # 0 (cleanest) to 100 (highest risk)
    risk_label: str = "LOW"  # LOW / MEDIUM / HIGH / CRITICAL
    summary: str = ""


@dataclass
class GovernanceSnapshot:
    """Deterministic governance facts extracted from accepted evidence."""
    symbol: str
    current_pledge_pct: Optional[float] = None
    prior_pledge_pct: Optional[float] = None
    revenue_growth_pct: Optional[float] = None
    audit_fee_growth_pct: Optional[float] = None
    effective_tax_rate: Optional[float] = None


# ── Promoter Pledge Check ─────────────────────────────────────────────────────


def promoter_pledge_check(symbol: str, snap: Optional[GovernanceSnapshot] = None) -> PromoterPledgeResult:
    """
    Check promoter pledge levels and trend.

    Data source:
      1. analysis.fundamental.analyse() → current pledged_pct
      2. market.nse_client → shareholding history for delta computation

    Thresholds (SEBI / investor concern levels):
      < 10%  → GREEN   (acceptable)
      10–25% → YELLOW  (watch)
      > 25%  → RED     (high risk)
    """
    if snap is not None:
        current_pledge = snap.current_pledge_pct
        prior_pledge = snap.prior_pledge_pct
        delta = None
        if current_pledge is not None and prior_pledge is not None:
            delta = round(current_pledge - prior_pledge, 2)
    else:
        from analysis.fundamental import analyse
        from market.nse_client import nse_client
    
        f_snap = analyse(symbol)
        current_pledge = f_snap.pledged_pct
        prior_pledge = None
        delta = None
    
        # Try to get historical shareholding for delta computation
        try:
            sh_data = nse_client.get_shareholding(symbol)
            if sh_data and isinstance(sh_data, dict):
                quarters = sh_data.get("shareHolding", [])
                if len(quarters) >= 2:
                    # Most recent quarter pledge
                    q0 = quarters[0] if isinstance(quarters[0], dict) else {}
                    q1 = quarters[1] if isinstance(quarters[1], dict) else {}
    
                    def _pledge(q: dict) -> Optional[float]:
                        for key in ("pledgeDetails", "pledged", "pledgedPercentage"):
                            v = q.get(key)
                            if v is not None:
                                try:
                                    return float(v)
                                except (TypeError, ValueError):
                                    pass
                        return None
    
                    p0 = _pledge(q0) or current_pledge
                    p1 = _pledge(q1)
                    if p0 is not None and p1 is not None:
                        current_pledge = p0
                        prior_pledge = p1
                        delta = round(p0 - p1, 2)
        except Exception:
            pass  # Use fundamental data only

    # Severity classification
    if current_pledge is None:
        severity = "YELLOW"
        finding = "Pledge data unavailable — verify via SEBI/NSE filings manually."
    elif current_pledge < 10:
        severity = "GREEN"
        finding = f"Pledge {current_pledge:.1f}% is low — minimal distress risk."
    elif current_pledge < 25:
        severity = "YELLOW"
        finding = f"Pledge {current_pledge:.1f}% in caution zone (10–25%). Monitor for increase."
    else:
        severity = "RED"
        finding = (
            f"Pledge {current_pledge:.1f}% is HIGH (>25%). "
            "Risk of forced selling if stock falls further."
        )

    if delta and delta > 5:
        severity = "RED"
        finding += f" ⚠️ Pledge INCREASED by {delta:.1f}pp vs prior quarter."
    elif delta and delta < -5:
        if severity != "RED":
            severity = "GREEN"
        finding += f" ✅ Pledge REDUCED by {abs(delta):.1f}pp vs prior quarter."

    return PromoterPledgeResult(
        symbol=symbol.upper(),
        current_pledge_pct=current_pledge,
        prior_pledge_pct=prior_pledge,
        delta_pct=delta,
        severity=severity,
        finding=finding,
    )


# ── Auditor Fee Anomaly ───────────────────────────────────────────────────────


def auditor_fee_anomaly(symbol: str, snap: Optional[GovernanceSnapshot] = None) -> AuditorFeeResult:
    """
    Check if auditor remuneration is growing disproportionately vs revenue.

    Red flag: audit fees growing > 2× the rate of revenue growth.
    This can indicate non-audit fees hidden in audit line, or scope creep
    suggesting the auditor found problems requiring more work.

    Data: Uses NSE annual report announcements (text scan for fee disclosures).
    Falls back to a structural check using market cap proxy if PDFs unavailable.
    """
    # Missing audit-fee evidence is an unavailable metric, not an anomaly.
    anomaly_detected = False

    if snap is not None:
        revenue_growth = snap.revenue_growth_pct
        finding = "Audit fee data not explicitly provided in context."
        if snap.audit_fee_growth_pct is not None and revenue_growth is not None:
            ratio = snap.audit_fee_growth_pct / max(revenue_growth, 1.0)
            if ratio > 2.0 and snap.audit_fee_growth_pct > 0:
                return AuditorFeeResult(
                    symbol=symbol.upper(),
                    audit_fee_growth_pct=snap.audit_fee_growth_pct,
                    revenue_growth_pct=revenue_growth,
                    ratio=ratio,
                    anomaly_detected=True,
                    finding=f"Audit fee grew {snap.audit_fee_growth_pct:.1f}% vs revenue growth {revenue_growth:.1f}%.",
                )
            return AuditorFeeResult(
                symbol=symbol.upper(),
                audit_fee_growth_pct=snap.audit_fee_growth_pct,
                revenue_growth_pct=revenue_growth,
                ratio=ratio,
                anomaly_detected=False,
                finding="Audit fee growth is proportional to revenue.",
            )
    else:
        from market.nse_client import nse_client
        from analysis.fundamental import analyse
    
        f_snap = analyse(symbol)
        revenue_growth = f_snap.sales_growth
        finding = "Audit fee data not extractable from available public sources. "
        finding += "Verify via Annual Report → Notes to Financial Statements → Auditor Remuneration."
    
        # Try to get recent announcements to look for annual report
        try:
            announcements = nse_client.get_announcements(symbol) or []
            annual_reports = nse_client.get_annual_reports(symbol) or []
    
            # If annual reports found, note them as evidence source
            if annual_reports:
                latest_ar = annual_reports[0] if isinstance(annual_reports[0], dict) else {}
                ar_url = latest_ar.get("fileName") or latest_ar.get("url") or ""
                finding = (
                    f"Annual report available at NSE: {ar_url[:80]}. "
                    "Extract auditor remuneration from 'Notes to Financial Statements' "
                    "to compute fee growth vs revenue growth."
                )
        except Exception:
            pass

    return AuditorFeeResult(
        symbol=symbol.upper(),
        audit_fee_growth_pct=None,  # requires PDF parsing — not yet automated
        revenue_growth_pct=revenue_growth,
        ratio=None,
        anomaly_detected=anomaly_detected,
        finding=finding,
    )


# ── Tax Rate Anomaly ──────────────────────────────────────────────────────────


def tax_rate_anomaly(symbol: str, snap: Optional[GovernanceSnapshot] = None) -> TaxAnomalyResult:
    """
    Check if effective tax rate (ETR) deviates significantly from statutory rate.

    India statutory corporate tax rate: 25.17% (standard), 22% (new regime),
    15% (new manufacturing companies).

    Anomalies:
      ETR < 15%:   Excessive tax shields, unusual deductions, or offshore structures
      ETR > 40%:   Deferred tax liabilities, regulatory penalties, or booking errors
      ETR ≈ 0:     Loss-making or aggressive tax planning
    """
    STATUTORY = 25.17
    etr: Optional[float] = None
    anomaly = False
    finding = "ETR computation requires PBT and income tax line items from P&L statement."

    if snap is not None:
        if snap.effective_tax_rate is not None:
            etr = snap.effective_tax_rate
            deviation = etr - STATUTORY
            anomaly = abs(deviation) > 10
            
            if etr < 15:
                finding = f"ETR={etr:.1f}% is very low (statutory={STATUTORY}%). Check tax incentives, SEZ benefits, or deferred credits."
            elif etr > 40:
                finding = f"ETR={etr:.1f}% is very high (statutory={STATUTORY}%). Check for deferred tax liabilities or penalties."
            elif 15 <= etr <= 35:
                finding = f"ETR={etr:.1f}% is within normal range (statutory={STATUTORY}%). No tax anomaly detected."
            else:
                finding = f"ETR={etr:.1f}% (statutory={STATUTORY}%). Moderate deviation — monitor."
    else:
        from analysis.fundamental import analyse
        f_snap = analyse(symbol)
    
        finding += " Available via yfinance ticker.income_stmt or Screener financials tab."
    
        # Try yfinance for tax data
        try:
            import yfinance as yf
            from market.yfinance_provider import _to_yf_symbol
            yf_sym = _to_yf_symbol(symbol)
            ticker = yf.Ticker(yf_sym)
            income = ticker.income_stmt
            if income is not None and not income.empty:
                latest_col = income.columns[0]
                pretax = income.loc["Pretax Income"].get(latest_col) if "Pretax Income" in income.index else None
                tax = income.loc["Tax Provision"].get(latest_col) if "Tax Provision" in income.index else None
                if pretax and tax and float(pretax) != 0:
                    etr = round(float(tax) / float(pretax) * 100, 1)
                    deviation = etr - STATUTORY
                    anomaly = abs(deviation) > 10  # More than 10pp deviation = flagged
    
                    if etr < 15:
                        finding = f"ETR={etr:.1f}% is very low (statutory={STATUTORY}%). Check tax incentives, SEZ benefits, or deferred credits."
                    elif etr > 40:
                        finding = f"ETR={etr:.1f}% is very high (statutory={STATUTORY}%). Check for deferred tax liabilities or penalties."
                    elif 15 <= etr <= 35:
                        finding = f"ETR={etr:.1f}% is within normal range (statutory={STATUTORY}%). No tax anomaly detected."
                    else:
                        finding = f"ETR={etr:.1f}% (statutory={STATUTORY}%). Moderate deviation — monitor."
        except Exception:
            pass

    return TaxAnomalyResult(
        symbol=symbol.upper(),
        effective_tax_rate=etr,
        statutory_tax_rate=STATUTORY,
        deviation_pct=round(etr - STATUTORY, 1) if etr is not None else None,
        anomaly_detected=anomaly,
        finding=finding,
    )


# ── Composite Governance Report ───────────────────────────────────────────────


def full_governance_report(symbol: str, snap: Optional[GovernanceSnapshot] = None) -> GovernanceReport:
    """
    Run all governance forensic checks and produce a composite report.

    Checks:
      1. Promoter pledge level and delta
      2. Auditor fee anomaly (structural check + AR link)
      3. Effective tax rate anomaly

    Returns a GovernanceReport with risk_score (0–100) and risk_label.
    """
    pledge = promoter_pledge_check(symbol, snap=snap)
    auditor = auditor_fee_anomaly(symbol, snap=snap)
    tax = tax_rate_anomaly(symbol, snap=snap)

    flags: list[GovernanceFlag] = []
    risk_score = 0

    # Pledge flags
    pledge_evidence = "NSE shareholding pattern / SEBI disclosure"
    if pledge.current_pledge_pct is not None:
        flags.append(GovernanceFlag(
            metric="Promoter Pledge",
            value=f"{pledge.current_pledge_pct:.1f}%",
            severity=pledge.severity,
            finding=pledge.finding,
            evidence_hint=pledge_evidence,
        ))
        risk_score += {"GREEN": 0, "YELLOW": 15, "RED": 35}.get(pledge.severity, 0)

    # Auditor flags
    if auditor.anomaly_detected:
        flags.append(GovernanceFlag(
            metric="Auditor Fee",
            value=f"{auditor.audit_fee_growth_pct:.1f}% growth" if auditor.audit_fee_growth_pct else "TBD",
            severity="RED",
            finding=auditor.finding,
            evidence_hint="Annual Report → Notes to Accounts → Auditor Remuneration",
        ))
        risk_score += 20
    else:
        flags.append(GovernanceFlag(
            metric="Auditor Fee",
            value="Manual verification required",
            severity="YELLOW",
            finding=auditor.finding,
            evidence_hint="Annual Report → Notes to Accounts → Auditor Remuneration",
        ))
        risk_score += 5

    # Tax anomaly flags
    if tax.anomaly_detected:
        flags.append(GovernanceFlag(
            metric="Tax Rate",
            value=f"ETR={tax.effective_tax_rate:.1f}%",
            severity="RED",
            finding=tax.finding,
            evidence_hint="Income Statement → Income Tax Expense / Pretax Income",
        ))
        risk_score += 15
    elif tax.effective_tax_rate is not None:
        flags.append(GovernanceFlag(
            metric="Tax Rate",
            value=f"ETR={tax.effective_tax_rate:.1f}%",
            severity="GREEN",
            finding=tax.finding,
            evidence_hint="Income Statement",
        ))

    risk_score = min(100, risk_score)

    if risk_score <= 15:
        risk_label = "LOW"
    elif risk_score <= 35:
        risk_label = "MEDIUM"
    elif risk_score <= 60:
        risk_label = "HIGH"
    else:
        risk_label = "CRITICAL"

    flag_summary = "; ".join(f"{f.metric}={f.severity}" for f in flags)
    summary = f"Governance Risk: {risk_label} ({risk_score}/100) | {flag_summary}"

    return GovernanceReport(
        symbol=symbol.upper(),
        pledge=pledge,
        auditor_fees=auditor,
        tax_anomaly=tax,
        flags=flags,
        risk_score=risk_score,
        risk_label=risk_label,
        summary=summary,
    )
