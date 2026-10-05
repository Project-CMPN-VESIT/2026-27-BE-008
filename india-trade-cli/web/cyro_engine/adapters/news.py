"""
web/cyro_engine/adapters/news.py
─────────────────────────────────
CYRO NewsAdapter (Part of Agent 2: Context Builder).
Fetches high-relevance company news and announcements from persistent DB or live sources.
Enforces strict provenance, source-quality tiers, and entity relevance.
"""

import logging
from typing import Any, Dict, List
from .base import SourceAdapter, AdapterResult
from .db_utils import get_pipeline_data
from web.cyro_engine.models import EvidenceItem
from market.entity_matcher import EntityMatcher

logger = logging.getLogger(__name__)


def assign_source_quality(provider: str, publisher: str) -> str:
    """Assigns qualitative metadata to a source based on trust hierarchy."""
    provider = (provider or "").upper()
    publisher = (publisher or "").upper()

    primary_sources = ["NSE", "BSE", "COMPANY DISCLOSURE", "SEBI"]
    high_sources = ["BUSINESS STANDARD", "LIVEMINT", "HINDU BL", "MONEYCONTROL", "ET MARKETS", "ECONOMIC TIMES", "REUTERS", "BLOOMBERG", "YAHOOFINANCE"]
    secondary_sources = ["NEWSDATA", "NEWSAPI"]

    if any(x in publisher or x in provider for x in primary_sources):
        return "PRIMARY"
    if any(x in publisher or x in provider for x in high_sources):
        return "HIGH"
    if any(x in publisher or x in provider for x in secondary_sources):
        return "SECONDARY"

    return "FALLBACK"


class NewsAdapter(SourceAdapter):
    def __init__(self):
        super().__init__(name="Multi-Source News", default_quality="SECONDARY", timeout=15, cache_ttl=600)

    def _fetch_primary(self, symbol: str, **kwargs) -> Any:
        articles: List[Dict[str, Any]] = []

        # 1. Persistent Trusted Corpus (pipeline_data.db)
        try:
            db_data = get_pipeline_data(symbol)
            if db_data and "news" in db_data and isinstance(db_data["news"], list):
                for item in db_data["news"][:10]:
                    title = item.get("title", "").strip()
                    if not title:
                        continue
                    summary = item.get("sentiment_tag", "") or item.get("summary", "")
                    is_rel, score, reason, rel_type, news_type = EntityMatcher.evaluate_relevance_details(
                        title=title,
                        summary=summary,
                        symbol=symbol,
                        source_name="persistent_db",
                    )
                    if is_rel:
                        articles.append({
                            "title": title,
                            "provider": "persistent_db",
                            "publisher": item.get("publisher", "Unknown"),
                            "source": item.get("publisher", "Unknown"),
                            "url": item.get("link", ""),
                            "published_at": item.get("published_at", ""),
                            "summary": summary,
                            "relevance_score": score,
                            "relevance_reason": reason,
                            "relevance_type": rel_type,
                            "news_type": news_type,
                            "source_quality": "HIGH",
                        })
        except Exception as e:
            logger.warning(f"Failed to fetch persistent news for {symbol}: {e}")

        # 2. Live Providers Fallthrough (if persistent corpus is empty or sparse)
        if len(articles) < 5:
            try:
                from market.news import get_canonical_stock_news
                canonical_result = get_canonical_stock_news(symbol, n=10)
                live_items = canonical_result.get("news", [])
                for item in live_items:
                    articles.append({
                        "title": item.title,
                        "provider": item.provider or item.source,
                        "publisher": item.publisher or item.source,
                        "source": item.source,
                        "url": item.url,
                        "published_at": item.published,
                        "summary": item.summary,
                        "relevance_score": item.relevance_score,
                        "relevance_reason": item.relevance_reason,
                        "relevance_type": item.relevance_type,
                        "news_type": item.news_type,
                        "source_quality": item.source_quality,
                        "item_id": item.item_id,
                    })
            except Exception as e:
                logger.warning(f"Failed to fetch live canonical news for {symbol}: {e}")

        # Deduplicate across persistent and live results
        from market.news import deduplicate_news, NewsItem
        news_objs = [
            NewsItem(
                title=a["title"],
                source=a.get("source") or a.get("publisher") or "News",
                url=a.get("url", ""),
                published=a.get("published_at", ""),
                summary=a.get("summary", ""),
                provider=a.get("provider", ""),
                publisher=a.get("publisher", ""),
                source_quality=a.get("source_quality", "SECONDARY"),
                relevance_score=a.get("relevance_score", 1.0),
                relevance_reason=a.get("relevance_reason", ""),
                relevance_type=a.get("relevance_type", "DIRECT"),
                news_type=a.get("news_type", "COMPANY"),
                item_id=a.get("item_id", ""),
            )
            for a in articles
        ]
        deduped = deduplicate_news(news_objs, symbol=symbol)
        final_articles = [n.to_dict() for n in deduped]

        if not final_articles:
            logger.info(f"No relevant news articles found for {symbol} across all providers.")
            return []

        return final_articles

    def _fetch_fallback(self, symbol: str, **kwargs) -> tuple[Any, str]:
        # Graceful fallback handler
        try:
            from market.news import _rss_fallback
            fallback_items = _rss_fallback(symbol, n=5)
            if fallback_items:
                return [i.to_dict() for i in fallback_items], "RSS Fallback"
        except Exception:
            pass
        return [], "Empty Fallback"

    def _build_evidence(self, symbol: str, research_id: str, result: AdapterResult) -> List[Dict[str, Any]]:
        if not result.list_data:
            return []

        evidence_items = []
        for i, article in enumerate(result.list_data):
            # Evidence Rule: Only items passing relevance check can become evidence
            relevance_score = article.get("relevance_score", 1.0)
            if relevance_score < 0.65:
                continue

            ev_id = f"ev_{symbol.lower()}_news_{i}"
            title = article.get("title", "News Article")
            link = article.get("url", "")
            pub_date = article.get("published_at", "")
            summary = article.get("summary", "No summary available.")
            provider = article.get("provider", "Unknown")
            publisher = article.get("publisher", "Unknown")

            if summary and len(summary) > 250:
                summary = summary[:247] + "..."

            quality = article.get("source_quality") or assign_source_quality(provider, publisher)

            evidence_items.append(EvidenceItem(
                id=ev_id,
                research_id=research_id,
                ticker=symbol.upper(),
                type="news",
                source_quality=quality,
                source_name=publisher,
                title=title,
                url=link,
                published_at=pub_date,
                fetched_at=result.fetched_at,
                excerpt=summary,
                facts=[
                    {"publisher": publisher},
                    {"provider": provider},
                    {"relevance_score": relevance_score},
                    {"relevance_reason": article.get("relevance_reason", "")},
                    {"relevance_type": article.get("relevance_type", "DIRECT")},
                    {"news_type": article.get("news_type", "COMPANY")},
                ],
                freshness=result.freshness,
            ).model_dump())

        return evidence_items
