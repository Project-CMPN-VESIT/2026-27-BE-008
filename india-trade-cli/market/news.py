"""
market/news.py
──────────────
Multi-source canonical news and corporate disclosures engine for Indian equities.

Sources supported:
  1. NSE Corporate Announcements — Authoritative exchange filings
  2. BSE Corporate Filings       — Authoritative exchange filings
  3. NewsData.io API             — Precision commercial search
  4. Curated Stock RSS Feeds     — ET Stocks, Hindu BL, Moneycontrol, LiveMint, Business Standard
  5. NewsAPI.org                 — Global/Indian search (gracefully skipped if 401/unavailable)
  6. Yahoo Finance News          — Real-time headlines (malformed/empty titles discarded)

Features:
  - Observability Audit Trail (`provider_audit`): Tracks PASS/EMPTY/FAILED/SKIPPED status,
    raw count, relevant count, rejected count, rejection reasons, error message, and latency.
  - Zero-Contamination Guarantee: `_rss_fallback()` never returns unrelated macro articles.
  - Generic Entity Matching via `market.entity_matcher.EntityMatcher`.
  - Quality Tiers: PRIMARY (NSE/BSE) > HIGH (Mainline press) > SECONDARY (NewsData) > FALLBACK (RSS).
  - Cross-Source Deduplication: Groups near-identical headlines and keeps the highest-quality source.
"""

from __future__ import annotations

import concurrent.futures
import email.utils
import hashlib
import logging
import os
import re
import time
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Set, Tuple
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

import httpx

try:
    import feedparser
    _FEEDPARSER_AVAILABLE = True
except ImportError:
    _FEEDPARSER_AVAILABLE = False

try:
    import yfinance as yf
    _YFINANCE_AVAILABLE = True
except ImportError:
    _YFINANCE_AVAILABLE = False

from market.entity_matcher import EntityMatcher

logger = logging.getLogger(__name__)


# ── Publication Date Parsing & Freshness Utilities ───────────


def parse_publication_date(pub_str: Any) -> Optional[datetime]:
    """
    Parses various date formats (ISO 8601, RFC 2822, NSE format DD-Mon-YYYY HH:MM:SS)
    and returns a UTC datetime (or naive datetime in UTC).
    """
    if not pub_str or not str(pub_str).strip():
        return None
    s = str(pub_str).strip()

    # 1. Try RFC 2822 / email format (e.g. '23 Apr 2024 08:11:02 +0000', 'Sun, 29 Aug 2026 17:46:11 GMT')
    try:
        dt = email.utils.parsedate_to_datetime(s)
        if dt is not None:
            if dt.tzinfo is not None:
                return dt.astimezone(timezone.utc).replace(tzinfo=None)
            return dt
    except Exception:
        pass

    # 2. Try NSE format: DD-Mon-YYYY HH:MM:SS or DD-Mon-YYYY
    for nse_fmt in ["%d-%b-%Y %H:%M:%S", "%d-%b-%Y %H:%M", "%d-%b-%Y", "%d-%B-%Y %H:%M:%S", "%d-%B-%Y"]:
        try:
            return datetime.strptime(s, nse_fmt)
        except ValueError:
            pass

    # 3. Try ISO 8601 / standard datetime formats
    clean_iso = s.replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(clean_iso)
        if dt.tzinfo is not None:
            return dt.astimezone(timezone.utc).replace(tzinfo=None)
        return dt
    except Exception:
        pass

    for iso_fmt in [
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M:%S.%f",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%dT%H:%M:%S.%f",
        "%Y-%m-%d",
    ]:
        try:
            return datetime.strptime(s[:19], iso_fmt[:len(s[:19])])
        except ValueError:
            pass

    return None


def get_canonical_date_str(pub_str: Any) -> str:
    """
    Returns canonical YYYY-MM-DD string for a publication date, or empty string.
    """
    dt = parse_publication_date(pub_str)
    if dt:
        return dt.strftime("%Y-%m-%d")
    return (str(pub_str) if pub_str else "")[:10]


def normalize_announcement_comparison_title(title: str) -> str:
    """
    Strips exchange boilerplate prefixes (e.g. 'Intimation of', 'Submission of', 'Disclosure under')
    and trailing SEBI regulation suffixes for cross-exchange duplicate detection.
    """
    norm = normalize_headline(title)
    norm = re.sub(
        r"^(?:intimation\s+(?:of|regarding|under|for)|submission\s+of|disclosure\s+under|outcome\s+of|updates?\s+(?:on|about)|copy\s+of)\s+",
        "",
        norm,
        flags=re.IGNORECASE,
    ).strip()
    if "regulation 30" in norm:
        return "disclosure under regulation 30"
    return norm


# ── URL & Headline Normalization Utilities ───────────────────


def normalize_url(raw_url: str) -> str:
    """
    Normalizes a URL to a canonical representation.
    - Lowercase hostname
    - Strip trailing slashes
    - Remove tracking / marketing parameters (utm_*, fbclid, gclid, etc.)
    - Sort remaining query parameters
    """
    if not raw_url or not raw_url.strip():
        return ""
    try:
        parsed = urlparse(raw_url.strip())
        if not parsed.netloc:
            return raw_url.strip().rstrip("/")

        scheme = parsed.scheme.lower() or "https"
        netloc = parsed.netloc.lower()
        if netloc.startswith("www."):
            netloc = netloc[4:]

        path = parsed.path.rstrip("/")
        if not path:
            path = "/"

        # Filter query params
        tracking_params = {
            "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
            "fbclid", "gclid", "ref", "ocid", "ncid", "sr_share", "_ga", "igshid",
            "feature", "service"
        }

        query_dict = parse_qs(parsed.query, keep_blank_values=False)
        filtered_query = {
            k: v for k, v in query_dict.items() if k.lower() not in tracking_params
        }

        sorted_query = urlencode(sorted([(k, val) for k, vals in filtered_query.items() for val in vals]))
        return urlunparse((scheme, netloc, path, "", sorted_query, ""))
    except Exception:
        return raw_url.strip().rstrip("/")


