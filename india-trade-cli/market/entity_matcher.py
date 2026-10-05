"""
market/entity_matcher.py
────────────────────────
Generic, high-precision company and ticker entity disambiguation engine.
Works universally for ANY stock in the Indian market (NSE & BSE).

Key capabilities:
1. Dynamic token and alias derivation from company name and ticker symbol.
2. Word-boundary regex matching to prevent false substring hits (e.g. "TCS" in "catch" or "watches").
3. Suffix normalization (stripping "Ltd", "Limited", "Corp", "Industries", "Bank", "Pvt").
4. Disambiguation negative guards (preventing conglomerate cross-contamination, e.g. HDFC Life -> HDFC Bank,
   SBI Card -> SBIN, Tata Motors -> TCS).
5. Comprehensive relevance scoring (0.0 to 1.0) with explicit explanation for audit trails.
"""

from __future__ import annotations

import re
from typing import Dict, List, Optional, Set, Tuple


# Known conglomerate sibling negative rules to prevent cross-subsidiary leakage.
# Key: Ticker Symbol (uppercase) -> Disambiguation rule config
_SUBSIDIARY_DISAMBIGUATION: Dict[str, Dict[str, Any]] = {
    "HDFCBANK": {
        "positive_must_have": [r"\bHDFC\s*BANK\b", r"\bHDFCBANK\b", r"\bHOUSING DEVELOPMENT FINANCE CORPORATION BANK\b"],
        "negative_exclude_if_standalone": [
            r"\bHDFC\s*LIFE\b",
            r"\bHDFC\s*AMC\b",
            r"\bHDFC\s*ASSET\s*MANAGEMENT\b",
            r"\bHDFC\s*MUTUAL\s*FUND\b",
            r"\bHDFC\s*ERGO\b",
            r"\bHDFC\s*SECURITIES\b",
            r"\bHDFC\s*STANDARD\b",
        ],
    },
    "SBIN": {
        "positive_must_have": [r"\bSTATE\s*BANK\s*OF\s*INDIA\b", r"\bSBI\s*BANK\b", r"\bSBIN\b", r"\bSTATE\s*BANK\b"],
        "negative_exclude_if_standalone": [
            r"\bSBI\s*LIFE\b",
            r"\bSBI\s*CARD\b",
            r"\bSBI\s*CARDS\b",
            r"\bSBI\s*MUTUAL\s*FUND\b",
            r"\bSBI\s*MF\b",
            r"\bSBI\s*GENERAL\s*INSURANCE\b",
            r"\bSBI\s*CAP\b",
            r"\bSBI\s*CAPITAL\b",
        ],
    },
    "ICICIBANK": {
        "positive_must_have": [r"\bICICI\s*BANK\b", r"\bICICIBANK\b"],
        "negative_exclude_if_standalone": [
            r"\bICICI\s*LOMBARD\b",
            r"\bICICI\s*PRUDENTIAL\b",
            r"\bICICI\s*PRU\b",
            r"\bICICI\s*SECURITIES\b",
            r"\bICICI\s*DIRECT\b",
            r"\bICICI\s*VENTURE\b",
        ],
    },
    "BAJFINANCE": {
        "positive_must_have": [r"\bBAJAJ\s*FINANCE\b", r"\bBAJFINANCE\b"],
        "negative_exclude_if_standalone": [
            r"\bBAJAJ\s*AUTO\b",
            r"\bBAJAJ\s*FINSERV\b",
            r"\bBAJAJ\s*ALLIANZ\b",
            r"\bBAJAJ\s*ELECTRICALS\b",
            r"\bBAJAJ\s*CONSUMER\b",
            r"\bBAJAJ\s*HOUSING\b",
        ],
    },
    "BAJAJFINSV": {
        "positive_must_have": [r"\bBAJAJ\s*FINSERV\b", r"\bBAJAJFINSV\b"],
        "negative_exclude_if_standalone": [
            r"\bBAJAJ\s*AUTO\b",
            r"\bBAJAJ\s*FINANCE\b",
            r"\bBAJAJ\s*ALLIANZ\b",
            r"\bBAJAJ\s*ELECTRICALS\b",
            r"\bBAJAJ\s*HOUSING\b",
        ],
    },
    "BAJAJ-AUTO": {
        "positive_must_have": [r"\bBAJAJ\s*AUTO\b", r"\bBAJAJ-AUTO\b"],
        "negative_exclude_if_standalone": [
            r"\bBAJAJ\s*FINANCE\b",
            r"\bBAJAJ\s*FINSERV\b",
            r"\bBAJAJ\s*ALLIANZ\b",
            r"\bBAJAJ\s*ELECTRICALS\b",
        ],
    },
    "TCS": {
        "positive_must_have": [r"\bTCS\b", r"\bTATA\s*CONSULTANCY\s*SERVICES\b", r"\bTATA\s*CONSULTANCY\b"],
        "negative_exclude_if_standalone": [
            r"\bTATA\s*MOTORS\b",
            r"\bTATA\s*STEEL\b",
            r"\bTATA\s*POWER\b",
            r"\bTATA\s*CONSUMER\b",
            r"\bTATA\s*COMMUNICATIONS\b",
            r"\bTATA\s*CHEMICALS\b",
            r"\bTATA\s*ELXSI\b",
            r"\bTATA\s*TECH\b",
            r"\bTATA\s*TECHNOLOGIES\b",
        ],
    },
    "TATAMOTORS": {
        "positive_must_have": [r"\bTATA\s*MOTORS\b", r"\bTATAMOTORS\b", r"\bJAGUAR\s*LAND\s*ROVER\b", r"\bJLR\b"],
        "negative_exclude_if_standalone": [
            r"\bTCS\b",
            r"\bTATA\s*STEEL\b",
            r"\bTATA\s*POWER\b",
            r"\bTATA\s*CONSUMER\b",
            r"\bTATA\s*COMMUNICATIONS\b",
            r"\bTATA\s*CHEMICALS\b",
            r"\bTATA\s*ELXSI\b",
        ],
    },
    "TATASTEEL": {
        "positive_must_have": [r"\bTATA\s*STEEL\b", r"\bTATASTEEL\b"],
        "negative_exclude_if_standalone": [
            r"\bTCS\b",
            r"\bTATA\s*MOTORS\b",
            r"\bTATA\s*POWER\b",
            r"\bTATA\s*CONSUMER\b",
        ],
    },
    "RELIANCE": {
        "positive_must_have": [r"\bRELIANCE\s*INDUSTRIES\b", r"\bRELIANCE\b", r"\bRIL\b", r"\bJIO\s*PLATFORMS\b", r"\bRELIANCE\s*RETAIL\b"],
        "negative_exclude_if_standalone": [
            r"\bRELIANCE\s*POWER\b",
            r"\bRELIANCE\s*INFRA\b",
            r"\bRELIANCE\s*COMMUNICATIONS\b",
            r"\bRELIANCE\s*CAPITAL\b",
            r"\bRELIANCE\s*NAVAL\b",
            r"\bADAG\b",
            r"\bANIL\s*AMBANI\b",
        ],
    },
}


