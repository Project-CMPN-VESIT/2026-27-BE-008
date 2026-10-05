"""
tests/test_news_quality.py
──────────────────────────
Quality stabilization test suite for FinPilot News Engine.

Tests:
1. Deduplication Hierarchy:
   - Level 1: Canonical URL & tracking parameter stripping
   - Level 2: Same publisher & equivalent headline normalization
   - Level 3: Cross-provider syndicated duplicate clustering (Jaccard >= 0.80)
   - Specific regression: Hindu BL CEO succession duplicate pointing to same URL
   - Distinct events on same ticker preserved
2. Multi-tier Relevance & Type Classification:
   - Direct company events (CEO succession, earnings, SEBI Regulation 30) -> DIRECT, score >= 0.95
   - Multi-stock listicle ("Stocks to buy...") -> MENTION_ONLY, score 0.65-0.74
   - Subsidiary exclusions (HDFC Life/AMC, SBI Cards/Life, Tata Motors) -> REJECTED
3. Announcement Title Normalization:
   - "General Updates" with SEBI LODR description -> "Disclosure under Regulation 30"
   - "General Updates" with Press Release quote -> "Press Release: ..."
   - Specific title preserved
   - Generic title with empty description preserved without fabrication
4. Schema & Deterministic item_id:
   - item_id stability and format
   - All provenance fields intact
"""

import pytest
from market.entity_matcher import EntityMatcher
from market.news import (
    NewsItem,
    deduplicate_news,
    normalize_url,
    normalize_headline,
    generate_item_id,
    normalize_announcement_title,
    get_display_priority,
    should_display_news_item,
    filter_and_rank_for_display,
    parse_publication_date,
    get_canonical_date_str,
    filter_stale_news_for_display,
)


# ── 1. Deduplication Tests ────────────────────────────────────


def test_level_1_canonical_url_tracking_params_deduplication():
    """Level 1: Exact canonical URL stripping tracking parameters."""
    url_a = "https://www.thehindubusinessline.com/markets/stock-markets/hdfc-bank-q3-results/article12345.ece?utm_source=rss&utm_medium=feed&fbclid=abc123xyz"
    url_b = "https://thehindubusinessline.com/markets/stock-markets/hdfc-bank-q3-results/article12345.ece?utm_campaign=daily&gclid=test987"
    
    assert normalize_url(url_a) == normalize_url(url_b)

    item_a = NewsItem(
        title="HDFC Bank Q3 profit jumps 33%",
        source="Hindu BL",
        url=url_a,
        published="2026-08-25T10:00:00Z",
        summary="HDFC Bank reported a 33% increase in net profit for Q3.",
        provider="RSS",
        publisher="The Hindu BusinessLine",
        source_quality="HIGH",
        relevance_score=0.95,
        relevance_type="DIRECT",
        news_type="COMPANY",
    )
    item_b = NewsItem(
        title="HDFC Bank reports 33% jump in net profit for Q3",
        source="YahooFinance",
        url=url_b,
        published="2026-08-25T10:05:00Z",
        summary="Detailed Q3 results for HDFC Bank.",
        provider="YahooFinance",
        publisher="The Hindu BusinessLine",
        source_quality="HIGH",
        relevance_score=0.95,
        relevance_type="DIRECT",
        news_type="COMPANY",
    )

    deduped = deduplicate_news([item_a, item_b], symbol="HDFCBANK")
    assert len(deduped) == 1
    assert deduped[0].relevance_type == "DIRECT"


def test_level_1_hindu_businessline_same_article_duplicate():
    """Regression test for Hindu BusinessLine duplicate headlines pointing to identical URL."""
    same_url = "https://www.thehindubusinessline.com/money-and-banking/indias-hdfc-bank-ceo-not-seeking-reappointment-to-retire-in-october/article71404683.ece"

    item_1 = NewsItem(
        title="Sashidhar Jagdishan not to seek third term as HDFC Bank chief",
        source="Hindu BL",
        url=same_url,
        published="2026-08-25T11:00:00Z",
        summary="Sashidhar Jagdishan will step down as MD and CEO in October.",
        provider="RSS",
        publisher="The Hindu BusinessLine",
        source_quality="HIGH",
        relevance_score=0.98,
        relevance_type="DIRECT",
        news_type="MANAGEMENT",
    )
    item_2 = NewsItem(
        title="Bank board to fast-track process for selection and appointment of his successor",
        source="YahooFinance",
        url=same_url,
        published="2026-08-25T11:02:00Z",
        summary="The board has initiated the succession committee meeting.",
        provider="YahooFinance",
        publisher="The Hindu BusinessLine",
        source_quality="HIGH",
        relevance_score=0.88,
        relevance_type="DIRECT",
        news_type="MANAGEMENT",
    )

    deduped = deduplicate_news([item_1, item_2], symbol="HDFCBANK")
    assert len(deduped) == 1
    # Must pick the clearer primary title with higher relevance score
    assert "Sashidhar Jagdishan" in deduped[0].title
    assert deduped[0].relevance_score == 0.98