def normalize_headline(text: str) -> str:
    """
    Normalize headline for title comparison:
    - Lowercase, unicode normalize (NFKD)
    - Strip common publisher suffixes (' - The Hindu BusinessLine', ' | Reuters', etc.)
    - Remove punctuation, collapse whitespace
    """
    if not text:
        return ""
    text = unicodedata.normalize("NFKD", text)
    text = re.sub(
        r"\s*([\|\-\–—]\s*(The Hindu BusinessLine|Business Standard|The Economic Times|ET Markets|LiveMint|Moneycontrol|Reuters|Bloomberg|CNBC|NDTV Profit|LatestLY|Stockwatch|TradingView|NamasteCar|TelecomLiveWeb)).*$",
        "",
        text,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(r"[^\w\s]", " ", text.lower())
    return re.sub(r"\s+", " ", cleaned).strip()


def generate_item_id(url: str, title: str, publisher: str, published: str) -> str:
    """
    Generates a deterministic, collision-resistant 16-character item_id.
    """
    canonical_url = normalize_url(url)
    norm_title = normalize_headline(title)
    pub = (publisher or "").strip().lower()
    date_str = (published or "")[:10]

    seed = f"{canonical_url}|{norm_title}|{pub}|{date_str}"
    h = hashlib.sha256(seed.encode("utf-8")).hexdigest()[:16]
    return f"news_{h}"


def normalize_announcement_title(title: str, summary: str = "", symbol: str = "") -> str:
    """
    Derives a meaningful, concise announcement title from summary/description
    if the original title is a generic label (e.g. 'General Updates', 'Updates', 'Enclosed').
    Does not fabricate facts; uses only text present in the payload.
    """
    raw_title = (title or "").strip()
    summary_clean = (summary or "").strip()

    generic_titles = {
        "GENERAL UPDATES", "GENERAL UPDATE", "CORPORATE UPDATE", "CORPORATE UPDATES",
        "UPDATES", "UPDATE", "ENCLOSED", "ANNOUNCEMENT", "ANNOUNCEMENTS",
        "NSE CORPORATE ANNOUNCEMENT", "BSE CORPORATE FILING"
    }

    if raw_title.upper() not in generic_titles:
        # Title is already specific (e.g. "Credit Rating", "Allotment of securities", "Press Release...")
        clean_title = re.sub(r"^[A-Z0-9\s\.\,\&]+:\s*", "", raw_title)
        return clean_title if len(clean_title) > 3 else raw_title

    if not summary_clean:
        return raw_title

    # 1. Press release with quoted title: titled "..." or titled '...'
    pr_match = re.search(r'titled\s+[\"\'\“\‘]([^\^\"\'\”\’]+)[\"\'\”\’]', summary_clean, re.IGNORECASE)
    if pr_match and len(pr_match.group(1).strip()) > 5:
        return f"Press Release: {pr_match.group(1).strip()}"

    # 2. SEBI Regulation 30 disclosures
    if re.search(r'Regulation\s+30', summary_clean, re.IGNORECASE):
        reg_subj = re.search(
            r'(?:regarding|about)\s+([A-Za-z0-9\s\/\,\-\(\)]+?)(?:pursuant\s+to|of\s+the\s+SEBI|\.|$)',
            summary_clean,
            re.IGNORECASE
        )
        if reg_subj and len(reg_subj.group(1).strip()) > 8:
            extracted = reg_subj.group(1).strip().rstrip(",.- ")
            return extracted[:90]
        return "Disclosure under Regulation 30 (SEBI LODR)"

    # 3. Standard NSE phrases: "has informed the Exchange regarding/about <Topic>"
    info_match = re.search(r'has informed the Exchange\s+(?:regarding|about)\s+([A-Za-z0-9\s\/\,\-\(\)]+?)(?:\.|$)', summary_clean, re.IGNORECASE)
    if info_match and len(info_match.group(1).strip()) > 3:
        extracted = info_match.group(1).strip().rstrip(",.- ")
        if extracted.lower() == "schedule of meet":
            return "Schedule of Analyst / Investor Meeting"
        return extracted[:90]

    # 4. Clean "Company Name: <Topic>" in BSE summary
    bse_prefix = re.search(r'^[A-Z0-9\s\.\,\&]+:\s*([A-Za-z0-9\s\/\,\-\(\)]+)', summary_clean)
    if bse_prefix and len(bse_prefix.group(1).strip()) > 5 and bse_prefix.group(1).strip().upper() not in generic_titles:
        return bse_prefix.group(1).strip()[:90]

    return raw_title


# ── NewsItem ─────────────────────────────────────────────────


@dataclass
class NewsItem:
    title: str
    source: str
    url: str
    published: str  # ISO datetime string or formatted date
    summary: str = ""
    provider: str = ""
    publisher: str = ""
    source_quality: str = "SECONDARY"  # PRIMARY, HIGH, SECONDARY, FALLBACK
    relevance_score: float = 1.0
    relevance_reason: str = ""
    relevance_type: str = "DIRECT"  # DIRECT, INDIRECT, MARKET, ANALYST, INDUSTRY, MENTION_ONLY
    news_type: str = "COMPANY"  # COMPANY, REGULATORY, MARKET, ANALYST, INDUSTRY, PARTNERSHIP, CORPORATE_ACTION, MANAGEMENT, OTHER
    item_id: str = ""

    def __post_init__(self):
        if not self.item_id:
            self.item_id = generate_item_id(self.url, self.title, self.publisher or self.source, self.published)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "title": self.title,
            "source": self.source,
            "url": self.url,
            "published": self.published,
            "published_at": self.published,
            "summary": self.summary,
            "provider": self.provider or self.source,
            "publisher": self.publisher or self.source,
            "source_quality": self.source_quality,
            "relevance_score": self.relevance_score,
            "relevance_reason": self.relevance_reason,
            "relevance_type": self.relevance_type,
            "news_type": self.news_type,
            "item_id": self.item_id,
        }



# ── RSS feed definitions ──────────────────────────────────────

RSS_FEEDS = {
    "ET Stocks": "https://economictimes.indiatimes.com/markets/stocks/rssfeeds/2146842.cms",
    "Hindu BL": "https://www.thehindubusinessline.com/markets/?service=rss",
    "MoneyControl": "https://www.moneycontrol.com/rss/latestnews.xml",
    "LiveMint Markets": "https://www.livemint.com/rss/markets",
    "Business Standard": "https://www.business-standard.com/rss/markets-106.rss",
    "ET Markets": "https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms",
}

NSE_ANNOUNCEMENTS_URL = (
    "https://www.nseindia.com/api/corporate-announcements?index=equities&symbol={symbol}"
)

BSE_ANNOUNCEMENTS_URL = (
    "https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w?pageno=1&strCat=-1&strPrevDate=&strScrip={bse_code}&strSearch=P&strToDate=&strType=C&subcategory="
)

NEWSDATA_ENDPOINT = "https://newsdata.io/api/1/latest"
NEWSDATA_MARKET_ENDPOINT = "https://newsdata.io/api/1/market"
NEWSAPI_ENDPOINT = "https://newsapi.org/v2/everything"

# BSE Code Fallback mapping for common tickers
_COMMON_BSE_CODES = {
    "RELIANCE": "500325",
    "TCS": "532540",
    "HDFCBANK": "500180",
    "INFY": "500209",
    "ICICIBANK": "532174",
    "SBIN": "500112",
    "BHARTIARTL": "532454",
    "KOTAKBANK": "500247",
    "LT": "500510",
    "AXISBANK": "532215",
    "MARUTI": "532500",
    "ASIANPAINT": "500820",
    "BAJFINANCE": "500034",
    "HCLTECH": "532281",
    "TITAN": "500114",
    "WIPRO": "507685",
    "TATAMOTORS": "500570",
    "TATASTEEL": "500470",
}


def _get_bse_code(symbol: str) -> Optional[str]:
    sym = symbol.upper().strip().replace(".NS", "").replace(".BO", "")
    if sym in _COMMON_BSE_CODES:
        return _COMMON_BSE_CODES[sym]
    try:
        from web.cyro_engine.intent_router.security_master import get_security_master
        for s in get_security_master().get_all_securities():
            if (s.get("nse_symbol") or "").upper() == sym and s.get("bse_code"):
                return str(s["bse_code"])
    except Exception:
        pass
    return None


def _get_api_key() -> str:
    """Retrieve API key from env or keychain without prompting interactively."""
    key = (
        os.environ.get("NEWSDATA_API_KEY", "").strip()
        or os.environ.get("NEWSAPI_KEY", "").strip()
        or os.environ.get("NEWS_API_KEY", "").strip()
    )
    if not key:
        try:
            from config.credentials import _kr_get
            key = _kr_get("NEWSAPI_KEY") or _kr_get("NEWSDATA_API_KEY") or ""
        except Exception:
            key = ""
    return key


def _strip_html(text: str) -> str:
    """Remove HTML tags and clean up string."""
    clean = re.sub(r"<[^>]+>", "", text or "")
    return re.sub(r"\s+", " ", clean).strip()[:400]


# ── RSS Helper ────────────────────────────────────────────────


def get_rss_feed(url: str, source: str = "RSS", n: int = 20) -> list[NewsItem]:
    """Parse any RSS feed and return the latest n items."""
    if not _FEEDPARSER_AVAILABLE:
        return []
    try:
        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
        resp = httpx.get(url, headers=headers, timeout=8.0)
        if resp.status_code != 200:
            return []
        feed = feedparser.parse(resp.text)
        items = []
        for entry in feed.entries[:n]:
            published = entry.get("published", entry.get("updated", ""))
            if hasattr(entry, "published_parsed") and entry.published_parsed:
                dt = datetime(*entry.published_parsed[:6], tzinfo=timezone.utc)
                published = dt.isoformat()
            items.append(
                NewsItem(
                    title=entry.get("title", "").strip(),
                    source=source,
                    url=entry.get("link", ""),
                    published=published,
                    summary=_strip_html(entry.get("summary", "")),
                    provider="RSS",
                    publisher=source,
                    source_quality="HIGH" if source in ["Hindu BL", "Business Standard", "LiveMint Markets", "ET Stocks"] else "FALLBACK",
                )
            )
        return items
    except Exception as e:
        logger.debug(f"RSS fetch error for {source}: {e}")
        return []


# ── NSE Corporate Announcements ───────────────────────────────


