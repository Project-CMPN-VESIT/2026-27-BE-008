import logging
from typing import Any, Dict, List
from .base import SourceAdapter, AdapterResult
from web.cyro_engine.models import EvidenceItem, DataQualityFlag

logger = logging.getLogger(__name__)

class FinancialsAdapter(SourceAdapter):
    def __init__(self):
        super().__init__(name="Financials API", default_quality="primary", timeout=15, cache_ttl=21600)
        
    def _fetch_primary(self, symbol: str, **kwargs) -> Any:
        financials = {}
        flags = []
        
        # 1. Upstox Annual Financials (equity.db)
        try:
            from web.cyro_engine.equity_db_reader import build_financials_summary
            eq_db = build_financials_summary(symbol)
            if eq_db and eq_db.get("available"):
                financials["upstox_annual"] = eq_db.get("annual_financials", {})
        except Exception as e:
            logger.warning(f"[FinancialsAdapter] equity.db failed for {symbol}: {e}")

        # 2. NSE Quarterly Results
        try:
            from market.nse_client import nse_client
            nse_res = nse_client.get_results_comparison(symbol)
            if nse_res:
                financials["nse_quarterly"] = nse_res
        except Exception as e:
            logger.warning(f"[FinancialsAdapter] NSE quarterly results failed for {symbol}: {e}")

        # 3. Screener Ratios
        try:
            from analysis.fundamental import analyse as fundamental_analyse
            screener_res = fundamental_analyse(symbol)
            if screener_res:
                ratios = {
                    "pe": getattr(screener_res, "pe", None),
                    "pb": getattr(screener_res, "pb", None),
                    "roe": getattr(screener_res, "roe", None),
                    "roce": getattr(screener_res, "roce", None),
                    "debt_equity": getattr(screener_res, "debt_equity", None),
                    "promoter_holding": getattr(screener_res, "promoter_holding", None),
                    "pledged_pct": getattr(screener_res, "pledged_pct", None),
                    "dividend_yield": getattr(screener_res, "dividend_yield", None),
                    "screener_sales_growth": getattr(screener_res, "sales_growth", None),
                }
                financials["screener_ratios"] = ratios
        except Exception as e:
            logger.warning(f"[FinancialsAdapter] Screener ratios failed for {symbol}: {e}")
            
        if not financials:
            raise ValueError("All financial sources failed")
            
        financials["quality_flags"] = flags
        return financials

    def _fetch_fallback(self, symbol: str, **kwargs) -> tuple[Any, str]:
        raise Exception("No fallback configured for financial statements")

    def _build_evidence(self, symbol: str, research_id: str, result: AdapterResult) -> List[Dict[str, Any]]:
        if not result.data:
            return []
            
        evidence_items = []
        financials = result.data
        
        # A. Upstox Annual
        ann = financials.get("upstox_annual", {})
        if ann.get("available") and ann.get("income"):
            periods = ann.get("periods", [])
            inc = ann.get("income", {})
            cf = ann.get("cashflow", {})
            derived = ann.get("derived", {})
            key_ratios = ann.get("key_ratios", {})

            latest_p = periods[0] if periods else "N/A"
            latest_inc = inc.get(latest_p, {})
            latest_cf = cf.get(latest_p, {})
            revenue = latest_inc.get("revenue") or latest_inc.get("total_revenue")
            net_profit = latest_inc.get("net_profit") or latest_inc.get("profit_after_tax")
            op_profit = latest_inc.get("operating_profit")
            ocf = latest_cf.get("cash_flow_from_operations") or latest_cf.get("operating")

            excerpt_parts = [
                f"Period: {latest_p} (consolidated, ₹ Crore)",
                f"Revenue: ₹{revenue:,.0f} Cr" if revenue else None,
                f"Operating Profit: ₹{op_profit:,.0f} Cr" if op_profit else None,
                f"Net Profit: ₹{net_profit:,.0f} Cr" if net_profit else None,
                f"OCF: ₹{ocf:,.0f} Cr" if ocf else None,
                f"EBITDA Margin: {derived.get('ebitda_margin_pct')}%" if derived.get("ebitda_margin_pct") else None,
            ]
            excerpt = " | ".join(p for p in excerpt_parts if p)

            ev_id = f"ev_{symbol.lower()}_upstox_annual"
            evidence_items.append(EvidenceItem(
                id=ev_id, research_id=research_id, ticker=symbol,
                type="exchange_filing", source_quality="primary",
                source_name="Upstox Fundamentals API (via equity.db)",
                title=f"Annual Financial Statements — {symbol} ({latest_p})",
                fetched_at=result.fetched_at, excerpt=excerpt,
                facts=[
                    {"income": {p: v for p, v in list(inc.items())[:4]}},
                    {"cashflow": {p: v for p, v in list(cf.items())[:4]}},
                    {"derived": derived},
                    {"key_ratios": key_ratios},
                ],
                freshness=result.freshness,
            ).model_dump())

        # B. NSE Quarterly
        nse_results = financials.get("nse_quarterly", [])
        if nse_results:
            ev_id = f"ev_{symbol.lower()}_nse_results"
            q_count = len(nse_results)
            try:
                latest = nse_results[0] if nse_results else {}
                excerpt = (
                    f"Latest quarter revenue: ₹{latest.get('income') or latest.get('revenue') or 'N/A'} Cr, "
                    f"Net profit: ₹{latest.get('netProfit') or latest.get('profit') or 'N/A'} Cr, "
                    f"{q_count} quarters available. Amounts in ₹ Crores (NSE Lakhs ÷ 100)."
                )
            except Exception:
                excerpt = f"NSE quarterly results: {q_count} quarters (₹ Crores)"
                
            evidence_items.append(EvidenceItem(
                id=ev_id, research_id=research_id, ticker=symbol,
                type="exchange_filing", source_quality="primary",
                source_name="NSE India — Financial Results",
                title=f"Quarterly Financial Results — {symbol}",
                fetched_at=result.fetched_at, excerpt=excerpt,
                facts=nse_results[:3], freshness=result.freshness,
            ).model_dump())

        # C. Screener Ratios
        ratios = financials.get("screener_ratios", {})
        if ratios:
            ev_id = f"ev_{symbol.lower()}_screener_ratios"
            excerpt = (
                f"P/E: {ratios.get('pe')}, ROE: {ratios.get('roe')}%, "
                f"D/E: {ratios.get('debt_equity')}, Promoter: {ratios.get('promoter_holding')}%, "
                f"Pledged: {ratios.get('pledged_pct')}%"
            )
            evidence_items.append(EvidenceItem(
                id=ev_id, research_id=research_id, ticker=symbol,
                type="trusted_secondary", source_quality="trusted_secondary",
                source_name="Screener.in",
                title=f"Financial Ratios (PE/ROE/ROCE/D-E) — {symbol}",
                fetched_at=result.fetched_at, excerpt=excerpt,
                facts=[ratios], freshness=result.freshness,
            ).model_dump())

        return evidence_items
