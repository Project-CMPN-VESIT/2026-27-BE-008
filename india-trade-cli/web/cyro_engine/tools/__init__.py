"""
web/cyro_engine/tools/__init__.py
──────────────────────────────────
CYRO Agent Tool Library

Exports all LangChain @tool functions organized by domain.

Tool sets by agent role:
  VALUATION_TOOLS  → FundamentalAnalyst
  DATA_TOOLS       → ContextBuilder, NewsCatalystAnalyst
  RISK_TOOLS       → RiskBearAnalyst
  RAG_TOOLS        → FilingsGovernanceAnalyst, FundamentalAnalyst
  MARKET_TOOLS     → SectorPeerMacroAnalyst, TechnicalAnalyst
  HEALTH_TOOLS     → FundamentalAnalyst, FilingsGovernanceAnalyst
  GOVERNANCE_TOOLS → FilingsGovernanceAnalyst
"""

from web.cyro_engine.tools.valuation_tools import (
    run_dcf_valuation,
    compute_graham_number,
    compute_pe_premium,
    get_fundamental_snapshot,
    compute_financial_health,
)
from web.cyro_engine.tools.data_tools import (
    get_live_quote,
    get_news_for_ticker,
    get_corporate_filings,
    get_shareholding_pattern,
    get_bulk_block_deals,
    get_earnings_calendar,
    screen_sebi_shield,
)
from web.cyro_engine.tools.risk_tools import (
    compute_var_for_symbol,
    get_macro_snapshot,
    get_stock_macro_sensitivity,
)
from web.cyro_engine.tools.rag_tools import (
    search_annual_reports,
    search_earnings_transcripts,
)
from web.cyro_engine.tools.market_tools import (
    get_sector_peers,
    get_fii_dii_flows,
    get_option_chain_summary,
    get_governance_report,
)

# Role-specific tool bundles
FUNDAMENTAL_TOOLS = [
    run_dcf_valuation,
    compute_graham_number,
    compute_pe_premium,
    get_fundamental_snapshot,
    compute_financial_health,
]

FILINGS_GOVERNANCE_TOOLS = [
    get_corporate_filings,
    get_shareholding_pattern,
    get_bulk_block_deals,
    get_governance_report,
    screen_sebi_shield,
]

TECHNICAL_TOOLS = [
    get_live_quote,
    get_option_chain_summary,
]

SECTOR_PEER_TOOLS = [
    get_sector_peers,
    get_fii_dii_flows,
    get_macro_snapshot,
    get_stock_macro_sensitivity,
]

NEWS_CATALYST_TOOLS = [
    get_news_for_ticker,
    get_corporate_filings,
    get_earnings_calendar,
]

RISK_BEAR_TOOLS = [
    compute_var_for_symbol,
    get_macro_snapshot,
    get_stock_macro_sensitivity,
    get_bulk_block_deals,
    get_governance_report,
    screen_sebi_shield,
]

# Pre-assemble deduplicated ALL_TOOLS list
_seen_names = set()
ALL_TOOLS = []
for tool_list in [
    FUNDAMENTAL_TOOLS,
    FILINGS_GOVERNANCE_TOOLS,
    TECHNICAL_TOOLS,
    SECTOR_PEER_TOOLS,
    NEWS_CATALYST_TOOLS,
    RISK_BEAR_TOOLS,
]:
    for t in tool_list:
        if t.name not in _seen_names:
            _seen_names.add(t.name)
            ALL_TOOLS.append(t)

__all__ = [
    "run_dcf_valuation",
    "compute_graham_number",
    "compute_pe_premium",
    "get_fundamental_snapshot",
    "compute_financial_health",
    "get_live_quote",
    "get_news_for_ticker",
    "get_corporate_filings",
    "get_shareholding_pattern",
    "get_bulk_block_deals",
    "get_earnings_calendar",
    "compute_var_for_symbol",
    "get_macro_snapshot",
    "get_stock_macro_sensitivity",
    "search_annual_reports",
    "search_earnings_transcripts",
    "get_sector_peers",
    "get_fii_dii_flows",
    "get_option_chain_summary",
    "get_governance_report",
    "screen_sebi_shield",
    # Bundles
    "FUNDAMENTAL_TOOLS",
    "FILINGS_GOVERNANCE_TOOLS",
    "TECHNICAL_TOOLS",
    "SECTOR_PEER_TOOLS",
    "NEWS_CATALYST_TOOLS",
    "RISK_BEAR_TOOLS",
    "ALL_TOOLS",
]