def get_nse_announcements(symbol: str, n: int = 10) -> list[NewsItem]:
    """
    Recent corporate announcements from NSE for a symbol.
    Official exchange disclosures (PRIMARY quality).
    """
    sym = symbol.upper().strip().replace(".NS", "").replace(".BO", "")
    items: list[NewsItem] = []
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "application/json, text/plain, */*",
            "Referer": "https://www.nseindia.com",
        }
        with httpx.Client(follow_redirects=True, timeout=10.0) as session:
            session.get("https://www.nseindia.com", headers=headers)
            r = session.get(NSE_ANNOUNCEMENTS_URL.format(symbol=sym), headers=headers)
            if r.status_code == 200:
                data = r.json()
                raw_rows = data if isinstance(data, list) else data.get("data", [])
                for ann in raw_rows[:n]:
                    raw_title = ann.get("desc") or ann.get("subject") or "NSE Corporate Announcement"
                    summary = ann.get("attchmntText") or ann.get("an_dt") or ""
                    clean_title = normalize_announcement_title(raw_title, summary, symbol=sym)
                    
                    _, score, reason, rel_type, news_type = EntityMatcher.evaluate_relevance_details(
                        title=clean_title,
                        summary=summary,
                        symbol=sym,
                        source_name="NSE",
                    )

                    items.append(
                        NewsItem(
                            title=clean_title.strip(),
                            source="NSE",
                            url="https://www.nseindia.com/companies-listing/corporate-filings-announcements",
                            published=ann.get("an_dt", "") or datetime.now(timezone.utc).isoformat(),
                            summary=_strip_html(summary),
                            provider="NSE",
                            publisher="NSE",
                            source_quality="PRIMARY",
                            relevance_score=1.0,
                            relevance_reason="Official NSE corporate filing",
                            relevance_type="DIRECT",
                            news_type=news_type or "REGULATORY",
                        )
                    )
    except Exception as e:
        logger.warning(f"Error fetching NSE announcements for {sym}: {e}")
    return items


# ── BSE Corporate Filings ─────────────────────────────────────


def get_bse_filings(symbol: str, n: int = 10) -> list[NewsItem]:
    """
    Recent corporate filings from BSE for a symbol.
    Official exchange disclosures (PRIMARY quality).
    """
    bse_code = _get_bse_code(symbol)
    if not bse_code:
        return []

    items: list[NewsItem] = []
    try:
        url = BSE_ANNOUNCEMENTS_URL.format(bse_code=bse_code)
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
            "Accept": "application/json, text/plain, */*",
            # BSE's gateway 403s a Referer of ann.html; the site root is accepted.
            "Referer": "https://www.bseindia.com/",
            "Origin": "https://www.bseindia.com",
        }
        # BSE's gateway 403s httpx's fingerprint but accepts `requests`; an empty date range
        # returns no rows, so ask for the last 90 days.
        import requests as _requests
        _to = datetime.now()
        _from = _to - timedelta(days=90)
        url = url.replace("strPrevDate=&", f"strPrevDate={_from:%Y%m%d}&").replace("strToDate=&", f"strToDate={_to:%Y%m%d}&")
        with _requests.Session() as client:
            try:
                client.get("https://www.bseindia.com/corporates/ann.html",
                           headers={"User-Agent": headers["User-Agent"]}, timeout=10)
            except Exception:
                pass
            _r = client.get(url, headers=headers, timeout=10)

        class _R:  # keep the downstream status_code/json() usage unchanged
            status_code = _r.status_code
            def json(self_inner):
                return _r.json()
        r = _R()
        if r.status_code != 200:
            logger.warning(f"BSE filings for {symbol} returned HTTP {r.status_code}")
        if r.status_code == 200:
            data = r.json()
            table = data.get("Table", [])
            for row in table[:n]:
                raw_headline = row.get("HEADLINE") or row.get("NEWSSUB") or "BSE Corporate Filing"
                company = row.get("SLONGNAME") or symbol
                date_str = row.get("NEWS_DT") or row.get("DissemDT") or ""
                summary = f"{company}: {raw_headline}"
                clean_title = normalize_announcement_title(raw_headline, summary, symbol=symbol)

                _, score, reason, rel_type, news_type = EntityMatcher.evaluate_relevance_details(
                    title=clean_title,
                    summary=summary,
                    symbol=symbol,
                    source_name="BSE",
                )

                items.append(
                    NewsItem(
                        title=clean_title.strip(),
                        source="BSE",
                        url="https://www.bseindia.com/corporates/ann.html",
                        published=date_str or datetime.now(timezone.utc).isoformat(),
                        summary=summary,
                        provider="BSE",
                        publisher="BSE",
                        source_quality="PRIMARY",
                        relevance_score=1.0,
                        relevance_reason="Official BSE corporate filing",
                        relevance_type="DIRECT",
                        news_type=news_type or "REGULATORY",
                    )
                )
    except Exception as e:
        logger.warning(f"Error fetching BSE filings for {symbol}: {e}")
    return items


# ── NewsData.io & NewsAPI Fetchers ─────────────────────────────


def _newsdata_fetch(query: str, api_key: str, n: int = 10) -> Tuple[list[NewsItem], list[dict]]:
    """Fetch from NewsData.io with relevance evaluation."""
    raw_articles: list[dict] = []
    accepted: list[NewsItem] = []
    for endpoint in [NEWSDATA_MARKET_ENDPOINT, NEWSDATA_ENDPOINT]:
        try:
            params = {
                "apikey": api_key,
                "q": query,
                "country": "in",
                "language": "en",
            }
            r = httpx.get(endpoint, params=params, timeout=8.0)
            if r.status_code != 200:
                continue
            data = r.json()
            articles = data.get("results", [])
            if not articles:
                continue
            raw_articles.extend(articles)
            for a in articles:
                title = a.get("title", "").strip()
                if not title or "[Removed]" in title:
                    continue
                summary = a.get("description") or a.get("content") or ""
                is_rel, score, reason, rel_type, news_type = EntityMatcher.evaluate_relevance_details(
                    title=title,
                    summary=summary,
                    symbol=query,
                    source_name="NewsData",
                )
                if is_rel:
                    accepted.append(
                        NewsItem(
                            title=title,
                            source=a.get("source_name") or a.get("source_id") or "NewsData",
                            url=a.get("link", ""),
                            published=a.get("pubDate", "") or datetime.now(timezone.utc).isoformat(),
                            summary=_strip_html(summary),
                            provider="NewsData",
                            publisher=a.get("source_name") or "NewsData",
                            source_quality="SECONDARY",
                            relevance_score=score,
                            relevance_reason=reason,
                            relevance_type=rel_type,
                            news_type=news_type,
                        )
                    )
            if accepted:
                break
        except Exception:
            continue
    return accepted[:n], raw_articles


def _company_query_name(symbol: str) -> str:
    """Best human-searchable name for a ticker (e.g. INFY -> 'Infosys'); falls back to the ticker."""
    sym = symbol.upper().strip().replace(".NS", "").replace(".BO", "")
    try:
        aliases = [a for a in EntityMatcher.get_aliases_for_symbol(sym) if a != sym and len(a) >= 4]
        if aliases:
            return min(aliases, key=len).title()
    except Exception:
        pass
    return sym


def _newsapi_fetch(query: str, api_key: str, n: int = 10) -> Tuple[list[NewsItem], list[dict], Optional[str]]:
    """Fetch from NewsAPI.org with error capturing (queries by company name, not ticker)."""
    try:
        name = _company_query_name(query)
        # NewsAPI indexes prose, not tickers: "INFY stock India NSE" finds ~1 article, the name finds hundreds.
        q = f'"{name}" AND (shares OR stock OR results OR earnings OR NSE OR Sensex OR Nifty)'
        r = httpx.get(
            NEWSAPI_ENDPOINT,
            params={
                "q": q,
                "language": "en",
                "sortBy": "publishedAt",
                "searchIn": "title,description",
                "from": (datetime.now(timezone.utc) - timedelta(days=14)).strftime("%Y-%m-%d"),
                "pageSize": min(n * 3, 50),
                "apiKey": api_key,
            },
            timeout=8.0,
        )
        data = r.json()
        if r.status_code != 200 or data.get("status") != "ok":
            error_msg = data.get("message") or f"HTTP {r.status_code}"
            return [], [], error_msg

        raw = data.get("articles", [])
        accepted: list[NewsItem] = []
        for a in raw:
            title = a.get("title", "").strip()
            if not title or "[Removed]" in title:
                continue
            summary = a.get("description") or ""
            is_rel, score, reason, rel_type, news_type = EntityMatcher.evaluate_relevance_details(
                title=title,
                summary=summary,
                symbol=query,
                source_name="NewsAPI",
            )
            if is_rel:
                accepted.append(
                    NewsItem(
                        title=title,
                        source=a.get("source", {}).get("name", "NewsAPI"),
                        url=a.get("url", ""),
                        published=a.get("publishedAt", "") or datetime.now(timezone.utc).isoformat(),
                        summary=_strip_html(summary),
                        provider="NewsAPI",
                        publisher=a.get("source", {}).get("name", "NewsAPI"),
                        source_quality="SECONDARY",
                        relevance_score=score,
                        relevance_reason=reason,
                        relevance_type=rel_type,
                        news_type=news_type,
                    )
                )
        return accepted[:n], raw, None
    except Exception as e:
        return [], [], str(e)