def test_level_2_same_publisher_equivalent_headline():
    """Level 2: Same publisher and equivalent normalized headline."""
    item_a = NewsItem(
        title="Infosys signs $1.5 billion mega deal with global telecom major - The Economic Times",
        source="ET Stocks",
        url="https://economictimes.indiatimes.com/tech/ites/infosys-mega-deal-1",
        published="2026-08-26T08:00:00Z",
        summary="Infosys has announced a $1.5 billion 5-year digital transformation deal.",
        provider="RSS",
        publisher="Economic Times",
        source_quality="HIGH",
        relevance_score=0.95,
    )
    item_b = NewsItem(
        title="Infosys signs $1.5 billion mega deal with global telecom major",
        source="ET Markets",
        url="https://economictimes.indiatimes.com/markets/stocks/news/infosys-mega-deal-2",
        published="2026-08-26T08:15:00Z",
        summary="Infosys announces deal with global telecom major.",
        provider="RSS",
        publisher="Economic Times",
        source_quality="HIGH",
        relevance_score=0.95,
    )

    deduped = deduplicate_news([item_a, item_b], symbol="INFY")
    assert len(deduped) == 1
    assert "Infosys signs $1.5 billion" in deduped[0].title


def test_level_3_cross_provider_syndicated_duplicates():
    """Level 3: Same story from different syndicators on same day (Jaccard >= 0.80)."""
    item_a = NewsItem(
        title="TCS and Porsche partner to accelerate AI-powered mobility solutions",
        source="NewsData",
        url="https://newsdata.io/article/tcs-porsche-1",
        published="2026-08-27T09:00:00Z",
        summary="Tata Consultancy Services has expanded its global partnership with Porsche AG.",
        provider="NewsData",
        publisher="PTI Syndicated",
        source_quality="SECONDARY",
        relevance_score=0.92,
        relevance_type="DIRECT",
        news_type="PARTNERSHIP",
    )
    item_b = NewsItem(
        title="TCS and Porsche partner to accelerate AI powered mobility",
        source="Business Standard",
        url="https://business-standard.com/companies/news/tcs-porsche-mobility",
        published="2026-08-27T09:30:00Z",
        summary="TCS announced a strategic AI collaboration with Porsche AG.",
        provider="RSS",
        publisher="Business Standard",
        source_quality="HIGH",
        relevance_score=0.92,
        relevance_type="DIRECT",
        news_type="PARTNERSHIP",
    )

    deduped = deduplicate_news([item_a, item_b], symbol="TCS")
    assert len(deduped) == 1
    # Higher source quality (Business Standard / HIGH) should survive over SECONDARY
    assert deduped[0].source_quality == "HIGH"
    assert deduped[0].provider == "RSS"


def test_distinct_events_on_same_ticker_never_collapsed():
    """Distinct events on the same company must NOT be deduplicated."""
    item_1 = NewsItem(
        title="TCS signs $500M contract with British retailer",
        source="LiveMint",
        url="https://livemint.com/tcs-contract",
        published="2026-08-28T09:00:00Z",
        summary="TCS bagged a half-billion dollar contract.",
        provider="RSS",
        publisher="LiveMint",
        source_quality="HIGH",
        relevance_score=0.95,
        relevance_type="DIRECT",
        news_type="COMPANY",
    )
    item_2 = NewsItem(
        title="TCS declares interim dividend of Rs 28 per share",
        source="NSE",
        url="https://nseindia.com/announcement/tcs-dividend",
        published="2026-08-28T10:00:00Z",
        summary="Interim dividend announcement for Q3.",
        provider="NSE",
        publisher="NSE",
        source_quality="PRIMARY",
        relevance_score=1.0,
        relevance_type="DIRECT",
        news_type="CORPORATE_ACTION",
    )

    deduped = deduplicate_news([item_1, item_2], symbol="TCS")
    assert len(deduped) == 2


# ── 2. Relevance Scoring & Typing Tests ─────────────────────────