class EntityMatcher:
    """
    Precision entity matcher for Indian equities.
    Evaluates whether a text headline or summary is genuinely relevant to a given stock.
    """

    @classmethod
    def get_aliases_for_symbol(cls, symbol: str, company_name: Optional[str] = None) -> List[str]:
        """
        Derives all valid entity names and aliases for any symbol.
        Leverages SecurityMaster if available, falling back to algorithmic derivation.
        """
        sym_clean = symbol.upper().strip().replace(".NS", "").replace(".BO", "")
        aliases: Set[str] = {sym_clean}

        # Check SecurityMaster if loaded
        try:
            from web.cyro_engine.intent_router.security_master import get_security_master
            secs = get_security_master().get_all_securities()
            for s in secs:
                if (s.get("nse_symbol") or "").upper() == sym_clean:
                    if s.get("company_name"):
                        aliases.add(s["company_name"].upper())
                    for a in (s.get("aliases") or "").split(";"):
                        if a.strip():
                            aliases.add(a.strip().upper())
                    break
        except Exception:
            pass

        # Fallback to cyro_skill _TICKER_MAP if present
        try:
            from web.cyro_skill import _TICKER_MAP
            for k, v in _TICKER_MAP.items():
                if v.upper() == sym_clean:
                    aliases.add(k.upper())
        except Exception:
            pass

        if company_name:
            aliases.add(company_name.upper())
            # Clean common legal corporate suffixes
            cleaned = re.sub(
                r"\b(LIMITED|LTD|PVT|PRIVATE|CORP|CORPORATION|INDIA|HOLDINGS|HOLDING|ENTERPRISES)\b",
                "",
                company_name.upper(),
                flags=re.IGNORECASE,
            ).strip()
            if cleaned and len(cleaned) > 2:
                aliases.add(cleaned)

        return sorted(list(aliases))

    @classmethod
    def classify_news_type_and_directness(
        cls,
        title: str,
        summary: str = "",
        symbol: str = "",
        matched_in_title: bool = True,
    ) -> Tuple[str, str, float]:
        """
        Deterministically classifies:
        1. relevance_type: DIRECT, INDIRECT, MARKET, ANALYST, INDUSTRY, MENTION_ONLY
        2. news_type: COMPANY, REGULATORY, MARKET, ANALYST, INDUSTRY, PARTNERSHIP, CORPORATE_ACTION, MANAGEMENT, OTHER
        3. score_adjustment: Fine-tuned relevance score according to the 5 quality tiers.
        """
        text = f"{title} {summary}".upper()
        title_upper = title.upper()

        # Multi-stock roundup indicators in title
        multi_stock_patterns = [
            r"\bSTOCKS\s+TO\s+(?:BUY|SELL|WATCH)\b",
            r"\bSHARES\s+TO\s+(?:BUY|SELL|WATCH)\b",
            r"\bSTOCKS\s+IN\s+FOCUS\b",
            r"\bSHARES\s+IN\s+FOCUS\b",
            r"\bMARKET\s+WRAP\b",
            r"\bHOT\s+STOCKS\b",
            r"\bTOP\s+(?:GAINERS|LOSERS)\b",
            r"\bSTOCK\s+RECOMMENDATIONS?\b",
            r"\bBUY\s+OR\s+SELL\s+STOCKS\b",
            r"\bSHARES\s+THAT\s+MAY\s+REMAIN\s+IN\s+FOCUS\b",
        ]
        is_multi_stock = any(re.search(p, title_upper) for p in multi_stock_patterns)

        # If the target security is NOT in the headline, it is an incidental / mention-only article
        if not matched_in_title:
            if is_multi_stock:
                return "MENTION_ONLY", "MARKET", 0.66
            if any(k in title_upper for k in ["DATA CENTER", "AI RACE", "GLOBAL AI", "NIFTY", "SENSEX", "WALL STREET", "FED", "RBI", "MACRO"]):
                return "MENTION_ONLY", "INDUSTRY", 0.68
            return "MENTION_ONLY", "COMPANY", 0.68

        # If matched in title but is a multi-stock listicle
        if is_multi_stock:
            return "MENTION_ONLY", "MARKET", 0.70

        # Check for individual employee personal accidents, crimes, local civic incidents
        # (Company is merely an employer reference, not a material corporate event)
        employee_incident_patterns = [
            r"\b(?:TECHIE|ENGINEER|EMPLOYEE|STAFFER|WORKER|EXECUTIVE|CODER|DEVELOPER|ANALYST|MANAGER|DRIVER|PROFESSIONAL)\s+(?:ON\s+WAY\s+HOME|RETURNING\s+HOME|FOUND\s+DEAD|DIES|KILLED|MURDERED|STABBED|ARRESTED|SUICIDE|COMMITS\s+SUICIDE|INJURED|BEATEN|CHEATED|ROBBED|DUPED|ACCIDENT|ASSAULTED|MISSING|HELD|BOOKED|NABBED)\b",
            r"\b(?:DIES|KILLED|INJURED|MURDERED)\s+(?:AFTER|IN)\s+(?:REVERSING|ROAD\s+ACCIDENT|CAR\s+CRASH|BIKE\s+CRASH|HIT\s+AND\s+RUN|EARTHMOVER|JCB|ACCIDENT|COLLISION|FALL)\b",
            r"\b(?:POLICE\s+ARREST|CRIME\s+BRANCH|COPS\s+BOOK|CASE\s+FILED\s+AGAINST)\s+(?:TECHIE|ENGINEER|EMPLOYEE|STAFFER|MAN|WOMAN)\b",
        ]
        is_employee_incident = any(re.search(p, title_upper) for p in employee_incident_patterns)
        is_corporate_policy = any(k in title_upper for k in ["VARIABLE PAY", "BONUS PAYOUT", "SALARY HIKE", "APPRAISAL", "LAYOFF", "HIRING", "HEADCOUNT", "WAGE", "DATA EXPOSURE", "DATA BREACH", "SECURITY ALERT", "CYBERATTACK", "CYBERSECURITY"])

        if is_employee_incident and not is_corporate_policy:
            return "MENTION_ONLY", "INCIDENTAL", 0.50

        # 1. Tier 0 / P0: Direct Critical Company Events (0.95 - 1.00)
        # Management & Board Changes
        if any(k in title_upper for k in ["CEO", "MD & CEO", "CHIEF EXECUTIVE", "RETIRES", "RETIREMENT", "RESIGNS", "RESIGNATION", "APPOINTS", "APPOINTMENT", "SUCCESSOR", "LEADERSHIP"]):
            return "DIRECT", "MANAGEMENT", 0.98

        # Regulatory, Rating & Legal Filings
        if any(k in title_upper for k in ["REGULATION 30", "SEBI", "LODR", "LAWSUIT", "CLASS ACTION", "SECURITIES FRAUD", "LITIGATION", "NCLT", "COURT", "CREDIT RATING", "ESG RATING"]):
            return "DIRECT", "REGULATORY", 0.96

        # Corporate Actions
        if any(k in title_upper for k in ["DIVIDEND", "BONUS ISSUE", "STOCK SPLIT", "ESOP", "ESOPS", "ALLOTMENT OF EQUITY", "BUYBACK", "RIGHTS ISSUE"]):
            return "DIRECT", "CORPORATE_ACTION", 0.96

        # M&A, Major Contracts, Strategic Acquisitions
        if any(k in title_upper for k in ["ACQUISITION", "ACQUIRES", "MERGER", "LOI", "LETTER OF INTENT", "BAGS ORDER", "CONTRACT WIN", "ROLLOUT"]):
            return "DIRECT", "COMPANY", 0.95

        # Earnings & Financial Results
        if any(k in title_upper for k in ["Q1", "Q2", "Q3", "Q4", "QUARTERLY", "NET PROFIT", "REVENUE", "EBITDA", "EARNINGS", "PAT JUMPS", "PAT SLIPS", "FINANCIAL RESULTS"]):
            return "DIRECT", "COMPANY", 0.95

        # 2. Tier 1 / P1: Strong Company-Specific Reporting (0.85 - 0.94)
        # Dedicated Stock Price / Market Action
        if any(k in title_upper for k in ["OPENING BELL", "SHARE PRICE", "STOCK UPDATE", "SLIPS TO", "ZOOM", "JUMPS", "SURGES", "TUMBLES", "FALLS", "HITS HIGH", "HITS LOW"]):
            return "DIRECT", "MARKET", 0.92

        # Dedicated Brokerage Ratings, Target Price & Technical Breakouts
        if any(k in title_upper for k in ["TARGET PRICE", "BROKERAGE", "UPGRADE", "DOWNGRADE", "BUY RATING", "SELL RATING", "ACCUMULATE", "OUTPERFORM", "JEFFERIES", "MORGAN STANLEY", "GOLDMAN", "CLSA", "NOMURA", "MOTILAL", "ICICI DIRECT", "ICICI SECURITIES", "TECHNICAL UPDATE", "BREAKOUT", "CHART SETUP"]):
            return "DIRECT", "ANALYST", 0.90

        # Strategic Partnerships / Tech Collaboration
        if any(k in title_upper for k in ["PARTNER", "PARTNERSHIP", "COLLABORATION", "JOINT VENTURE"]):
            return "DIRECT", "PARTNERSHIP", 0.88

        # 3. Tier 2 / P2: Relevant Broader / Industry Stories (0.75 - 0.84)
        if any(k in title_upper for k in ["NIFTY IT", "BANK NIFTY", "IT SHARES RALLY", "IT STOCKS", "BANKING SECTOR", "AUTO SECTOR", "AI SPEND", "EARNINGS OUTLOOK"]):
            return "INDIRECT", "INDUSTRY", 0.80

        return "DIRECT", "COMPANY", 0.85

    @classmethod
    def evaluate_relevance_details(
        cls,
        title: str,
        summary: str = "",
        symbol: str = "",
        company_name: Optional[str] = None,
        source_name: str = "",
    ) -> Tuple[bool, float, str, str, str]:
        """
        Evaluates relevance, scoring, directness, and news type.
        Returns:
            (is_relevant, relevance_score, reason, relevance_type, news_type)
        """
        if not title or not title.strip():
            return False, 0.0, "Empty headline", "MENTION_ONLY", "OTHER"

        sym_clean = symbol.upper().strip().replace(".NS", "").replace(".BO", "")
        text = f"{title} {summary}".upper()

        # 1. Authoritative Exchange Disclosures (NSE & BSE)
        if any(exc in source_name.upper() for exc in ["NSE", "BSE"]):
            rel_type, news_type, _ = cls.classify_news_type_and_directness(title, summary, sym_clean, matched_in_title=True)
            if news_type == "COMPANY":
                news_type = "REGULATORY"
            return True, 1.0, f"Authoritative exchange filing from {source_name}", "DIRECT", news_type

        # 2. Subsidiary / Conglomerate Disambiguation Rules
        if sym_clean in _SUBSIDIARY_DISAMBIGUATION:
            rule = _SUBSIDIARY_DISAMBIGUATION[sym_clean]
            positives = rule["positive_must_have"]
            negatives = rule["negative_exclude_if_standalone"]

            has_positive = any(re.search(p, text) for p in positives)
            has_negative = any(re.search(n, text) for n in negatives)

            if has_negative and not has_positive:
                return False, 0.0, f"Filtered out: Matched subsidiary/conglomerate exclusion for {sym_clean}", "INDIRECT", "OTHER"
            if has_positive:
                matched_in_title = any(re.search(p, title.upper()) for p in positives)
                rel_type, news_type, score = cls.classify_news_type_and_directness(
                    title, summary, sym_clean, matched_in_title=matched_in_title
                )
                return True, score, f"Explicit entity match for {sym_clean}", rel_type, news_type

        # 3. Generic Entity & Word-Boundary Ticker Matching for ALL other stocks
        aliases = cls.get_aliases_for_symbol(sym_clean, company_name)
        ticker_pattern = r"\b" + re.escape(sym_clean) + r"\b"

        # Check ticker symbol with strict word boundaries in headline
        if re.search(ticker_pattern, title.upper()):
            rel_type, news_type, score = cls.classify_news_type_and_directness(title, summary, sym_clean, matched_in_title=True)
            return True, score, f"Exact ticker symbol match in headline ({sym_clean})", rel_type, news_type

        # Check aliases in title
        for alias in aliases:
            if len(alias) < 3:
                continue
            alias_pattern = r"\b" + re.escape(alias) + r"\b"
            if re.search(alias_pattern, title.upper()):
                rel_type, news_type, score = cls.classify_news_type_and_directness(title, summary, sym_clean, matched_in_title=True)
                return True, score, f"Matched company name/alias in headline ({alias})", rel_type, news_type

        # Check ticker symbol in summary
        if summary and re.search(ticker_pattern, summary.upper()):
            rel_type, news_type, score = cls.classify_news_type_and_directness(title, summary, sym_clean, matched_in_title=False)
            return True, min(score, 0.75), f"Matched ticker symbol in article summary ({sym_clean})", "MENTION_ONLY", news_type

        # Check aliases in summary
        for alias in aliases:
            if len(alias) < 4:
                continue
            alias_pattern = r"\b" + re.escape(alias) + r"\b"
            if summary and re.search(alias_pattern, summary.upper()):
                rel_type, news_type, score = cls.classify_news_type_and_directness(title, summary, sym_clean, matched_in_title=False)
                return True, min(score, 0.70), f"Matched company alias in article summary ({alias})", "MENTION_ONLY", news_type

        return False, 0.0, f"No entity reference found for {sym_clean}", "MENTION_ONLY", "OTHER"

    @classmethod
    def evaluate_relevance(
        cls,
        title: str,
        summary: str = "",
        symbol: str = "",
        company_name: Optional[str] = None,
        source_name: str = "",
    ) -> Tuple[bool, float, str]:
        """
        Backward-compatible 3-tuple evaluation.
        """
        is_rel, score, reason, _, _ = cls.evaluate_relevance_details(
            title=title,
            summary=summary,
            symbol=symbol,
            company_name=company_name,
            source_name=source_name,
        )
        return is_rel, score, reason