# ── Yahoo Finance Fetcher ─────────────────────────────────────


def _yfinance_fetch(symbol: str, n: int = 10) -> Tuple[list[NewsItem], int, int]:
    """
    Fetch news via yfinance, supporting both modern .content and legacy schemas.
    Discards any entry where title is missing or empty.
    """
    if not _YFINANCE_AVAILABLE:
        return [], 0, 0

    sym = symbol.upper().strip().replace(".NS", "").replace(".BO", "")
    accepted: list[NewsItem] = []
    raw_count = 0
    rejected_count = 0

    try:
        t = yf.Ticker(f"{sym}.NS")
        raw = t.news or []
        raw_count = len(raw)
        for entry in raw:
            content = entry.get("content") if isinstance(entry.get("content"), dict) else {}
            title = entry.get("title") or content.get("title") or ""
            title = title.strip()

            if not title:
                rejected_count += 1
                continue

            link = entry.get("link") or content.get("canonicalUrl", {}).get("url") or ""
            publisher = entry.get("publisher") or content.get("provider", {}).get("displayName") or "Yahoo Finance"
            pub_time = entry.get("providerPublishTime") or content.get("pubDate")

            formatted_time = (
                datetime.fromtimestamp(pub_time, tz=timezone.utc).isoformat()
                if isinstance(pub_time, (int, float))
                else (str(pub_time) if pub_time else datetime.now(timezone.utc).isoformat())
            )
            summary = entry.get("summary") or content.get("summary") or ""

            is_rel, score, reason, rel_type, news_type = EntityMatcher.evaluate_relevance_details(
                title=title,
                summary=summary,
                symbol=sym,
                source_name="Yahoo Finance",
            )
            if is_rel:
                accepted.append(
                    NewsItem(
                        title=title,
                        source=publisher,
                        url=link,
                        published=formatted_time,
                        summary=_strip_html(summary),
                        provider="YahooFinance",
                        publisher=publisher,
                        source_quality="HIGH",
                        relevance_score=score,
                        relevance_reason=reason,
                        relevance_type=rel_type,
                        news_type=news_type,
                    )
                )
            else:
                rejected_count += 1
    except Exception as e:
        logger.warning(f"yfinance news error for {sym}: {e}")

    return accepted[:n], raw_count, rejected_count


# ── Deduplication & Usefulness Ranking Engine ─────────────────


def get_display_priority(item: NewsItem) -> int:
    """
    Assigns deterministic priority rank (0=Highest to 5=Lowest):
    P0 (0): Critical Corporate Events (Management, Regulatory, Filings, Corporate Actions, Earnings, Major M&A/Contracts)
    P1 (1): Direct Company Reporting & Dedicated Brokerage / Research Notes
    P2 (2): Direct Strategic Partnerships / Tech Deployments
    P3 (3): Dedicated Company Stock Movements / Price Action
    P4 (4): Material Sector / Industry Context
    P5 (5): Multi-Stock Listicles ("Stocks to buy today..."), Market Wraps & Incidental Mentions
    """
    news_t = (item.news_type or "").upper()
    rel_t = (item.relevance_type or "").upper()
    title_u = (item.title or "").upper()

    # Multi-stock listicles or generic market wraps
    multi_patterns = [
        r"\bSTOCKS\s+TO\s+(?:BUY|SELL|WATCH)\b",
        r"\bSHARES\s+TO\s+(?:BUY|SELL|WATCH)\b",
        r"\bSTOCKS\s+IN\s+FOCUS\b",
        r"\bSHARES\s+IN\s+FOCUS\b",
        r"\bMARKET\s+WRAP\b",
        r"\bTOP\s+(?:GAINERS|LOSERS)\b",
        r"\bBUY\s+OR\s+SELL\s+STOCKS\b",
        r"\bSHARES\s+THAT\s+MAY\s+REMAIN\s+IN\s+FOCUS\b",
    ]
    if any(re.search(p, title_u) for p in multi_patterns) or rel_t == "MENTION_ONLY":
        return 5

    # P0: Exchange Filings, Management, Regulatory, Corporate Action, Earnings, M&A/Contracts
    if news_t in ["MANAGEMENT", "REGULATORY", "CORPORATE_ACTION"]:
        return 0
    if news_t == "COMPANY" and (item.relevance_score or 0) >= 0.95:
        return 0

    # P1: Direct Company Specific News / Dedicated Brokerage Analysis
    if rel_t == "DIRECT" and (news_t in ["COMPANY", "ANALYST"]):
        return 1

    # P2: Strategic Partnerships & Major Deployments
    if rel_t == "DIRECT" and news_t == "PARTNERSHIP":
        return 2

    # P3: Dedicated Market Price Action
    if news_t == "MARKET" and rel_t == "DIRECT":
        return 3

    # P4: Sector / Industry Context
    if rel_t == "INDIRECT" or news_t == "INDUSTRY":
        return 4

    return 5


def filter_stale_news_for_display(items: list[NewsItem], max_age_days: int = 90) -> list[NewsItem]:
    """
    Suppresses stale news (> max_age_days old) from user-facing display when recent company news exists.
    Determines freshness relative to the newest valid publication date in the candidate set,
    so evaluations remain deterministic.
    Preserves all historical records if no recent news is available.
    """
    if not items:
        return []

    parsed_dates = [(item, parse_publication_date(item.published)) for item in items]
    valid_dates = [dt for _, dt in parsed_dates if dt is not None]

    if not valid_dates:
        return items

    newest_dt = max(valid_dates)

    recent_items = []
    stale_items = []

    for item, dt in parsed_dates:
        if dt is None:
            recent_items.append(item)
        else:
            age_days = (newest_dt - dt).total_seconds() / 86400.0
            if age_days <= max_age_days:
                recent_items.append(item)
            else:
                stale_items.append(item)

    # If we have at least 2 recent items, suppress stale items for user display
    if len(recent_items) >= 2:
        return recent_items
    elif recent_items:
        return items
    return items


def should_display_news_item(item: NewsItem, symbol: str = "") -> bool:
    """
    Evaluates whether a news item is eligible for user-facing display in the War Room News tab.
    - DIRECT company events & reporting: ALWAYS eligible.
    - Dedicated analyst / price movements: Eligible.
    - Material sector / industry context: Eligible.
    - Multi-stock listicles, employee accidents/crimes & weak incidental mentions: Suppressed from primary canonical display.
    """
    if (item.news_type or "").upper() == "INCIDENTAL":
        return False
    if (item.relevance_type or "").upper() == "MENTION_ONLY":
        return False
    if (item.relevance_score or 0.0) < 0.65:
        return False
    return get_display_priority(item) < 5