def test_direct_company_event_classification():
    """Direct company events receive high score (>=0.95) and DIRECT relevance_type."""
    # Management change
    is_rel, score, reason, rel_type, news_type = EntityMatcher.evaluate_relevance_details(
        title="Sashidhar Jagdishan not to seek reappointment as HDFC Bank MD & CEO",
        summary="He will retire in October 2026.",
        symbol="HDFCBANK",
    )
    assert is_rel is True
    assert score >= 0.95
    assert rel_type == "DIRECT"
    assert news_type == "MANAGEMENT"

    # Earnings
    is_rel, score, reason, rel_type, news_type = EntityMatcher.evaluate_relevance_details(
        title="TCS Q3 net profit jumps 12% to Rs 12,400 crore",
        summary="Operating margins expand to 26.2%.",
        symbol="TCS",
    )
    assert is_rel is True
    assert score >= 0.95
    assert rel_type == "DIRECT"
    assert news_type == "COMPANY"


def test_multi_stock_roundup_classification():
    """Multi-stock buy/sell listicle classified as MENTION_ONLY with score 0.65–0.74."""
    is_rel, score, reason, rel_type, news_type = EntityMatcher.evaluate_relevance_details(
        title="Stocks to buy today: TCS, M&M, HDFC Bank among top analyst picks",
        summary="Brokerages recommend buying HDFC Bank for a target of 1850.",
        symbol="HDFCBANK",
    )
    assert is_rel is True
    assert 0.65 <= score <= 0.74
    assert rel_type == "MENTION_ONLY"
    assert news_type == "MARKET"


def test_sector_industry_classification():
    """Broader industry article classified as INDIRECT / INDUSTRY."""
    is_rel, score, reason, rel_type, news_type = EntityMatcher.evaluate_relevance_details(
        title="Nifty IT index rallies 3% led by TCS and Infosys gains",
        summary="Indian IT sector shows strong recovery momentum.",
        symbol="INFY",
    )
    assert is_rel is True
    assert 0.75 <= score <= 0.84
    assert rel_type == "INDIRECT"
    assert news_type == "INDUSTRY"


def test_subsidiary_negative_exclusion_rules():
    """Subsidiaries must be filtered out without leaking to parent ticker."""
    # HDFC Life -> HDFCBANK
    is_rel, score, _, _, _ = EntityMatcher.evaluate_relevance_details(
        title="HDFC Life Insurance reports 18% growth in value of new business",
        summary="HDFC Life Q3 financial performance review.",
        symbol="HDFCBANK",
    )
    assert is_rel is False
    assert score == 0.0

    # SBI Cards -> SBIN
    is_rel, score, _, _, _ = EntityMatcher.evaluate_relevance_details(
        title="SBI Cards net profit jumps 15% to Rs 600 crore",
        summary="Cardholder spends up 22%.",
        symbol="SBIN",
    )
    assert is_rel is False
    assert score == 0.0

    # Tata Motors -> TCS
    is_rel, score, _, _, _ = EntityMatcher.evaluate_relevance_details(
        title="Tata Motors global wholesales rise 12% in Q3",
        summary="Commercial vehicles segment drives growth.",
        symbol="TCS",
    )
    assert is_rel is False
    assert score == 0.0


# ── 3. Announcement Title Normalization Tests ─────────────────


def test_announcement_title_normalization_regulation_30():
    """Derive descriptive title for Regulation 30 disclosures from summary."""
    raw_title = "General Updates"
    summary = "HDFC Bank Limited has informed the Exchange regarding Disclosure under Regulation 30 and other applicable regulations of the SEBI (Listing Obligations and Disclosure Requirements) Regulations, 2015"
    
    clean = normalize_announcement_title(raw_title, summary, symbol="HDFCBANK")
    assert clean == "Disclosure under Regulation 30 and other applicable regulations"
    assert "General Updates" not in clean


def test_announcement_title_normalization_press_release():
    """Extract quoted press release title from summary."""
    raw_title = "General Updates"
    summary = 'Tata Consultancy Services Limited has informed the Exchange regarding a press release dated August 24, 2026, titled "TCS and Porsche AG Partner to Accelerate the Future of AI-Powered Mobility".'
    
    clean = normalize_announcement_title(raw_title, summary, symbol="TCS")
    assert clean == "Press Release: TCS and Porsche AG Partner to Accelerate the Future of AI-Powered Mobility"


def test_announcement_title_normalization_specific_preserved():
    """Specific titles like 'Credit Rating' or 'Allotment of Equity Shares' are preserved."""
    assert normalize_announcement_title("Credit Rating", "Details of ICRA rating") == "Credit Rating"
    assert normalize_announcement_title("Allotment of Securities", "ESOP exercise") == "Allotment of Securities"


def test_announcement_title_no_fabrication_on_empty():
    """Generic title with empty summary is preserved without fabricating facts."""
    assert normalize_announcement_title("General Updates", "") == "General Updates"


# ── 4. Item ID & Provenance Tests ───────────────────────────────


