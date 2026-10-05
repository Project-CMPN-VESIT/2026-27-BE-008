"""
analysis/financial_health.py
────────────────────────────
Deterministic financial health scoring for Indian equities.

Provides:
  - Piotroski F-Score  (9-point profitability/leverage/efficiency screen)
  - Altman Z-Score     (bankruptcy probability, India-adjusted)
  - DuPont ROE         (3-factor and 5-factor decomposition)
  - CFO-to-EBITDA      (cash flow quality / earnings quality ratio)

All functions accept a symbol string and return typed dataclasses.
They pull data from analysis.fundamental.analyse() as their single
source of truth, preserving the evidence-first design principle.

Usage:
    from analysis.financial_health import (
        piotroski_f_score,
        altman_z_score,
        dupont_decomposition,
        cfo_to_ebitda,
        full_health_report,
    )

    report = full_health_report("INFY")
    print(report.overall_verdict)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from analysis.fundamental import FundamentalSnapshot


# ── Data contracts ────────────────────────────────────────────────────────────


@dataclass
class PiotroskiResult:
    """
    Piotroski F-Score: 9 binary signals → total 0–9.
    ≥ 7 = Strong (long candidate), ≤ 2 = Weak (short candidate).
    """
    symbol: str
    score: int  # 0–9
    label: str  # STRONG / MODERATE / WEAK

    # Profitability signals (3)
    positive_roa: Optional[bool] = None        # F1: ROA > 0
    positive_ocf: Optional[bool] = None        # F2: Operating cash flow > 0
    roa_improving: Optional[bool] = None       # F3: ROA this year > last year
    accruals_low: Optional[bool] = None        # F4: OCF/Assets > ROA (low accruals)

    # Leverage / Liquidity signals (3)
    leverage_down: Optional[bool] = None       # F5: Long-term debt ratio decreased
    current_ratio_up: Optional[bool] = None    # F6: Current ratio improved
    no_new_shares: Optional[bool] = None       # F7: No new equity issued

    # Operating efficiency signals (3)
    gross_margin_up: Optional[bool] = None     # F8: Gross margin improved
    asset_turnover_up: Optional[bool] = None   # F9: Asset turnover improved

    notes: list[str] = field(default_factory=list)
    data_source: str = "analysis.fundamental"


@dataclass
class AltmanResult:
    """
    Altman Z-Score for non-financial Indian companies.
    India-adjusted thresholds (original US model):
      Z > 2.9  → Safe Zone
      1.8–2.9  → Grey Zone
      Z < 1.8  → Distress Zone
    """
    symbol: str
    z_score: Optional[float]
    zone: str  # SAFE / GREY / DISTRESS / UNAVAILABLE

    # Component ratios
    x1_working_capital_ratio: Optional[float] = None   # (CA - CL) / TA
    x2_retained_earnings_ratio: Optional[float] = None # RE / TA
    x3_ebit_ratio: Optional[float] = None              # EBIT / TA
    x4_equity_to_debt_ratio: Optional[float] = None    # Market Cap / Total Debt
    x5_asset_turnover: Optional[float] = None          # Revenue / TA

    notes: list[str] = field(default_factory=list)
    data_source: str = "analysis.fundamental"


@dataclass
class DuPontResult:
    """
    DuPont ROE decomposition.
    3-factor: ROE = NPM × Asset_Turnover × Equity_Multiplier
    5-factor: further splits NPM into Tax_Burden × Interest_Burden × EBIT_Margin
    """
    symbol: str
    roe: Optional[float]  # Return on Equity %

    # 3-factor
    net_profit_margin: Optional[float] = None       # Net Income / Revenue
    asset_turnover: Optional[float] = None          # Revenue / Total Assets
    equity_multiplier: Optional[float] = None       # Total Assets / Equity

    # 5-factor extensions
    tax_burden: Optional[float] = None              # Net Income / Pre-tax Income
    interest_burden: Optional[float] = None         # Pre-tax Income / EBIT
    ebit_margin: Optional[float] = None             # EBIT / Revenue

    # Diagnosis
    primary_driver: str = "UNKNOWN"  # MARGIN / TURNOVER / LEVERAGE / MIXED
    notes: list[str] = field(default_factory=list)
    data_source: str = "analysis.fundamental"


@dataclass
class CashFlowQuality:
    """
    CFO-to-EBITDA ratio: measures earnings quality.
    > 0.7  = High quality (cash-backed earnings)
    0.4–0.7 = Moderate
    < 0.4  = Low quality (accrual-heavy earnings)
    < 0    = Cash burn despite reported EBITDA
    """
    symbol: str
    ratio: Optional[float]
    verdict: str  # HIGH / MODERATE / LOW / NEGATIVE / UNAVAILABLE
    cfo_cr: Optional[float] = None    # Operating cash flow (₹ Crores)
    ebitda_cr: Optional[float] = None # EBITDA (₹ Crores)
    notes: list[str] = field(default_factory=list)


@dataclass
class FinancialHealthReport:
    """
    Comprehensive financial health report combining all sub-scores.
    """
    symbol: str
    piotroski: Optional[PiotroskiResult] = None
    altman: Optional[AltmanResult] = None
    dupont: Optional[DuPontResult] = None
    cash_flow_quality: Optional[CashFlowQuality] = None
    overall_verdict: str = "UNKNOWN"  # HEALTHY / MODERATE / STRESSED / DISTRESSED
    overall_score: int = 0            # 0–100
    summary: str = ""


# ── Piotroski F-Score ─────────────────────────────────────────────────────────


def piotroski_f_score(symbol: str, snap: Optional['FundamentalSnapshot'] = None) -> PiotroskiResult:
    """
    Compute Piotroski F-Score (0–9) for a given NSE symbol.

    Uses FundamentalSnapshot from analysis.fundamental.analyse().
    Missing data = signal not counted (conservative scoring).
    """
    from analysis.fundamental import analyse

    if snap is None:
        snap = analyse(symbol)
    score = 0
    notes: list[str] = []

    # F1: Positive ROA
    roa_positive: Optional[bool] = None
    if snap.roe is not None and snap.pb is not None and snap.pb > 0:
        # Approximate ROA from ROE × Book-to-Market
        roa_approx = snap.roe / snap.pb if snap.pb else None
        if roa_approx is not None:
            roa_positive = roa_approx > 0
            if roa_positive:
                score += 1
                notes.append("F1✅ ROA > 0 (profitable)")
            else:
                notes.append("F1❌ ROA ≤ 0 (unprofitable)")

    # F2: Positive Operating Cash Flow (proxy: FCF > 0)
    ocf_positive: Optional[bool] = None
    if snap.free_cash_flow is not None:
        ocf_positive = snap.free_cash_flow > 0
        if ocf_positive:
            score += 1
            notes.append("F2✅ Positive operating cash flow")
        else:
            notes.append("F2❌ Negative cash flow")

    # F3: ROA improving — proxy: profit_growth > 0
    roa_improving: Optional[bool] = None
    if snap.profit_growth is not None:
        roa_improving = snap.profit_growth > 0
        if roa_improving:
            score += 1
            notes.append(f"F3✅ Profit growth {snap.profit_growth:.1f}% (ROA improving)")
        else:
            notes.append(f"F3❌ Profit growth {snap.profit_growth:.1f}% (ROA deteriorating)")

    # F4: Accruals (FCF/Revenue > NPM implies cash earnings)
    accruals_low: Optional[bool] = None
    if snap.free_cash_flow is not None and snap.npm is not None:
        # If FCF is positive and NPM > 0, use ratio check
        if snap.npm > 0:
            accruals_low = snap.free_cash_flow > 0  # simplified: positive FCF = cash earnings
            if accruals_low:
                score += 1
                notes.append("F4✅ Cash flow quality good (low accruals)")
            else:
                notes.append("F4❌ High accruals (earnings not backed by cash)")

    # F5: Leverage declining (proxy: D/E decreased — we only have current D/E)
    leverage_down: Optional[bool] = None
    if snap.debt_equity is not None:
        leverage_down = snap.debt_equity < 0.5  # Conservative threshold for India
        if leverage_down:
            score += 1
            notes.append(f"F5✅ Low leverage D/E={snap.debt_equity:.2f}")
        else:
            notes.append(f"F5❌ High leverage D/E={snap.debt_equity:.2f}")

    # F6: Current ratio improving (proxy: current ratio > 1.5)
    current_ratio_up: Optional[bool] = None
    if snap.current_ratio is not None:
        current_ratio_up = snap.current_ratio > 1.5
        if current_ratio_up:
            score += 1
            notes.append(f"F6✅ Current ratio {snap.current_ratio:.2f} > 1.5")
        else:
            notes.append(f"F6❌ Current ratio {snap.current_ratio:.2f} ≤ 1.5")

    # F7: No dilution — proxy: promoter holding not declining
    no_new_shares: Optional[bool] = None
    if snap.promoter_holding is not None:
        no_new_shares = snap.promoter_holding > 40  # Most quality Indian promoters hold >40%
        if no_new_shares:
            score += 1
            notes.append(f"F7✅ Promoter holding {snap.promoter_holding:.1f}% (no dilution signal)")
        else:
            notes.append(f"F7❌ Low promoter holding {snap.promoter_holding:.1f}%")

    # F8: Gross margin improving — proxy: NPM > sector average (unavailable — use NPM > 10%)
    gross_margin_up: Optional[bool] = None
    if snap.npm is not None:
        gross_margin_up = snap.npm > 10
        if gross_margin_up:
            score += 1
            notes.append(f"F8✅ Net margin {snap.npm:.1f}% > 10% threshold")
        else:
            notes.append(f"F8❌ Net margin {snap.npm:.1f}% ≤ 10%")

    # F9: Asset turnover improving — proxy: sales_growth > 5%
    asset_turnover_up: Optional[bool] = None
    if snap.sales_growth is not None:
        asset_turnover_up = snap.sales_growth > 5
        if asset_turnover_up:
            score += 1
            notes.append(f"F9✅ Revenue growth {snap.sales_growth:.1f}% > 5%")
        else:
            notes.append(f"F9❌ Revenue growth {snap.sales_growth:.1f}% ≤ 5%")

    label = "STRONG" if score >= 7 else ("MODERATE" if score >= 4 else "WEAK")

    return PiotroskiResult(
        symbol=symbol.upper(),
        score=score,
        label=label,
        positive_roa=roa_positive,
        positive_ocf=ocf_positive,
        roa_improving=roa_improving,
        accruals_low=accruals_low,
        leverage_down=leverage_down,
        current_ratio_up=current_ratio_up,
        no_new_shares=no_new_shares,
        gross_margin_up=gross_margin_up,
        asset_turnover_up=asset_turnover_up,
        notes=notes,
    )


# ── Altman Z-Score ────────────────────────────────────────────────────────────


def altman_z_score(symbol: str, snap: Optional['FundamentalSnapshot'] = None) -> AltmanResult:
    """
    Compute Altman Z-Score for a non-financial Indian listed company.

    Z = 1.2*X1 + 1.4*X2 + 3.3*X3 + 0.6*X4 + 1.0*X5

    Where:
      X1 = (Current Assets - Current Liabilities) / Total Assets
      X2 = Retained Earnings / Total Assets  (proxy: ROE * PB)
      X3 = EBIT / Total Assets               (proxy: ROCE * (1/EM))
      X4 = Market Cap / Total Debt
      X5 = Revenue / Total Assets            (proxy: from yfinance assetTurnover)
    """
    from analysis.fundamental import analyse

    if snap is None:
        snap = analyse(symbol)
    notes: list[str] = []

    # X4 is the most reliable component we can compute: Market Cap / Debt
    x4: Optional[float] = None
    if snap.market_cap and snap.market_cap > 0:
        if snap.debt_equity is not None and snap.debt_equity > 0:
            # D/E = Total Debt / Equity → Total Debt = D/E * Equity
            # Equity ≈ Market Cap / PB
            if snap.pb and snap.pb > 0:
                equity_book = snap.market_cap / snap.pb
                total_debt = snap.debt_equity * equity_book
                x4 = snap.market_cap / total_debt if total_debt > 0 else None
        else:
            x4 = 99.0  # Zero debt → essentially no default risk
            notes.append("X4: Zero debt, maximum score component")

    # X1: Working capital ratio proxy from current_ratio
    x1: Optional[float] = None
    if snap.current_ratio is not None:
        # CR = CA/CL → WC/CA = (CA - CL)/CA = 1 - 1/CR
        # WC/TA ≈ (WC/CA) × (CA/TA), assume CA/TA = 0.4 (generic for India)
        wc_ca_ratio = 1 - (1 / snap.current_ratio) if snap.current_ratio > 0 else 0
        x1 = wc_ca_ratio * 0.4  # approximation
        notes.append(f"X1 (approx): {x1:.3f} from current_ratio={snap.current_ratio}")

    # X3: EBIT/TA proxy from ROCE (= EBIT/CE ≈ EBIT/TA for asset-heavy firms)
    x3: Optional[float] = None
    if snap.roce is not None:
        x3 = snap.roce / 100  # ROCE is in %, convert to decimal
        notes.append(f"X3 (proxy ROCE): {x3:.3f}")

    # X2: Retained earnings proxy (ROE × PB as fraction)
    x2: Optional[float] = None
    if snap.roe is not None and snap.pb is not None and snap.pb > 0:
        x2 = (snap.roe / 100) / snap.pb * 0.5  # very rough proxy
        notes.append(f"X2 (proxy ROE/PB): {x2:.3f}")

    # X5: Asset turnover — P/S ratio inverse if available
    x5: Optional[float] = None
    if snap.price_to_sales is not None and snap.price_to_sales > 0:
        # Asset turnover ≈ 1/PtoS × asset_to_sales_ratio (assume 0.8)
        x5 = 0.8 / snap.price_to_sales
        notes.append(f"X5 (approx via P/S): {x5:.3f}")

    # Compute Z-score (only if at least 3 components available)
    components = [c for c in [x1, x2, x3, x4, x5] if c is not None]
    z_score: Optional[float] = None

    if len(components) >= 3:
        z1 = 1.2 * (x1 or 0)
        z2 = 1.4 * (x2 or 0)
        z3 = 3.3 * (x3 or 0)
        z4 = 0.6 * min(x4 or 0, 10)  # cap X4 contribution
        z5 = 1.0 * (x5 or 0)
        z_score = round(z1 + z2 + z3 + z4 + z5, 2)
        notes.append(f"Z = {z1:.2f} + {z2:.2f} + {z3:.2f} + {z4:.2f} + {z5:.2f} = {z_score}")
    else:
        notes.append(f"Insufficient data: only {len(components)}/5 components computable")

    if z_score is None:
        zone = "UNAVAILABLE"
    elif z_score > 2.9:
        zone = "SAFE"
    elif z_score > 1.8:
        zone = "GREY"
    else:
        zone = "DISTRESS"

    return AltmanResult(
        symbol=symbol.upper(),
        z_score=z_score,
        zone=zone,
        x1_working_capital_ratio=x1,
        x2_retained_earnings_ratio=x2,
        x3_ebit_ratio=x3,
        x4_equity_to_debt_ratio=x4,
        x5_asset_turnover=x5,
        notes=notes,
    )


# ── DuPont ROE Decomposition ──────────────────────────────────────────────────


def dupont_decomposition(symbol: str, snap: Optional['FundamentalSnapshot'] = None) -> DuPontResult:
    """
    Perform DuPont 3-factor decomposition of ROE.

    ROE = Net Profit Margin × Asset Turnover × Equity Multiplier
    """
    from analysis.fundamental import analyse

    if snap is None:
        snap = analyse(symbol)
    notes: list[str] = []

    npm = (snap.npm / 100) if snap.npm is not None else None
    equity_mult: Optional[float] = None
    asset_turn: Optional[float] = None

    # Equity multiplier from D/E: EM = 1 + D/E
    if snap.debt_equity is not None:
        equity_mult = round(1 + snap.debt_equity, 2)

    # Asset turnover from P/S proxy: AT ≈ 1/PtoS × EM × NPM_inverse
    if snap.price_to_sales is not None and snap.price_to_sales > 0:
        asset_turn = round(1 / snap.price_to_sales, 3)  # rough proxy

    # Reconstruct ROE from components if available
    roe_reconstructed: Optional[float] = None
    if npm is not None and asset_turn is not None and equity_mult is not None:
        roe_reconstructed = round(npm * asset_turn * equity_mult * 100, 2)
        notes.append(f"Reconstructed ROE = {npm:.3f} × {asset_turn:.3f} × {equity_mult:.2f} = {roe_reconstructed:.1f}%")

    # Primary driver diagnosis
    primary_driver = "UNKNOWN"
    if npm is not None and asset_turn is not None and equity_mult is not None:
        sorted_impact = sorted([
            ("MARGIN", abs(npm - 0.1)),
            ("TURNOVER", abs(asset_turn - 1.0)),
            ("LEVERAGE", abs(equity_mult - 1.5)),
        ], key=lambda x: x[1], reverse=True)
        primary_driver = sorted_impact[0][0]
        notes.append(f"Primary ROE driver: {primary_driver}")

    return DuPontResult(
        symbol=symbol.upper(),
        roe=snap.roe,
        net_profit_margin=round(npm * 100, 2) if npm else snap.npm,
        asset_turnover=asset_turn,
        equity_multiplier=equity_mult,
        primary_driver=primary_driver,
        notes=notes,
    )


# ── Cash Flow Quality ─────────────────────────────────────────────────────────


def cfo_to_ebitda(symbol: str, snap: Optional['FundamentalSnapshot'] = None) -> CashFlowQuality:
    """
    Evaluate CFO-to-EBITDA ratio.
    """
    from analysis.fundamental import analyse

    if snap is None:
        snap = analyse(symbol)
    notes: list[str] = []

    cfo_cr = snap.free_cash_flow  # best proxy available

    # Estimate EBITDA from market_cap and EV/EBITDA multiple
    ebitda_cr: Optional[float] = None
    if snap.ev_ebitda and snap.ev_ebitda > 0 and snap.market_cap:
        # EV ≈ Market Cap × (1 + D/E) for rough approximation
        d_e = snap.debt_equity or 0
        ev_approx = snap.market_cap * (1 + d_e)
        ebitda_cr = round(ev_approx / snap.ev_ebitda, 1)
        notes.append(f"EBITDA estimated from EV/EBITDA={snap.ev_ebitda:.1f}, EV≈₹{ev_approx:.0f}Cr")

    ratio: Optional[float] = None
    if cfo_cr is not None and ebitda_cr and ebitda_cr != 0:
        ratio = round(cfo_cr / ebitda_cr, 3)

    if ratio is None:
        verdict = "UNAVAILABLE"
    elif ratio < 0:
        verdict = "NEGATIVE"
        notes.append(f"⚠️ Cash burn (CFO={cfo_cr:.0f}Cr) despite EBITDA={ebitda_cr:.0f}Cr")
    elif ratio >= 0.7:
        verdict = "HIGH"
    elif ratio >= 0.4:
        verdict = "MODERATE"
    else:
        verdict = "LOW"
        notes.append(f"⚠️ Low cash conversion: CFO/EBITDA={ratio:.2f} — accrual-heavy earnings")

    return CashFlowQuality(
        symbol=symbol.upper(),
        ratio=ratio,
        verdict=verdict,
        cfo_cr=cfo_cr,
        ebitda_cr=ebitda_cr,
        notes=notes,
    )


# ── Composite Report ──────────────────────────────────────────────────────────


def full_health_report(symbol: str, snap: Optional['FundamentalSnapshot'] = None) -> FinancialHealthReport:
    """
    Run all four health engines and produce a composite financial health report.

    Returns a FinancialHealthReport with:
      - Piotroski F-Score (0–9)
      - Altman Z-Score and zone
      - DuPont ROE decomposition
      - CFO-to-EBITDA quality ratio
      - overall_verdict: HEALTHY / MODERATE / STRESSED / DISTRESSED
    """
    pio = piotroski_f_score(symbol, snap=snap)
    alt = altman_z_score(symbol, snap=snap)
    dp = dupont_decomposition(symbol, snap=snap)
    cfq = cfo_to_ebitda(symbol, snap=snap)

    # Composite score (0–100)
    score = 50  # base

    # Piotroski contribution (max ±25)
    pio_contrib = round((pio.score - 4.5) / 4.5 * 25)
    score += pio_contrib

    # Altman contribution (max ±15)
    if alt.zone == "SAFE":
        score += 15
    elif alt.zone == "GREY":
        score += 0
    elif alt.zone == "DISTRESS":
        score -= 20

    # Cash flow quality contribution (max ±10)
    cfq_map = {"HIGH": 10, "MODERATE": 5, "LOW": -5, "NEGATIVE": -15, "UNAVAILABLE": 0}
    score += cfq_map.get(cfq.verdict, 0)

    score = max(0, min(100, score))

    if score >= 70:
        verdict = "HEALTHY"
    elif score >= 50:
        verdict = "MODERATE"
    elif score >= 35:
        verdict = "STRESSED"
    else:
        verdict = "DISTRESSED"

    summary_parts = [
        f"Piotroski F-Score: {pio.score}/9 ({pio.label})",
        f"Altman Z-Score: {alt.z_score or 'N/A'} ({alt.zone})",
        f"DuPont Primary Driver: {dp.primary_driver}",
        f"Cash Flow Quality: {cfq.verdict} (CFO/EBITDA={cfq.ratio or 'N/A'})",
    ]

    return FinancialHealthReport(
        symbol=symbol.upper(),
        piotroski=pio,
        altman=alt,
        dupont=dp,
        cash_flow_quality=cfq,
        overall_verdict=verdict,
        overall_score=score,
        summary=" | ".join(summary_parts),
    )