def filter_and_rank_for_display(items: list[NewsItem], symbol: str = "", n: int = 10) -> list[NewsItem]:
    """
    Deduplicates, gates, applies freshness filtering, and ranks news items for user-facing presentation.
    Suppresses low-value multi-stock listicles, incidental mentions, and stale historical news.
    """
    if not items:
        return []

    # 1. Deduplicate first
    deduped = deduplicate_news(items, symbol=symbol)

    # 2. Apply display freshness filter (relative 90-day window)
    fresh_items = filter_stale_news_for_display(deduped, max_age_days=90)

    # 3. Separate high-value company news (P0-P4) from low-value listicles/noise (P5)
    high_value_items = [item for item in fresh_items if should_display_news_item(item, symbol)]
    low_value_items = [
        item for item in fresh_items
        if not should_display_news_item(item, symbol)
        and (item.news_type or "").upper() != "INCIDENTAL"
        and (item.relevance_type or "").upper() != "MENTION_ONLY"
        and (item.relevance_score or 0.0) >= 0.65
    ]

    # If we have direct/substantive company items, suppress P5 listicles/mentions
    if len(high_value_items) > 0:
        eligible_items = high_value_items
    else:
        eligible_items = low_value_items

    # 4. Deterministic Usefulness & Recency Sorting
    quality_priority = {"PRIMARY": 1, "HIGH": 2, "SECONDARY": 3, "FALLBACK": 4}
    
    def display_sort_key(x: NewsItem):
        dt = parse_publication_date(x.published)
        ts = -dt.timestamp() if dt is not None else 0.0
        return (
            get_display_priority(x),
            -(x.relevance_score or 0.0),
            ts,
            quality_priority.get(x.source_quality, 99),
            -len(x.summary or ""),
            str(x.published or ""),
        )

    eligible_items.sort(key=display_sort_key)
    return eligible_items[:n]


def deduplicate_news(items: list[NewsItem], symbol: str = "") -> list[NewsItem]:
    """
    Deduplicates news and corporate announcements across multiple providers using a 3-level hierarchy:
    1. Exact Normalized Canonical URL (ignores tracking params, trailing slashes, etc.)
    2. Same Publisher + Equivalent Normalized Headline (token similarity >= 0.85)
    3. Cross-Provider Syndicated Duplicates / Cross-Exchange Announcements:
       - Normalizes dates to canonical YYYY-MM-DD
       - For NSE/BSE filings on the same calendar day, strips boilerplate prefixes ('Intimation of', 'Disclosure under')
         and merges dual-exchange representations into a single consolidated announcement event ('NSE / BSE').

    When merging duplicates, prefers:
    PRIMARY > HIGH > SECONDARY > FALLBACK
    Tie-breakers: DIRECT relevance_type > higher relevance_score > richer summary > recency.

    Ranks the final deduplicated items by usefulness (directness, score, quality, recency).
    """
    if not items:
        return []

    def candidate_preference_key(x: NewsItem):
        q_order = {"PRIMARY": 0, "HIGH": 1, "SECONDARY": 2, "FALLBACK": 3}
        rel_order = {"DIRECT": 0, "INDIRECT": 1, "MENTION_ONLY": 2, "REJECTED": 3}
        return (
            q_order.get(x.source_quality, 99),
            rel_order.get(x.relevance_type, 99),
            -(x.relevance_score or 0.0),
            -len(x.summary or ""),
            -(len(x.url or "")),
        )

    def is_exchange_item(x: NewsItem) -> bool:
        s_upper = f"{x.source} {x.provider} {x.publisher}".upper()
        return x.source_quality == "PRIMARY" or any(k in s_upper for k in ["NSE", "BSE", "EXCHANGE", "FILING"])

    clusters: list[list[NewsItem]] = []

    for item in items:
        norm_url = normalize_url(item.url)
        norm_title = normalize_headline(item.title)
        pub_date = get_canonical_date_str(item.published)
        pub_name = (item.publisher or item.source or "").lower().strip()
        words = set(norm_title.split())
        ann_comp_title = normalize_announcement_comparison_title(item.title) if is_exchange_item(item) else ""

        matched_cluster = None

        for cluster in clusters:
            rep = cluster[0]
            rep_norm_url = normalize_url(rep.url)
            rep_norm_title = normalize_headline(rep.title)
            rep_pub_date = get_canonical_date_str(rep.published)
            rep_pub_name = (rep.publisher or rep.source or "").lower().strip()
            rep_words = set(rep_norm_title.split())
            rep_ann_comp_title = normalize_announcement_comparison_title(rep.title) if is_exchange_item(rep) else ""

            # Level 1: Exact canonical URL
            if norm_url and rep_norm_url:
                parsed_u = urlparse(norm_url)
                path_parts = [p for p in parsed_u.path.strip("/").split("/") if p]
                is_article_slug = any(
                    ext in parsed_u.path for ext in [".ece", ".cms", ".html", ".htm", ".xml", "/article", "/story", "/news/"]
                ) or len(path_parts) >= 3

                is_generic = (len(path_parts) <= 1 and not is_article_slug) or any(
                    norm_url == g.rstrip("/") for g in [
                        "https://nseindia.com/companies-listing/corporate-filings-announcements",
                        "https://bseindia.com/corporates/ann.html",
                        "https://economictimes.indiatimes.com/markets/stocks",
                        "https://thehindubusinessline.com/markets",
                        "https://livemint.com/market",
                        "moneycontrol.com/news",
                        "https://newsdata.io",
                    ]
                )

                if not is_generic and norm_url == rep_norm_url:
                    matched_cluster = cluster
                    break

            # Level 2: Same Publisher + equivalent headline
            if pub_name and rep_pub_name and (pub_name in rep_pub_name or rep_pub_name in pub_name):
                if norm_title and rep_norm_title and norm_title == rep_norm_title:
                    matched_cluster = cluster
                    break
                if words and rep_words:
                    overlap = len(words.intersection(rep_words)) / max(len(words), len(rep_words))
                    if overlap >= 0.85:
                        matched_cluster = cluster
                        break

            # Level 3: Cross-Exchange Announcements or Cross-Provider Syndicated Duplicates
            same_day = bool(pub_date and rep_pub_date and pub_date == rep_pub_date)
            
            # 3A: Cross-Exchange Corporate Announcements (NSE & BSE)
            if same_day and is_exchange_item(item) and is_exchange_item(rep):
                if ann_comp_title and rep_ann_comp_title:
                    if ann_comp_title == rep_ann_comp_title or ann_comp_title in rep_ann_comp_title or rep_ann_comp_title in ann_comp_title:
                        matched_cluster = cluster
                        break
                if words and rep_words:
                    overlap = len(words.intersection(rep_words)) / max(len(words), len(rep_words))
                    if overlap >= 0.50:
                        matched_cluster = cluster
                        break

            # 3B: Cross-Provider Syndicated News Duplicates
            if words and rep_words:
                stop_words = {
                    "a", "an", "the", "in", "on", "at", "to", "for", "of", "and", "or", "as",
                    "by", "after", "with", "from", "says", "report", "news", "near", "his", "her",
                    "its", "up", "down", "is", "are", "was", "were", "be", "been", "amid", "amidst",
                    "says", "india", "indian", "tata", "indias", "co", "ltd", "corp", "inc"
                }
                meaningful_a = {w for w in words if w not in stop_words and len(w) > 2}
                meaningful_b = {w for w in rep_words if w not in stop_words and len(w) > 2}
                common_meaningful = meaningful_a.intersection(meaningful_b)
                overlap_all = len(words.intersection(rep_words)) / max(len(words), len(rep_words))
                overlap_meaningful = len(common_meaningful) / max(len(meaningful_a), len(meaningful_b)) if (meaningful_a and meaningful_b) else 0.0

                if same_day:
                    if overlap_all >= 0.65 or overlap_meaningful >= 0.50:
                        matched_cluster = cluster
                        break
                    if len(common_meaningful) >= 3 and overlap_meaningful >= 0.25:
                        matched_cluster = cluster
                        break
                elif not pub_date or not rep_pub_date:
                    if overlap_all >= 0.80 or overlap_meaningful >= 0.75:
                        matched_cluster = cluster
                        break

        if matched_cluster is not None:
            matched_cluster.append(item)
        else:
            clusters.append([item])

    # Select best representative for each cluster and merge cross-exchange provenance
    deduped: list[NewsItem] = []
    for cluster in clusters:
        cluster.sort(key=candidate_preference_key)
        best = cluster[0]

        # Check for dual-exchange presence (NSE & BSE) in announcement clusters
        all_sources = " ".join(f"{c.source} {c.publisher} {c.provider}" for c in cluster).upper()
        if "NSE" in all_sources and "BSE" in all_sources:
            best.source = "NSE / BSE"
            best.publisher = "NSE / BSE"
            best.provider = "NSE / BSE"
            richer_summary = max((c.summary for c in cluster if c.summary), key=len, default=best.summary)
            if richer_summary and len(richer_summary) > len(best.summary or ""):
                best.summary = richer_summary
            best.item_id = generate_item_id(best.url, best.title, "NSE / BSE", get_canonical_date_str(best.published))

        deduped.append(best)

    # Rank deduplicated items by usefulness & recency
    quality_priority = {"PRIMARY": 1, "HIGH": 2, "SECONDARY": 3, "FALLBACK": 4}

    def dedup_sort_key(x: NewsItem):
        dt = parse_publication_date(x.published)
        ts = -dt.timestamp() if dt is not None else 0.0
        return (
            get_display_priority(x),
            -(x.relevance_score or 0.0),
            ts,
            quality_priority.get(x.source_quality, 99),
            -len(x.summary or ""),
            str(x.published or ""),
        )

    deduped.sort(key=dedup_sort_key)
    return deduped