def test_deterministic_item_id_stability():
    """item_id must be deterministic and identical across repeated evaluations."""
    url = "https://economictimes.indiatimes.com/markets/stocks/news/tcs-q3-results/123.cms?utm_source=feed"
    id1 = generate_item_id(url, "TCS Q3 Results Announced", "Economic Times", "2026-08-25")
    id2 = generate_item_id(url, "TCS Q3 Results Announced", "Economic Times", "2026-08-25")
    
    assert id1 == id2
    assert id1.startswith("news_")
    assert len(id1) == 21  # "news_" (5) + 16 hex chars


def test_news_item_dictionary_contract():
    """NewsItem dictionary serialization must retain all existing and new fields."""
    item = NewsItem(
        title="Infosys announces leadership changes",
        source="BSE",
        url="https://bseindia.com/filing/123",
        published="2026-08-29T10:00:00Z",
        summary="Appointment of Senior VP.",
        provider="BSE",
        publisher="BSE",
        source_quality="PRIMARY",
        relevance_score=1.0,
        relevance_reason="Official BSE corporate filing",
        relevance_type="DIRECT",
        news_type="MANAGEMENT",
    )
    d = item.to_dict()

    required_keys = [
        "title", "source", "url", "published", "published_at", "summary",
        "provider", "publisher", "source_quality", "relevance_score",
        "relevance_reason", "relevance_type", "news_type", "item_id"
    ]
    for key in required_keys:
        assert key in d, f"Missing key {key} in NewsItem dictionary"
    assert d["relevance_type"] == "DIRECT"
    assert d["news_type"] == "MANAGEMENT"
    assert d["item_id"].startswith("news_")


# ── 5. Usefulness Ranking & Display Eligibility Tests ─────────


def test_direct_company_article_outranks_listicle():
    """Direct company article must outrank multi-stock listicle."""
    listicle = NewsItem(
        title="Stocks To Buy or Sell Today: TCS, Mahindra & Mahindra and Dixon Tech",
        source="LiveMint",
        url="https://livemint.com/stocks-to-buy-today-1",
        published="2026-08-29T10:00:00Z",
        summary="Technical analysis on TCS, Mahindra and Dixon.",
        provider="RSS",
        publisher="LiveMint",
        source_quality="HIGH",
        relevance_score=0.70,
        relevance_type="MENTION_ONLY",
        news_type="MARKET",
    )
    direct_mgmt = NewsItem(
        title="Sashidhar Jagdishan not to seek third term as HDFC Bank chief",
        source="Hindu BL",
        url="https://thehindubusinessline.com/hdfc-ceo-retires",
        published="2026-08-29T09:00:00Z",
        summary="HDFC Bank CEO retirement announced.",
        provider="RSS",
        publisher="The Hindu BusinessLine",
        source_quality="HIGH",
        relevance_score=0.98,
        relevance_type="DIRECT",
        news_type="MANAGEMENT",
    )
    direct_results = NewsItem(
        title="India's HDFC Bank slips to 2-1/2-year low as legal, leadership woes linger",
        source="Reuters",
        url="https://reuters.com/hdfc-bank-woes",
        published="2026-08-29T08:00:00Z",
        summary="HDFC Bank stock drops on legal and leadership questions.",
        provider="YahooFinance",
        publisher="Reuters",
        source_quality="HIGH",
        relevance_score=0.98,
        relevance_type="DIRECT",
        news_type="MANAGEMENT",
    )

    ranked = filter_and_rank_for_display([listicle, direct_mgmt, direct_results], symbol="HDFCBANK")
    # Listicle should be completely suppressed because 2 direct items exist
    assert len(ranked) == 2
    assert "Sashidhar Jagdishan" in ranked[0].title or "Sashidhar Jagdishan" in ranked[1].title
    assert all("Stocks To Buy" not in item.title for item in ranked)


def test_ceo_management_event_outranks_market_roundup():
    """CEO/Leadership event (P0) strictly outranks market roundup (P4/P5)."""
    roundup = NewsItem(
        title="Market wrap: TCS, Tech Mahindra, ICICI Bank, ITC top gainers and losers",
        source="ET",
        url="https://economictimes.com/market-wrap-1",
        published="2026-08-29T16:00:00Z",
        summary="Nifty ends flat.",
        provider="RSS",
        publisher="Economic Times",
        source_quality="HIGH",
        relevance_score=0.70,
        relevance_type="MENTION_ONLY",
        news_type="MARKET",
    )
    mgmt = NewsItem(
        title="Infosys appoints Mitrankur Majumdar as Senior Management Personnel",
        source="BSE",
        url="https://bseindia.com/infy-mgmt",
        published="2026-08-24T10:00:00Z",
        summary="Executive appointment.",
        provider="BSE",
        publisher="BSE",
        source_quality="PRIMARY",
        relevance_score=0.98,
        relevance_type="DIRECT",
        news_type="MANAGEMENT",
    )

    ranked = filter_and_rank_for_display([roundup, mgmt], symbol="INFY")
    assert ranked[0].title == "Infosys appoints Mitrankur Majumdar as Senior Management Personnel"


