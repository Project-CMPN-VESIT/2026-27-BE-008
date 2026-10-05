"""
web/cyro_engine/adapters/filings.py
───────────────────────────────────
CYRO FilingsAdapter (Part of Agent 2: Context Builder).
Fetches authoritative corporate announcements and Reg 30 disclosures from the pipeline DB
or live exchange endpoints (NSE & BSE).
"""

import logging
from typing import Any, Dict, List
from .base import SourceAdapter, AdapterResult
from .db_utils import get_pipeline_data

logger = logging.getLogger(__name__)


class FilingsAdapter(SourceAdapter):
    """Fetches corporate announcements and Reg 30 disclosures from the pipeline DB or live exchange."""

    def __init__(self):
        super().__init__(name="Corporate Announcements", default_quality="PRIMARY", timeout=15, cache_ttl=600)

    def _fetch_primary(self, symbol: str, **kwargs) -> Any:
        announcements = []

        # 1. Check persistent pipeline data
        try:
            data = get_pipeline_data(symbol)
            if data:
                filings = data.get("filings", {})
                announcements = filings.get("announcements", [])
        except Exception as e:
            logger.warning(f"Failed to read filings from pipeline DB for {symbol}: {e}")

        # 2. Live Exchange Fallthrough if DB has no announcements
        if not announcements:
            try:
                from market.news import get_nse_announcements, get_bse_filings
                nse_items = get_nse_announcements(symbol, n=10)
                bse_items = get_bse_filings(symbol, n=5)

                for item in nse_items:
                    announcements.append({
                        "title": item.title,
                        "headline": item.title,
                        "date": item.published,
                        "published_at": item.published,
                        "details": item.summary,
                        "summary": item.summary,
                        "source": "NSE",
                        "provider": "NSE",
                    })

                for item in bse_items:
                    announcements.append({
                        "title": item.title,
                        "headline": item.title,
                        "date": item.published,
                        "published_at": item.published,
                        "details": item.summary,
                        "summary": item.summary,
                        "source": "BSE",
                        "provider": "BSE",
                    })
            except Exception as e:
                logger.warning(f"Failed to fetch live exchange filings for {symbol}: {e}")

        return {"announcements": announcements}

    def _build_evidence(self, symbol: str, research_id: str, result: AdapterResult) -> List[Dict[str, Any]]:
        evidence_list = []
        announcements = (result.data or {}).get("announcements", [])

        # Limit to the most recent 10 to avoid token bloat
        for idx, item in enumerate(announcements[:10]):
            date_str = item.get("date", "") or item.get("published_at", "") or item.get("date_of_broadcast", "")
            headline = item.get("headline", "") or item.get("title", "") or item.get("subject", "Corporate Announcement")
            details = item.get("details", "") or item.get("summary", "") or str(item)

            fact_str = headline
            if details and details != headline:
                fact_str += f": {details}"

            evidence = {
                "id": f"ev_{symbol.lower()}_announcement_{idx}",
                "research_id": research_id,
                "ticker": symbol.upper(),
                "type": "exchange_filing",
                "category": "announcements",
                "source_quality": result.source_quality or "PRIMARY",
                "source_name": item.get("source") or result.source_name or "NSE/BSE",
                "title": headline,
                "published_at": date_str,
                "fetched_at": result.fetched_at,
                "excerpt": fact_str,
                "facts": [{"announcement": fact_str}],
                "freshness": result.freshness,
            }
            evidence_list.append(evidence)

        return evidence_list