# ── Canonical Stock News Aggregator with Audit Trail ───────────


_QUOTE_PAGE_RE = re.compile(
    r"(share price|stock price|live nse|live bse|price today|quote and history|stock price, news)", re.I
)


def _search_rss_fetch(
    symbol: str, n: int, provider: str, url: str, quality: str = "SECONDARY"
) -> Tuple[list[NewsItem], int, int]:
    """Shared body for keyless per-company news search feeds (Google News, Bing News)."""
    import requests as _requests

    sym = symbol.upper().strip().replace(".NS", "").replace(".BO", "")
    resp = _requests.get(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                          "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
        },
        timeout=8,
    )
    resp.raise_for_status()
    raw = list(feedparser.parse(resp.text).entries)
    accepted: list[NewsItem] = []
    rejected = 0
    for e in raw:
        title = (e.get("title") or "").strip()
        publisher = (
            (getattr(e, "source", None) or {}).get("title")
            or e.get("news_source")
            or provider
        )
        if publisher and title.endswith(f" - {publisher}"):
            title = title[: -len(f" - {publisher}")].strip()
        if not title or _QUOTE_PAGE_RE.search(title):
            rejected += 1
            continue
        summary = _strip_html(e.get("summary") or "")
        is_rel, score, reason, rel_type, news_type = EntityMatcher.evaluate_relevance_details(
            title=title, summary=summary, symbol=sym, source_name=publisher,
        )
        if not is_rel:
            rejected += 1
            continue
        link = e.get("link") or ""
        if "bing.com/news/apiclick" in link:  # unwrap Bing's tracking redirect
            from urllib.parse import urlparse, parse_qs
            link = (parse_qs(urlparse(link).query).get("url") or [link])[0]
        accepted.append(
            NewsItem(
                title=title, source=publisher, url=link,
                published=get_canonical_date_str(e.get("published")) or datetime.now(timezone.utc).isoformat(),
                summary=summary, provider=provider, publisher=publisher,
                source_quality=quality, relevance_score=score, relevance_reason=reason,
                relevance_type=rel_type, news_type=news_type,
            )
        )
        if len(accepted) >= n:
            break
    return accepted, len(raw), rejected


def _google_news_fetch(symbol: str, n: int = 10) -> Tuple[list[NewsItem], int, int]:
    """Keyless Google News RSS (India edition)."""
    from urllib.parse import quote_plus
    name = _company_query_name(symbol)
    q = f'"{name}" (shares OR stock OR results OR earnings) when:7d'
    url = "https://news.google.com/rss/search?q=" + quote_plus(q) + "&hl=en-IN&gl=IN&ceid=IN:en"
    return _search_rss_fetch(symbol, n, "GoogleNews", url)


def _bing_news_fetch(symbol: str, n: int = 10) -> Tuple[list[NewsItem], int, int]:
    """Keyless Bing News RSS (sorted by date)."""
    from urllib.parse import quote_plus
    name = _company_query_name(symbol)
    q = f'"{name}" (shares OR stock OR results OR earnings OR NSE)'
    url = "https://www.bing.com/news/search?q=" + quote_plus(q) + "&format=rss&setmkt=en-IN&qft=sortbydate%3d%221%22"
    return _search_rss_fetch(symbol, n, "BingNews", url)


def _gdelt_news_fetch(symbol: str, n: int = 10) -> Tuple[list[NewsItem], int, int]:
    """Keyless GDELT DOC API (global news index; slower, so used as an extra source)."""
    import requests as _requests

    sym = symbol.upper().strip().replace(".NS", "").replace(".BO", "")
    name = _company_query_name(sym)
    resp = _requests.get(
        "https://api.gdeltproject.org/api/v2/doc/doc",
        params={
            "query": f'"{name}" (shares OR stock OR results OR earnings) sourcecountry:IN sourcelang:english',
            "mode": "artlist", "format": "json", "maxrecords": 25, "timespan": "7d", "sort": "datedesc",
        },
        headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0.0.0 Safari/537.36"},
        timeout=14,
    )
    resp.raise_for_status()
    try:
        raw = resp.json().get("articles", [])
    except ValueError:  # GDELT returns plain text when rate-limited
        raise RuntimeError(resp.text[:80].strip() or "GDELT non-JSON response")
    accepted: list[NewsItem] = []
    rejected = 0
    for a in raw:
        title = (a.get("title") or "").strip()
        if not title or _QUOTE_PAGE_RE.search(title):
            rejected += 1
            continue
        is_rel, score, reason, rel_type, news_type = EntityMatcher.evaluate_relevance_details(
            title=title, summary="", symbol=sym, source_name=a.get("domain") or "GDELT",
        )
        if not is_rel:
            rejected += 1
            continue
        seen = a.get("seendate") or ""  # 20261002T094500Z
        try:
            published = datetime.strptime(seen, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc).isoformat()
        except ValueError:
            published = datetime.now(timezone.utc).isoformat()
        accepted.append(
            NewsItem(
                title=title, source=a.get("domain") or "GDELT", url=a.get("url") or "",
                published=published, summary="", provider="GDELT",
                publisher=a.get("domain") or "GDELT", source_quality="SECONDARY",
                relevance_score=score, relevance_reason=reason,
                relevance_type=rel_type, news_type=news_type,
            )
        )
        if len(accepted) >= n:
            break
    return accepted, len(raw), rejected