def test_regulatory_filing_outranks_market_commentary():
    """Regulatory filing / SEBI Lodr (P0) outranks general market commentary."""
    commentary = NewsItem(
        title="IT shares rally on Nasdaq cues",
        source="NewsData",
        url="https://newsdata.io/it-rally",
        published="2026-08-29T10:00:00Z",
        summary="IT index moves up.",
        provider="NewsData",
        publisher="NewsData",
        source_quality="SECONDARY",
        relevance_score=0.75,
        relevance_type="INDIRECT",
        news_type="INDUSTRY",
    )
    filing = NewsItem(
        title="Disclosure under Regulation 30 - Acquisition of MHP Consulting",
        source="NSE",
        url="https://nseindia.com/tcs-mhp",
        published="2026-08-24T10:00:00Z",
        summary="TCS acquires MHP.",
        provider="NSE",
        publisher="NSE",
        source_quality="PRIMARY",
        relevance_score=0.96,
        relevance_type="DIRECT",
        news_type="REGULATORY",
    )

    ranked = filter_and_rank_for_display([commentary, filing], symbol="TCS")
    assert ranked[0].news_type == "REGULATORY"
    assert ranked[0].relevance_type == "DIRECT"


def test_incidental_macro_mention_suppression():
    """Macro/enterprise user mention (e.g. Microsoft data center) is suppressed when direct news exists."""
    macro_mention = NewsItem(
        title="Microsoft opens its largest India data center hub as AI race heats up",
        source="Reuters",
        url="https://reuters.com/microsoft-data-center",
        published="2026-08-29T10:00:00Z",
        summary="Microsoft expands Hyderabad campus; major clients include HDFC Bank and Infosys.",
        provider="YahooFinance",
        publisher="Reuters",
        source_quality="HIGH",
        relevance_score=0.68,
        relevance_type="MENTION_ONLY",
        news_type="INDUSTRY",
    )
    direct_a = NewsItem(
        title="Sashidhar Jagdishan not to seek third term as HDFC Bank chief",
        source="Hindu BL",
        url="https://thehindubusinessline.com/hdfc-ceo",
        published="2026-08-29T09:00:00Z",
        summary="Leadership transition.",
        provider="RSS",
        publisher="The Hindu BusinessLine",
        source_quality="HIGH",
        relevance_score=0.98,
        relevance_type="DIRECT",
        news_type="MANAGEMENT",
    )
    direct_b = NewsItem(
        title="Buy HDFC Bank; target of Rs 1,850: ICICI Securities",
        source="Moneycontrol",
        url="https://moneycontrol.com/hdfc-target",
        published="2026-08-29T08:00:00Z",
        summary="Brokerage initiates coverage.",
        provider="RSS",
        publisher="MoneyControl",
        source_quality="HIGH",
        relevance_score=0.90,
        relevance_type="DIRECT",
        news_type="ANALYST",
    )

    ranked = filter_and_rank_for_display([macro_mention, direct_a, direct_b], symbol="HDFCBANK")
    assert len(ranked) == 2
    assert all("Microsoft opens" not in item.title for item in ranked)


# ── 6. Date Parsing & Display Freshness Tests ─────────────────


def test_iso_date_parsing():
    """Validates ISO 8601 parsing."""
    dt = parse_publication_date("2026-08-29T17:50:11.913")
    assert dt is not None
    assert dt.year == 2026 and dt.month == 8 and dt.day == 29

    dt_z = parse_publication_date("2026-08-29T17:50:11Z")
    assert dt_z is not None
    assert dt_z.year == 2026 and dt_z.month == 8 and dt_z.day == 29


def test_rfc2822_date_parsing():
    """Validates RFC 2822 parsing (e.g. from Moneycontrol RSS)."""
    dt = parse_publication_date("23 Apr 2024 08:11:02 +0000")
    assert dt is not None
    assert dt.year == 2024 and dt.month == 4 and dt.day == 23

    dt2 = parse_publication_date("Sun, 29 Aug 2026 17:46:11 GMT")
    assert dt2 is not None
    assert dt2.year == 2026 and dt2.month == 8 and dt2.day == 29


def test_nse_date_parsing():
    """Validates NSE format: DD-Mon-YYYY HH:MM:SS."""
    dt = parse_publication_date("29-Aug-2026 17:46:11")
    assert dt is not None
    assert dt.year == 2026 and dt.month == 8 and dt.day == 29
    assert dt.hour == 17 and dt.minute == 46 and dt.second == 11
    assert get_canonical_date_str("29-Aug-2026 17:46:11") == "2026-08-29"


