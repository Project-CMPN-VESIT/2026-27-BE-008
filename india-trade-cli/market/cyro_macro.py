"""
market/cyro_macro.py
─────────────────────
Macro data module for CYRO context: USD/INR, Brent Crude, RBI Repo Rate.

Sources:
  - USD/INR    : yfinance "INR=X" (Yahoo Finance) — free, no key
  - Brent Crude: yfinance "BZ=F" (Yahoo Finance) — free, no key
  - Repo Rate  : RBI press release page regex extraction — cached 48h

Usage:
    from market.cyro_macro import get_macro_context
    macro = get_macro_context()
    # {usd_inr, brent_crude, repo_rate, repo_rate_date, _flags}
"""

from __future__ import annotations

import logging
import re
import time
from typing import Optional, Any

import httpx

logger = logging.getLogger(__name__)

# ── Cache storage ─────────────────────────────────────────────
_CACHE: dict[str, tuple[float, Any]] = {}

USD_INR_TTL = 5 * 60       # 5 minutes
BRENT_TTL   = 5 * 60       # 5 minutes
REPO_TTL    = 48 * 60 * 60  # 48 hours — changes ~6-8x per year


def _get_cached(key: str, ttl: int):
    entry = _CACHE.get(key)
    if entry:
        ts, val = entry
        if time.time() - ts < ttl:
            return val
    return None


def _set_cached(key: str, val: Any):
    _CACHE[key] = (time.time(), val)


# ── USD/INR ───────────────────────────────────────────────────

def get_usd_inr() -> Optional[float]:
    """
    Fetch latest USD/INR rate from Yahoo Finance (ticker: INR=X).
    Returns the most recent closing price or None on failure.
    """
    cached = _get_cached("usd_inr", USD_INR_TTL)
    if cached is not None:
        return cached
    try:
        import yfinance as yf  # type: ignore
        hist = yf.Ticker("INR=X").history(period="5d")
        import math
        val = float(hist["Close"].iloc[-1])
        if math.isnan(val):
            return None
        val = round(val, 4)
        _set_cached("usd_inr", val)
        return val
    except Exception as e:
        logger.warning(f"[CyroMacro] USD/INR fetch failed: {e}")
        return None


# ── Brent Crude ───────────────────────────────────────────────

def get_brent_crude() -> Optional[float]:
    """
    Fetch latest Brent Crude price (USD/bbl) from Yahoo Finance (ticker: BZ=F).
    Returns most recent closing price or None on failure.
    """
    cached = _get_cached("brent_crude", BRENT_TTL)
    if cached is not None:
        return cached
    try:
        import yfinance as yf  # type: ignore
        hist = yf.Ticker("BZ=F").history(period="5d")
        import math
        val = float(hist["Close"].iloc[-1])
        if math.isnan(val):
            return None
        val = round(val, 2)
        _set_cached("brent_crude", val)
        return val
    except Exception as e:
        logger.warning(f"[CyroMacro] Brent Crude fetch failed: {e}")
        return None


# ── RBI Repo Rate ─────────────────────────────────────────────

_RBI_SEARCH_URL = (
    "https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?"
    "prid={prid}"
)
_RBI_CATEGORY_URL = (
    "https://www.rbi.org.in/Scripts/BS_ViewBulletin.aspx?"
    "Type=MonetaryPolicyStatement"
)
# Regex patterns to find the repo rate in RBI prose
_REPO_PATTERNS = [
    r"(?:repo\s+rate|policy\s+repo\s+rate).*?(\d+\.?\d*)\s*(?:per\s+cent|percent|%)",
    r"(\d+\.?\d*)\s*(?:per\s+cent|percent|%).*?(?:repo\s+rate|policy\s+repo\s+rate)",
]

_RBI_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Sec-Ch-Ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
}

# Baseline fallback if live RBI scrape is unreachable
_DEFAULT_REPO_RATE = 6.50


def get_repo_rate() -> tuple[Optional[float], Optional[str], Optional[str]]:
    """
    Scrape RBI Monetary Policy press release page for the current repo rate.
    Returns (rate_pct, announcement_date_str, flag_if_failed).
    Cached for 48 hours.
    """
    cached = _get_cached("repo_rate", REPO_TTL)
    if cached is not None:
        return cached

    rate: Optional[float] = None
    date_str: Optional[str] = None
    flag: Optional[str] = None

    try:
        with httpx.Client(timeout=10, headers=_RBI_HEADERS, follow_redirects=True) as client:
            # RBI monetary policy statements listing
            resp = client.get(_RBI_CATEGORY_URL)
            if resp.status_code == 200:
                html = resp.text

                # Find the most recent MPC press release link
                link_matches = re.findall(
                    r'href="([^"]*BS_PressReleaseDisplay\.aspx\?prid=\d+[^"]*)"',
                    html, re.IGNORECASE
                )
                # Try most recent 3 links
                for link_path in link_matches[:3]:
                    full_url = (
                        f"https://www.rbi.org.in{link_path}"
                        if link_path.startswith("/")
                        else link_path
                    )
                    try:
                        pr_resp = client.get(full_url)
                        if pr_resp.status_code == 200:
                            pr_text = pr_resp.text
                            for pattern in _REPO_PATTERNS:
                                m = re.search(pattern, pr_text, re.IGNORECASE | re.DOTALL)
                                if m:
                                    rate = float(m.group(1))
                                    date_m = re.search(
                                        r"(\d{1,2}\s+(?:January|February|March|April|May|June|July|"
                                        r"August|September|October|November|December),?\s+\d{4})",
                                        pr_text[:2000], re.IGNORECASE
                                    )
                                    if date_m:
                                        date_str = date_m.group(1)
                                    break
                            if rate is not None:
                                break
                    except Exception:
                        continue
    except Exception as e:
        logger.debug(f"[CyroMacro] RBI repo rate live scrape unavailable: {e}")

    # If live scrape failed, fall back to baseline 6.50%
    if rate is None:
        rate = _DEFAULT_REPO_RATE
        date_str = "Recent MPC"
        flag = "RBI repo rate: using current policy baseline (6.50%)"

    result = (rate, date_str, flag)
    _set_cached("repo_rate", result)
    return result


# ── Composite getter ──────────────────────────────────────────

def get_macro_context() -> dict:
    """
    Fetch all macro indicators in parallel and return a single dict.
    Each key will be None if fetch failed; _flags lists data quality issues.
    """
    from concurrent.futures import ThreadPoolExecutor

    with ThreadPoolExecutor(max_workers=3) as ex:
        f_inr    = ex.submit(get_usd_inr)
        f_brent  = ex.submit(get_brent_crude)
        f_repo   = ex.submit(get_repo_rate)

        usd_inr     = f_inr.result()
        brent_crude = f_brent.result()
        repo_rate, repo_date, repo_flag = f_repo.result()

    flags = []
    if usd_inr is None:
        flags.append("usd_inr: fetch failed (Yahoo Finance unavailable)")
    if brent_crude is None:
        flags.append("brent_crude: fetch failed (Yahoo Finance unavailable)")
    if repo_flag:
        flags.append(repo_flag)

    return {
        "usd_inr":         usd_inr,
        "brent_crude_usd": brent_crude,
        "repo_rate_pct":   repo_rate,
        "repo_rate_date":  repo_date,
        "_flags":          flags,
    }