def _get_canonical_stock_news_uncached(symbol: str, n: int = 10) -> Dict[str, Any]:
    """
    Comprehensive, resilient news aggregator with complete source observability.
    Records every provider attempted, status, counts, rejection reasons, and errors.
    Executes providers concurrently via ThreadPoolExecutor for low-latency responses.
    """
    sym = symbol.upper().strip().replace(".NS", "").replace(".BO", "")
    provider_audit: Dict[str, Any] = {}
    all_news: list[NewsItem] = []
    announcements: list[NewsItem] = []

    def _fetch_nse() -> Tuple[list[NewsItem], dict]:
        t0 = time.time()
        try:
            items = get_nse_announcements(sym, n=5)
            lat = round((time.time() - t0) * 1000, 2)
            if items:
                audit = {
                    "status": "PASS",
                    "raw_count": len(items),
                    "relevant_count": len(items),
                    "rejected_count": 0,
                    "rejection_reasons": [],
                    "error": None,
                    "latency_ms": lat,
                }
            else:
                audit = {
                    "status": "EMPTY",
                    "raw_count": 0,
                    "relevant_count": 0,
                    "rejected_count": 0,
                    "rejection_reasons": [],
                    "error": None,
                    "latency_ms": lat,
                }
            return items, audit
        except Exception as e:
            lat = round((time.time() - t0) * 1000, 2)
            return [], {
                "status": "FAILED",
                "raw_count": 0,
                "relevant_count": 0,
                "rejected_count": 0,
                "rejection_reasons": [str(e)],
                "error": str(e),
                "latency_ms": lat,
            }

    def _fetch_bse() -> Tuple[list[NewsItem], dict]:
        t0 = time.time()
        try:
            items = get_bse_filings(sym, n=5)
            lat = round((time.time() - t0) * 1000, 2)
            has_bse = bool(_get_bse_code(sym))
            if items:
                audit = {
                    "status": "PASS",
                    "raw_count": len(items),
                    "relevant_count": len(items),
                    "rejected_count": 0,
                    "rejection_reasons": [],
                    "error": None,
                    "latency_ms": lat,
                }
            else:
                audit = {
                    "status": "EMPTY" if has_bse else "SKIPPED",
                    "raw_count": 0,
                    "relevant_count": 0,
                    "rejected_count": 0,
                    "rejection_reasons": ["No BSE scrip code mapped"] if not has_bse else [],
                    "error": None,
                    "latency_ms": lat,
                }
            return items, audit
        except Exception as e:
            lat = round((time.time() - t0) * 1000, 2)
            return [], {
                "status": "FAILED",
                "raw_count": 0,
                "relevant_count": 0,
                "rejected_count": 0,
                "rejection_reasons": [str(e)],
                "error": str(e),
                "latency_ms": lat,
            }

    def _fetch_newsdata() -> Tuple[list[NewsItem], dict]:
        newsdata_key = os.environ.get("NEWSDATA_API_KEY", "").strip()
        if not newsdata_key:
            return [], {
                "status": "SKIPPED",
                "raw_count": 0,
                "relevant_count": 0,
                "rejected_count": 0,
                "rejection_reasons": ["NEWSDATA_API_KEY not configured"],
                "error": None,
                "latency_ms": 0.0,
            }
        t0 = time.time()
        try:
            nd_items, nd_raw = _newsdata_fetch(sym, newsdata_key, n=n)
            lat = round((time.time() - t0) * 1000, 2)
            rej_count = len(nd_raw) - len(nd_items)
            if nd_items:
                audit = {
                    "status": "PASS",
                    "raw_count": len(nd_raw),
                    "relevant_count": len(nd_items),
                    "rejected_count": rej_count,
                    "rejection_reasons": ["entity_mismatch_or_noise"] if rej_count > 0 else [],
                    "error": None,
                    "latency_ms": lat,
                }
            else:
                audit = {
                    "status": "EMPTY" if len(nd_raw) == 0 else "PASS",
                    "raw_count": len(nd_raw),
                    "relevant_count": 0,
                    "rejected_count": len(nd_raw),
                    "rejection_reasons": ["zero_matching_company_articles"] if nd_raw else ["no_articles_returned"],
                    "error": None,
                    "latency_ms": lat,
                }
            return nd_items, audit
        except Exception as e:
            lat = round((time.time() - t0) * 1000, 2)
            return [], {
                "status": "FAILED",
                "raw_count": 0,
                "relevant_count": 0,
                "rejected_count": 0,
                "rejection_reasons": [str(e)],
                "error": str(e),
                "latency_ms": lat,
            }

    def _fetch_newsapi() -> Tuple[list[NewsItem], dict]:
        newsapi_key = os.environ.get("NEWSAPI_KEY", "").strip() or os.environ.get("NEWS_API_KEY", "").strip()
        if not newsapi_key:
            return [], {
                "status": "SKIPPED",
                "raw_count": 0,
                "relevant_count": 0,
                "rejected_count": 0,
                "rejection_reasons": ["NEWSAPI_KEY not configured"],
                "error": None,
                "latency_ms": 0.0,
            }
        t0 = time.time()
        try:
            na_items, na_raw, na_err = _newsapi_fetch(sym, newsapi_key, n=n)
            lat = round((time.time() - t0) * 1000, 2)
            if na_err:
                audit = {
                    "status": "FAILED",
                    "raw_count": 0,
                    "relevant_count": 0,
                    "rejected_count": 0,
                    "rejection_reasons": [na_err],
                    "error": na_err,
                    "latency_ms": lat,
                }
            elif na_items:
                audit = {
                    "status": "PASS",
                    "raw_count": len(na_raw),
                    "relevant_count": len(na_items),
                    "rejected_count": len(na_raw) - len(na_items),
                    "rejection_reasons": ["entity_mismatch_or_noise"],
                    "error": None,
                    "latency_ms": lat,
                }
            else:
                audit = {
                    "status": "EMPTY",
                    "raw_count": len(na_raw),
                    "relevant_count": 0,
                    "rejected_count": len(na_raw),
                    "rejection_reasons": ["zero_matching_company_articles"],
                    "error": None,
                    "latency_ms": lat,
                }
            return na_items, audit
        except Exception as e:
            lat = round((time.time() - t0) * 1000, 2)
            return [], {
                "status": "FAILED",
                "raw_count": 0,
                "relevant_count": 0,
                "rejected_count": 0,
                "rejection_reasons": [str(e)],
                "error": str(e),
                "latency_ms": lat,
            }

    def _fetch_rss(feed_name: str, feed_url: str) -> Tuple[list[NewsItem], dict]:
        t0 = time.time()
        try:
            rss_raw = get_rss_feed(feed_url, feed_name, n=30)
            lat = round((time.time() - t0) * 1000, 2)
            rss_matched: list[NewsItem] = []
            for item in rss_raw:
                is_rel, score, reason, rel_type, news_type = EntityMatcher.evaluate_relevance_details(
                    title=item.title,
                    summary=item.summary,
                    symbol=sym,
                    source_name=feed_name,
                )
                if is_rel:
                    item.relevance_score = score
                    item.relevance_reason = reason
                    item.relevance_type = rel_type
                    item.news_type = news_type
                    rss_matched.append(item)

            rej_count = len(rss_raw) - len(rss_matched)
            if rss_matched:
                audit = {
                    "status": "PASS",
                    "raw_count": len(rss_raw),
                    "relevant_count": len(rss_matched),
                    "rejected_count": rej_count,
                    "rejection_reasons": ["unrelated_general_market_news"] if rej_count > 0 else [],
                    "error": None,
                    "latency_ms": lat,
                }
            else:
                audit = {
                    "status": "EMPTY",
                    "raw_count": len(rss_raw),
                    "relevant_count": 0,
                    "rejected_count": len(rss_raw),
                    "rejection_reasons": ["no_ticker_mentions_in_current_feed"],
                    "error": None,
                    "latency_ms": lat,
                }
            return rss_matched, audit
        except Exception as e:
            lat = round((time.time() - t0) * 1000, 2)
            return [], {
                "status": "FAILED",
                "raw_count": 0,
                "relevant_count": 0,
                "rejected_count": 0,
                "rejection_reasons": [str(e)],
                "error": str(e),
                "latency_ms": lat,
            }

    def _fetch_yf() -> Tuple[list[NewsItem], dict]:
        t0 = time.time()
        try:
            yf_items, yf_raw_count, yf_rej_count = _yfinance_fetch(sym, n=n)
            lat = round((time.time() - t0) * 1000, 2)
            if yf_items:
                audit = {
                    "status": "PASS",
                    "raw_count": yf_raw_count,
                    "relevant_count": len(yf_items),
                    "rejected_count": yf_rej_count,
                    "rejection_reasons": ["malformed_empty_titles_or_mismatch"] if yf_rej_count > 0 else [],
                    "error": None,
                    "latency_ms": lat,
                }
            else:
                audit = {
                    "status": "EMPTY" if yf_raw_count > 0 else "SKIPPED",
                    "raw_count": yf_raw_count,
                    "relevant_count": 0,
                    "rejected_count": yf_raw_count,
                    "rejection_reasons": ["malformed_empty_titles_rejected"] if yf_raw_count > 0 else ["yfinance_unavailable"],
                    "error": None,
                    "latency_ms": lat,
                }
            return yf_items, audit
        except Exception as e:
            lat = round((time.time() - t0) * 1000, 2)
            return [], {
                "status": "FAILED",
                "raw_count": 0,
                "relevant_count": 0,
                "rejected_count": 0,
                "rejection_reasons": [str(e)],
                "error": str(e),
                "latency_ms": lat,
            }

    # Run all tasks concurrently
    def _make_search_fetcher(fetch_fn):
        def _fetch() -> Tuple[list[NewsItem], dict]:
            t0 = time.time()
            try:
                items, raw_count, rej = fetch_fn(sym, n=n)
                return items, {
                    "status": "PASS" if items else "EMPTY",
                    "raw_count": raw_count, "relevant_count": len(items), "rejected_count": rej,
                    "rejection_reasons": [], "error": None,
                    "latency_ms": round((time.time() - t0) * 1000, 2),
                }
            except Exception as e:
                return [], {
                    "status": "FAILED", "raw_count": 0, "relevant_count": 0, "rejected_count": 0,
                    "rejection_reasons": [str(e)[:120]], "error": str(e)[:200],
                    "latency_ms": round((time.time() - t0) * 1000, 2),
                }
        return _fetch

    _fetch_google = _make_search_fetcher(_google_news_fetch)
    _fetch_bing = _make_search_fetcher(_bing_news_fetch)
    _fetch_gdelt = _make_search_fetcher(_gdelt_news_fetch)

    # Hard overall deadline: one slow/blocked provider must never hang the endpoint.
    _deadline = time.monotonic() + float(os.environ.get("NEWS_PROVIDER_DEADLINE_SEC", "20"))

    def _res(fut):
        try:
            return fut.result(timeout=max(0.1, _deadline - time.monotonic()))
        except Exception as e:  # TimeoutError or provider crash
            return [], {
                "status": "TIMEOUT" if isinstance(e, concurrent.futures.TimeoutError) else "FAILED",
                "raw_count": 0, "relevant_count": 0, "rejected_count": 0,
                "rejection_reasons": [type(e).__name__], "error": str(e) or type(e).__name__,
                "latency_ms": 0,
            }

    executor = concurrent.futures.ThreadPoolExecutor(max_workers=10)
    try:
        f_nse = executor.submit(_fetch_nse)
        f_bse = executor.submit(_fetch_bse)
        f_nd = executor.submit(_fetch_newsdata)
        f_na = executor.submit(_fetch_newsapi)
        rss_futures = {
            feed_name: executor.submit(_fetch_rss, feed_name, feed_url)
            for feed_name, feed_url in RSS_FEEDS.items()
        }
        f_yf = executor.submit(_fetch_yf)
        f_gn = executor.submit(_fetch_google)
        f_bn = executor.submit(_fetch_bing)
        f_gd = executor.submit(_fetch_gdelt) if os.environ.get("NEWS_ENABLE_GDELT") == "1" else None

        # 1. NSE
        nse_items, nse_audit = _res(f_nse)
        if nse_items:
            announcements.extend(nse_items)
        provider_audit["NSE Announcements"] = nse_audit

        # 2. BSE
        bse_items, bse_audit = _res(f_bse)
        if bse_items:
            announcements.extend(bse_items)
        provider_audit["BSE Filings"] = bse_audit

        # 3. NewsData.io
        nd_items, nd_audit = _res(f_nd)
        if nd_items:
            all_news.extend(nd_items)
        provider_audit["NewsData.io"] = nd_audit

        # 4. NewsAPI
        na_items, na_audit = _res(f_na)
        if na_items:
            all_news.extend(na_items)
        provider_audit["NewsAPI"] = na_audit

        # 5. RSS Feeds
        for feed_name in RSS_FEEDS:
            rss_items, rss_audit = _res(rss_futures[feed_name])
            if rss_items:
                all_news.extend(rss_items)
            provider_audit[f"RSS: {feed_name}"] = rss_audit

        # 6. Yahoo Finance
        yf_items, yf_audit = _res(f_yf)
        if yf_items:
            all_news.extend(yf_items)
        provider_audit["Yahoo Finance"] = yf_audit

        # 7. Google News (keyless backup)
        gn_items, gn_audit = _res(f_gn)
        if gn_items:
            all_news.extend(gn_items)
        provider_audit["Google News"] = gn_audit

        # 8. Bing News (keyless, fast, date-sorted)
        bn_items, bn_audit = _res(f_bn)
        if bn_items:
            all_news.extend(bn_items)
        provider_audit["Bing News"] = bn_audit

        # 9. GDELT (keyless, slower; bounded by the shared deadline)
        if f_gd is not None:  # opt-in: GDELT rate-limits hard and is slow (set NEWS_ENABLE_GDELT=1)
            gd_items, gd_audit = _res(f_gd)
            if gd_items:
                all_news.extend(gd_items)
            provider_audit["GDELT"] = gd_audit
    finally:
        executor.shutdown(wait=False, cancel_futures=True)

    # Deduplicate and rank news and announcements with display eligibility gating
    final_news = filter_and_rank_for_display(all_news, symbol=sym, n=n)
    final_announcements = deduplicate_news(announcements, symbol=sym)[:n]

    return {
        "symbol": sym,
        "news": final_news,
        "announcements": final_announcements,
        "provider_audit": provider_audit,
    }