def test_stale_article_suppression_when_recent_news_exists():
    """Stale 2024 article is suppressed when August 2026 news is available."""
    stale_item = NewsItem(
        title="Buy HDFC Bank; target of Rs 1,850: ICICI Securities",
        source="MoneyControl",
        url="https://moneycontrol.com/buy-hdfc-2024",
        published="2024-04-23T08:11:02+00:00",
        summary="Target 1850 recommendation from April 2024.",
        provider="RSS",
        publisher="MoneyControl",
        source_quality="FALLBACK",
        relevance_score=0.90,
        relevance_type="DIRECT",
        news_type="ANALYST",
    )
    recent_item_1 = NewsItem(
        title="India's HDFC Bank slips to 2-1/2-year low as legal, leadership woes linger",
        source="Reuters",
        url="https://reuters.com/hdfc-bank-woes-2026",
        published="2026-08-27T10:44:12Z",
        summary="HDFC Bank stock drops on leadership questions.",
        provider="YahooFinance",
        publisher="Reuters",
        source_quality="HIGH",
        relevance_score=0.98,
        relevance_type="DIRECT",
        news_type="MANAGEMENT",
    )
    recent_item_2 = NewsItem(
        title="Sashidhar Jagdishan not to seek third term as HDFC Bank chief",
        source="Hindu BL",
        url="https://thehindubusinessline.com/hdfc-ceo-2026",
        published="2026-08-29T13:37:14+00:00",
        summary="HDFC Bank CEO retirement.",
        provider="RSS",
        publisher="The Hindu BusinessLine",
        source_quality="HIGH",
        relevance_score=0.98,
        relevance_type="DIRECT",
        news_type="MANAGEMENT",
    )

    # 1. User display filter suppresses stale item
    visible = filter_and_rank_for_display([stale_item, recent_item_1, recent_item_2], symbol="HDFCBANK")
    assert len(visible) == 2
    assert all("2024" not in (x.published or "") for x in visible)
    assert all("ICICI Securities" not in x.title for x in visible)

    # 2. Evidence layer retains all historical items
    evidence_candidates = deduplicate_news([stale_item, recent_item_1, recent_item_2], symbol="HDFCBANK")
    assert len(evidence_candidates) == 3


def test_nse_and_bse_regulation_30_same_day_duplicate_merging():
    """Identical Regulation 30 filing from NSE and BSE on the same day collapses into one consolidated event with 'NSE / BSE' provenance."""
    nse_ann = NewsItem(
        title="Disclosure under Regulation 30 and other applicable regulations",
        source="NSE",
        url="https://nseindia.com/ann/123",
        published="29-Aug-2026 17:46:11",
        summary="HDFC Bank Limited has informed the Exchange regarding Disclosure under Regulation 30.",
        provider="NSE",
        publisher="NSE",
        source_quality="PRIMARY",
        relevance_score=1.0,
        relevance_type="DIRECT",
        news_type="REGULATORY",
    )
    bse_ann = NewsItem(
        title="Disclosure under Regulation 30 and other applicable regulations of the SEBI (Listing Obligations and Disclosure Requirements) Regulations, 2015",
        source="BSE",
        url="https://bseindia.com/ann/456",
        published="2026-08-29T17:50:11.913",
        summary="HDFC Bank Ltd: Disclosure under Regulation 30 and other applicable regulations of the SEBI (Listing Obligations and Disclosure Requirements) Regulations, 2015. Detailed text enclosed.",
        provider="BSE",
        publisher="BSE",
        source_quality="PRIMARY",
        relevance_score=1.0,
        relevance_type="DIRECT",
        news_type="REGULATORY",
    )

    deduped = deduplicate_news([nse_ann, bse_ann], symbol="HDFCBANK")
    assert len(deduped) == 1
    merged = deduped[0]
    assert merged.source == "NSE / BSE"
    assert merged.publisher == "NSE / BSE"
    assert "Detailed text enclosed" in merged.summary
    assert merged.item_id.startswith("news_")


def test_nse_credit_rating_and_bse_intimation_merging():
    """NSE 'Credit Rating' and BSE 'Intimation of credit rating' on same day merge cleanly."""
    nse_rating = NewsItem(
        title="Credit Rating",
        source="NSE",
        url="https://nseindia.com/rating/1",
        published="20-Aug-2026 17:16:08",
        summary="HDFC Bank Limited has informed the Exchange about Credit Rating.",
        provider="NSE",
        publisher="NSE",
        source_quality="PRIMARY",
        relevance_score=1.0,
        relevance_type="DIRECT",
        news_type="REGULATORY",
    )
    bse_rating = NewsItem(
        title="Intimation of credit rating",
        source="BSE",
        url="https://bseindia.com/rating/2",
        published="2026-08-20T17:16:49.087",
        summary="HDFC Bank Ltd: Intimation of credit rating by CRISIL / CARE Ratings Limited with detailed rating report enclosed.",
        provider="BSE",
        publisher="BSE",
        source_quality="PRIMARY",
        relevance_score=1.0,
        relevance_type="DIRECT",
        news_type="REGULATORY",
    )

    deduped = deduplicate_news([nse_rating, bse_rating], symbol="HDFCBANK")
    assert len(deduped) == 1
    assert deduped[0].source == "NSE / BSE"
    assert "CRISIL" in deduped[0].summary


def test_different_same_day_announcements_remain_separate():
    """Genuinely distinct corporate announcements on the same day are never collapsed."""
    ann_1 = NewsItem(
        title="Outcome of Board Meeting",
        source="NSE",
        url="https://nseindia.com/bm",
        published="20-Aug-2026 14:00:00",
        summary="Board approved fundraising.",
        provider="NSE",
        publisher="NSE",
        source_quality="PRIMARY",
        relevance_score=1.0,
        relevance_type="DIRECT",
        news_type="CORPORATE_ACTION",
    )
    ann_2 = NewsItem(
        title="Credit Rating",
        source="NSE",
        url="https://nseindia.com/cr",
        published="20-Aug-2026 17:16:08",
        summary="Credit rating reaffirmed.",
        provider="NSE",
        publisher="NSE",
        source_quality="PRIMARY",
        relevance_score=1.0,
        relevance_type="DIRECT",
        news_type="REGULATORY",
    )

    deduped = deduplicate_news([ann_1, ann_2], symbol="HDFCBANK")
    assert len(deduped) == 2


# ── 7. Corporate vs Employee Incidental Stories Tests ─────────


def test_employee_personal_incident_suppression():
    """Individual employee personal accidents/crimes are classified as MENTION_ONLY/INCIDENTAL and suppressed."""
    title = "TCS techie on way home dies after reversing JCB rams his bike in Gurgaon"
    rel_t, news_t, score = EntityMatcher.classify_news_type_and_directness(title, matched_in_title=True)
    assert rel_t == "MENTION_ONLY"
    assert news_t == "INCIDENTAL"
    assert score == 0.50

    item = NewsItem(
        title=title,
        source="TOI",
        url="https://timesofindia.indiatimes.com/tcs-techie-dies",
        published="2026-08-29T03:57:35Z",
        summary="A 27-year-old systems engineer died after a reversing earthmover struck his motorcycle.",
        provider="RSS",
        publisher="The Times Of India",
        source_quality="HIGH",
        relevance_score=score,
        relevance_type=rel_t,
        news_type=news_t,
    )
    assert should_display_news_item(item, symbol="TCS") is False
    assert get_display_priority(item) == 5


def test_employee_incident_syndicated_deduplication():
    """Variant headlines of the same employee incident merge and are suppressed."""
    item1 = NewsItem(
        title="TCS techie on way home dies after reversing JCB rams his bike in Gurgaon",
        source="TOI",
        url="https://timesofindia.indiatimes.com/tcs-techie-dies-1",
        published="2026-08-29T03:57:35Z",
        summary="Accident details.",
        provider="RSS",
        publisher="The Times Of India",
        source_quality="HIGH",
        relevance_score=0.50,
        relevance_type="MENTION_ONLY",
        news_type="INCIDENTAL",
    )
    item2 = NewsItem(
        title="TCS techie on way home dies after reversing JCB rams his bike in Gurgaon - The Times of India",
        source="Google News",
        url="https://news.google.com/articles/CBMi6gFBVV...",
        published="2026-08-29T03:57:00Z",
        summary="Accident mirror.",
        provider="RSS",
        publisher="Google News",
        source_quality="FALLBACK",
        relevance_score=0.50,
        relevance_type="MENTION_ONLY",
        news_type="INCIDENTAL",
    )
    item3 = NewsItem(
        title="TCS engineer on way home dies after reversing earthmover rams bike",
        source="TOI",
        url="https://timesofindia.indiatimes.com/tcs-engineer-dies-2",
        published="2026-08-29T04:00:00Z",
        summary="Accident details 2.",
        provider="RSS",
        publisher="The Times Of India",
        source_quality="HIGH",
        relevance_score=0.50,
        relevance_type="MENTION_ONLY",
        news_type="INCIDENTAL",
    )

    deduped = deduplicate_news([item1, item2, item3], symbol="TCS")
    assert len(deduped) == 1
    ranked = filter_and_rank_for_display(deduped, symbol="TCS")
    assert len(ranked) == 0