# ── Cached entry point (TTL + stale-on-failure) ───────────────

import threading as _threading

_NEWS_CACHE: Dict[Tuple[str, int], Tuple[float, Dict[str, Any]]] = {}
_NEWS_CACHE_LOCK = _threading.Lock()
_NEWS_LOCKS: Dict[Tuple[str, int], Any] = {}
_NEWS_CACHE_TTL_SEC = float(os.environ.get("NEWS_CACHE_TTL_SEC", "300"))
_NEWS_STALE_MAX_SEC = float(os.environ.get("NEWS_STALE_MAX_SEC", str(6 * 3600)))


def get_canonical_stock_news(symbol: str, n: int = 10) -> Dict[str, Any]:
    """
    Cached wrapper around the multi-provider aggregator.

    - Fresh results are reused for NEWS_CACHE_TTL_SEC (the UI polls every 60s; hammering
      providers is what gets a machine rate-limited).
    - If a refresh comes back empty (providers down/blocked), the last good result is
      served (marked ``stale``) for up to NEWS_STALE_MAX_SEC instead of an empty panel.
    """
    sym = symbol.upper().strip().replace(".NS", "").replace(".BO", "")
    key = (sym, n)
    with _NEWS_CACHE_LOCK:
        lock = _NEWS_LOCKS.setdefault(key, _threading.Lock())
    with lock:  # one in-flight refresh per symbol
        hit = _NEWS_CACHE.get(key)
        now = time.time()
        if hit and now - hit[0] < _NEWS_CACHE_TTL_SEC:
            return hit[1]
        result = _get_canonical_stock_news_uncached(sym, n=n)
        if result.get("news") or result.get("announcements"):
            _NEWS_CACHE[key] = (now, result)
            return result
        if hit and now - hit[0] < _NEWS_STALE_MAX_SEC:
            stale = dict(hit[1])
            stale["stale"] = True
            stale["stale_age_sec"] = int(now - hit[0])
            stale["provider_audit"] = result.get("provider_audit", {})
            return stale
        return result


# ── Backward-Compatible `get_stock_news` ───────────────────────


def get_stock_news(symbol: str, n: int = 10) -> list[NewsItem]:
    """
    Main entry point for stock news fetching across CYRO agents and adapters.
    Returns strictly relevant, deduplicated, provenance-tagged NewsItem objects.
    """
    result = get_canonical_stock_news(symbol, n=n)
    return result["news"]


# ── Fixed Zero-Contamination `_rss_fallback` ──────────────────


def _rss_fallback(symbol: str, n: int = 10) -> list[NewsItem]:
    """
    Strict fallback: scans ET Stocks and Hindu BL feeds for genuine symbol mentions.
    NEVER returns unrelated all_items[:n] when zero company matches exist.
    """
    matched: list[NewsItem] = []
    for source in ["ET Stocks", "Hindu BL", "MoneyControl"]:
        url = RSS_FEEDS.get(source)
        if not url:
            continue
        items = get_rss_feed(url, source, n=30)
        for item in items:
            is_rel, score, reason, rel_type, news_type = EntityMatcher.evaluate_relevance_details(
                title=item.title,
                summary=item.summary,
                symbol=symbol,
                source_name=source,
            )
            if is_rel:
                item.relevance_score = score
                item.relevance_reason = reason
                item.relevance_type = rel_type
                item.news_type = news_type
                matched.append(item)

    return deduplicate_news(matched, symbol=symbol)[:n]


# ── Broad Market News (Macro / Nifty / Sensex) ─────────────────


def get_market_news(n: int = 20) -> list[NewsItem]:
    """
    Broad Indian market headlines from ET Markets, MoneyControl, and LiveMint.
    Returns merged, deduplicated, sorted by recency.
    """
    items: list[NewsItem] = []
    for source in ["ET Markets", "MoneyControl", "LiveMint Markets"]:
        url = RSS_FEEDS.get(source)
        if url:
            items.extend(get_rss_feed(url, source, n=10))

    unique = deduplicate_news(items)
    return unique[:n]