def test_corporate_contract_and_acquisition_events_retained():
    """Commercial contracts, LOIs, acquisitions, and compensation policies are retained as DIRECT corporate events."""
    # 1. LOI / Contract
    loi_title = "Tejas Networks shares zoom 13% after TCS’s Rs 1,537-crore LOI for BSNL 4G rollout"
    rel_t, news_t, score = EntityMatcher.classify_news_type_and_directness(loi_title, matched_in_title=True)
    assert rel_t == "DIRECT"
    assert score >= 0.90

    # 2. Acquisition
    acq_title = "Porsche sharpens focus on core business with MHP sale to India’s TCS"
    rel_t, news_t, score = EntityMatcher.classify_news_type_and_directness(acq_title, matched_in_title=True)
    assert rel_t == "DIRECT"
    assert score >= 0.85

    # 3. Corporate compensation policy
    comp_title = "TCS Q1 variable pay: Mid, senior employees get 60-70% while juniors receive full payout, says report"
    rel_t, news_t, score = EntityMatcher.classify_news_type_and_directness(comp_title, matched_in_title=True)
    assert rel_t == "DIRECT"
    assert score >= 0.85

    # 4. Cybersecurity incident response
    sec_title = "India's TCS says received alerts alleging exposure of some employee data"
    rel_t, news_t, score = EntityMatcher.classify_news_type_and_directness(sec_title, matched_in_title=True)
    assert rel_t == "DIRECT"
    assert score >= 0.85


def test_syndicated_acquisition_event_merging():
    """Multiple publisher reports on the same underlying Porsche MHP acquisition merge into one canonical card."""
    item1 = NewsItem(
        title="Porsche sharpens focus on core business with MHP sale to India’s TCS",
        source="Just Auto",
        url="https://just-auto.com/porsche-mhp-tcs",
        published="2026-08-25T18:02:45Z",
        summary="TCS subsidiary acquires full ownership of MHP Management- und IT-Beratung.",
        provider="YahooFinance",
        publisher="Just Auto",
        source_quality="HIGH",
        relevance_score=0.95,
        relevance_type="DIRECT",
        news_type="COMPANY",
    )
    item2 = NewsItem(
        title="Porsche sells MHP consulting unit to TCS in $1.5 billion AI deal",
        source="Quartz",
        url="https://qz.com/porsche-mhp-tcs-ai",
        published="2026-08-25T12:54:25Z",
        summary="TCS will acquire MHP for 320 million euros and establish AI Mobility Centre.",
        provider="YahooFinance",
        publisher="Quartz",
        source_quality="HIGH",
        relevance_score=0.95,
        relevance_type="DIRECT",
        news_type="COMPANY",
    )
    item3 = NewsItem(
        title="Porsche Sells MHP to TCS as Companies Deepen Partnership on AI and Digital Transformation",
        source="NamasteCar",
        url="https://namastecar.com/porsche-sells-mhp-tcs",
        published="2026-08-25T14:36:47Z",
        summary="Porsche AG and TCS sign agreement.",
        provider="RSS",
        publisher="NamasteCar",
        source_quality="FALLBACK",
        relevance_score=0.95,
        relevance_type="DIRECT",
        news_type="COMPANY",
    )

    deduped = deduplicate_news([item1, item2, item3], symbol="TCS")
    assert len(deduped) == 1
    assert deduped[0].relevance_type == "DIRECT"
    assert get_display_priority(deduped[0]) <= 1


def test_generic_employee_incident_across_other_tickers():
    """Rules work generically for INFY, WIPRO, HDFCBANK without hardcoded ticker rules."""
    infy_crime = "Infosys techie arrested by Bengaluru police in cyber fraud case"
    rel_t, news_t, score = EntityMatcher.classify_news_type_and_directness(infy_crime, matched_in_title=True)
    assert rel_t == "MENTION_ONLY"
    assert news_t == "INCIDENTAL"
    assert score == 0.50

    wipro_accident = "Wipro engineer killed after speeding truck rams car on highway"
    rel_t, news_t, score = EntityMatcher.classify_news_type_and_directness(wipro_accident, matched_in_title=True)
    assert rel_t == "MENTION_ONLY"
    assert news_t == "INCIDENTAL"
    assert score == 0.50

    hdfc_fraud = "HDFC Bank employee booked for siphoning off funds in personal account"
    rel_t, news_t, score = EntityMatcher.classify_news_type_and_directness(hdfc_fraud, matched_in_title=True)
    assert rel_t == "MENTION_ONLY"
    assert news_t == "INCIDENTAL"
    assert score == 0.50



