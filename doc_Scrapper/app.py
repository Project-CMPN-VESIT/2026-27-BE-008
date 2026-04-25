"""
India Equity Research Pipeline
================================
Collects every major document and data point for BSE/NSE listed stocks:
  - Company profile, quote, key metrics (yfinance)
  - Financial statements: P&L, Balance Sheet, Cash Flow (yfinance + Screener.in)
  - Shareholding pattern: Promoter/FII/DII/Public (Screener.in)
  - Quarterly results history (Screener.in)
  - Key ratios: ROCE, ROE, Debt/Equity, FCF, PE, PB (Screener.in)
  - Corporate announcements (BSE public JSON)
  - Annual Report PDF links (Screener.in + BSE)
  - Corporate governance data (NSE public JSON)
  - Insider trading disclosures (NSE public JSON)
  - Mutual fund holdings (NSE public JSON)
  - Peer comparison (Screener.in)
  - Historical price data (yfinance)
  - News & recent events (yfinance)

All data is saved to: output/<TICKER>/
  - <ticker>_complete_data.json  → all structured data combined
  - <ticker>_financials.csv      → P&L / Balance Sheet / Cash Flow
  - <ticker>_shareholding.csv    → quarterly shareholding pattern
  - <ticker>_announcements.csv   → corporate announcements
  - <ticker>_ratios.csv          → key financial ratios
  - annual_reports/              → PDF links list (download-ready)

Usage:
  python india_equity_pipeline.py --tickers RELIANCE TCS HDFCBANK
  python india_equity_pipeline.py --tickers RELIANCE --download-pdfs
  python india_equity_pipeline.py --nifty50   (runs all Nifty 50 stocks)
"""

import argparse
import json
import os
import re
import sys
import time
import csv
import random
from datetime import datetime, timedelta
from pathlib import Path
import warnings
warnings.filterwarnings("ignore")

import requests
from bs4 import BeautifulSoup
import yfinance as yf
import pandas as pd
from tqdm import tqdm

try:
    import boto3
except Exception:
    boto3 = None

# ─────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────

OUTPUT_DIR = Path("output")

# Rotate user agents to reduce blocking
USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
]

NSE_BASE    = "https://www.nseindia.com"
BSE_BASE    = "https://api.bseindia.com/BseIndiaAPI/api"
SCREENER    = "https://www.screener.in"

# Nifty 50 tickers (NSE symbols) for bulk runs
NIFTY50_TICKERS = [
    "RELIANCE","TCS","HDFCBANK","INFY","ICICIBANK","HINDUNILVR","ITC","SBIN",
    "BHARTIARTL","KOTAKBANK","LT","AXISBANK","MARUTI","ASIANPAINT","BAJFINANCE",
    "HCLTECH","TITAN","WIPRO","NTPC","POWERGRID","SUNPHARMA","ULTRACEMCO",
    "BAJAJFINSV","NESTLEIND","TECHM","M&M","ADANIENT","ONGC","COALINDIA","JSWSTEEL",
    "GRASIM","TATASTEEL","DRREDDY","DIVISLAB","CIPLA","TATAMOTORS","HINDALCO",
    "APOLLOHOSP","LTIM","BPCL","HEROMOTOCO","INDUSINDBK","EICHERMOT","TATACONSUM",
    "BRITANNIA","HDFCLIFE","SBILIFE","BAJAJ-AUTO","UPL","ADANIPORTS"
]


def load_env_file(env_path: Path = Path(".env")):
    """Load KEY=VALUE entries from .env into process env if not already set."""
    if not env_path.exists():
        return

    try:
        for raw in env_path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue

            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")

            if key and key not in os.environ:
                os.environ[key] = value
    except Exception as e:
        print(f"  [env-warning] Unable to read .env: {e}")


def get_s3_client(region: str | None = None):
    """Create boto3 S3 client using environment credentials."""
    if boto3 is None:
        raise RuntimeError("boto3 is required for --upload-s3. Install with: pip install boto3")

    return boto3.client("s3", region_name=region or os.getenv("AWS_DEFAULT_REGION"))


def upload_outputs_to_s3(
    ticker: str,
    output_dir: Path,
    bucket: str,
    s3_prefix: str = "doc-scrapper",
    region: str | None = None,
):
    """Upload ticker outputs to both dated and latest prefixes in S3."""
    if not output_dir.exists():
        print(f"  [s3-skip] missing output directory for {ticker}: {output_dir}")
        return

    client = get_s3_client(region=region)
    run_date = datetime.now().strftime("%Y-%m-%d")
    uploaded = 0

    for path in output_dir.rglob("*"):
        if not path.is_file():
            continue

        rel = path.relative_to(output_dir).as_posix()
        latest_key = f"{s3_prefix}/latest/{ticker}/{rel}"
        dated_key = f"{s3_prefix}/raw/{run_date}/{ticker}/{rel}"

        client.upload_file(str(path), bucket, latest_key)
        client.upload_file(str(path), bucket, dated_key)
        uploaded += 1

    print(f"  [s3] uploaded {uploaded} files for {ticker} to s3://{bucket}/{s3_prefix}/...")

# ─────────────────────────────────────────────
# HTTP HELPERS
# ─────────────────────────────────────────────

def make_session():
    """Create a requests Session with browser-like headers and NSE cookie."""
    s = requests.Session()
    s.headers.update({
        "User-Agent": random.choice(USER_AGENTS),
        "Accept": "application/json, text/html,*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "keep-alive",
    })
    # NSE requires a cookie obtained by visiting the homepage first
    try:
        s.get(NSE_BASE, timeout=10)
    except Exception:
        pass
    return s


SESSION = make_session()


def get_json(url, params=None, headers=None, retries=3, delay=2):
    """Fetch JSON with retries and polite delay."""
    for attempt in range(retries):
        try:
            time.sleep(delay + random.uniform(0.5, 1.5))
            h = {"User-Agent": random.choice(USER_AGENTS)}
            if headers:
                h.update(headers)
            r = SESSION.get(url, params=params, headers=h, timeout=15)
            if r.status_code == 200:
                return r.json()
            elif r.status_code == 429:
                print(f"  [rate-limit] waiting 30s…")
                time.sleep(30)
        except Exception as e:
            if attempt == retries - 1:
                print(f"  [error] {url}: {e}")
    return None


def get_html(url, params=None, delay=2):
    """Fetch HTML with polite delay, return BeautifulSoup object."""
    try:
        time.sleep(delay + random.uniform(0.3, 1.0))
        r = SESSION.get(url, params=params, timeout=20)
        if r.status_code == 200:
            return BeautifulSoup(r.text, "lxml")
    except Exception as e:
        print(f"  [html-error] {url}: {e}")
    return None


# ─────────────────────────────────────────────
# 1. YFINANCE — QUOTE, PROFILE, FINANCIALS, PRICE
# ─────────────────────────────────────────────

def fetch_yfinance_data(ticker_nse: str) -> dict:
    """
    Fetch via yfinance (Yahoo Finance):
      - Company info / profile
      - Current quote + key metrics
      - Quarterly & annual P&L, Balance Sheet, Cash Flow
      - Historical OHLCV (2 years)
      - Analyst recommendations
      - Recent news headlines
    """
    result = {}
    yf_ticker = f"{ticker_nse}.NS"
    print(f"  [yfinance] fetching {yf_ticker}…")

    try:
        t = yf.Ticker(yf_ticker)

        # ── Company info / profile ──
        info = t.info or {}
        result["profile"] = {
            "company_name":       info.get("longName"),
            "sector":             info.get("sector"),
            "industry":           info.get("industry"),
            "website":            info.get("website"),
            "description":        info.get("longBusinessSummary"),
            "employees":          info.get("fullTimeEmployees"),
            "country":            info.get("country"),
            "exchange":           info.get("exchange"),
            "currency":           info.get("currency"),
            "isin":               info.get("isin"),
            "city":               info.get("city"),
            "address":            info.get("address1"),
            "state":              info.get("state"),
        }

        # ── Current quote ──
        result["quote"] = {
            "current_price":      info.get("currentPrice") or info.get("regularMarketPrice"),
            "prev_close":         info.get("regularMarketPreviousClose"),
            "open":               info.get("regularMarketOpen"),
            "day_high":           info.get("dayHigh"),
            "day_low":            info.get("dayLow"),
            "52w_high":           info.get("fiftyTwoWeekHigh"),
            "52w_low":            info.get("fiftyTwoWeekLow"),
            "volume":             info.get("regularMarketVolume"),
            "avg_volume":         info.get("averageVolume"),
            "market_cap_cr":      round(info.get("marketCap", 0) / 1e7, 2) if info.get("marketCap") else None,
        }

        # ── Key valuation & fundamental metrics ──
        result["key_metrics"] = {
            "pe_ratio":           info.get("trailingPE"),
            "forward_pe":         info.get("forwardPE"),
            "pb_ratio":           info.get("priceToBook"),
            "ps_ratio":           info.get("priceToSalesTrailing12Months"),
            "peg_ratio":          info.get("pegRatio"),
            "eps_ttm":            info.get("trailingEps"),
            "eps_forward":        info.get("forwardEps"),
            "book_value":         info.get("bookValue"),
            "dividend_yield_pct": round(info.get("dividendYield", 0) * 100, 2) if info.get("dividendYield") else None,
            "dividend_rate":      info.get("dividendRate"),
            "payout_ratio_pct":   round(info.get("payoutRatio", 0) * 100, 2) if info.get("payoutRatio") else None,
            "roe_pct":            round(info.get("returnOnEquity", 0) * 100, 2) if info.get("returnOnEquity") else None,
            "roa_pct":            round(info.get("returnOnAssets", 0) * 100, 2) if info.get("returnOnAssets") else None,
            "revenue_growth_pct": round(info.get("revenueGrowth", 0) * 100, 2) if info.get("revenueGrowth") else None,
            "earnings_growth_pct":round(info.get("earningsGrowth", 0) * 100, 2) if info.get("earningsGrowth") else None,
            "gross_margin_pct":   round(info.get("grossMargins", 0) * 100, 2) if info.get("grossMargins") else None,
            "operating_margin_pct":round(info.get("operatingMargins", 0) * 100, 2) if info.get("operatingMargins") else None,
            "profit_margin_pct":  round(info.get("profitMargins", 0) * 100, 2) if info.get("profitMargins") else None,
            "debt_to_equity":     info.get("debtToEquity"),
            "current_ratio":      info.get("currentRatio"),
            "quick_ratio":        info.get("quickRatio"),
            "total_cash_cr":      round(info.get("totalCash", 0) / 1e7, 2) if info.get("totalCash") else None,
            "total_debt_cr":      round(info.get("totalDebt", 0) / 1e7, 2) if info.get("totalDebt") else None,
            "free_cashflow_cr":   round(info.get("freeCashflow", 0) / 1e7, 2) if info.get("freeCashflow") else None,
            "operating_cashflow_cr": round(info.get("operatingCashflow", 0) / 1e7, 2) if info.get("operatingCashflow") else None,
            "enterprise_value_cr": round(info.get("enterpriseValue", 0) / 1e7, 2) if info.get("enterpriseValue") else None,
            "ev_to_ebitda":       info.get("enterpriseToEbitda"),
            "ev_to_revenue":      info.get("enterpriseToRevenue"),
            "beta":               info.get("beta"),
            "shares_outstanding_cr": round(info.get("sharesOutstanding", 0) / 1e7, 2) if info.get("sharesOutstanding") else None,
            "float_shares_cr":    round(info.get("floatShares", 0) / 1e7, 2) if info.get("floatShares") else None,
            "short_ratio":        info.get("shortRatio"),
        }

        # ── Financial statements ──
        def df_to_dict(df):
            if df is None or df.empty:
                return {}
            df = df.copy()
            df.index = df.index.astype(str)
            df.columns = [str(c)[:10] for c in df.columns]
            return df.to_dict()

        result["financials"] = {
            "income_statement_annual":   df_to_dict(t.financials),
            "income_statement_quarterly":df_to_dict(t.quarterly_financials),
            "balance_sheet_annual":      df_to_dict(t.balance_sheet),
            "balance_sheet_quarterly":   df_to_dict(t.quarterly_balance_sheet),
            "cash_flow_annual":          df_to_dict(t.cashflow),
            "cash_flow_quarterly":       df_to_dict(t.quarterly_cashflow),
        }

        # ── Historical price data (2 years) ──
        hist = t.history(period="2y", interval="1d")
        if not hist.empty:
            hist.index = hist.index.astype(str)
            result["historical_prices"] = hist[["Open","High","Low","Close","Volume"]].round(2).to_dict("index")
        else:
            result["historical_prices"] = {}

        # ── Analyst recommendations ──
        try:
            rec = t.recommendations
            if rec is not None and not rec.empty:
                rec.index = rec.index.astype(str)
                result["analyst_recommendations"] = rec.tail(20).to_dict("records")
        except Exception:
            result["analyst_recommendations"] = []

        # ── Earnings calendar ──
        try:
            cal = t.calendar
            result["earnings_calendar"] = cal.to_dict() if cal is not None else {}
        except Exception:
            result["earnings_calendar"] = {}

        # ── Recent news ──
        try:
            news = t.news or []
            result["recent_news"] = [
                {
                    "title":     n.get("title"),
                    "publisher": n.get("publisher"),
                    "link":      n.get("link"),
                    "published": datetime.fromtimestamp(n.get("providerPublishTime", 0)).strftime("%Y-%m-%d %H:%M") if n.get("providerPublishTime") else None,
                }
                for n in news[:20]
            ]
        except Exception:
            result["recent_news"] = []

        # ── Dividends & splits history ──
        try:
            div = t.dividends
            result["dividends"] = {str(k): round(float(v), 4) for k, v in div.items()} if not div.empty else {}
            splits = t.splits
            result["stock_splits"] = {str(k): float(v) for k, v in splits.items()} if not splits.empty else {}
        except Exception:
            result["dividends"] = {}
            result["stock_splits"] = {}

    except Exception as e:
        print(f"  [yfinance-error] {ticker_nse}: {e}")

    return result


# ─────────────────────────────────────────────
# 2. SCREENER.IN — RATIOS, SHAREHOLDING, PEERS, AR LINKS
# ─────────────────────────────────────────────

def fetch_screener_data(ticker_nse: str) -> dict:
    """
    Scrape Screener.in for:
      - 10-year key ratios table (ROCE, ROE, EPS, D/E, OPM etc.)
      - Quarterly results (revenue, profit, OPM)
      - Shareholding pattern (quarterly, Promoter/FII/DII/Public)
      - Annual Report PDF download links
      - Peer comparison table
      - Key strengths / warnings (Screener's own analysis)
    """
    result = {}
    url = f"{SCREENER}/company/{ticker_nse}/consolidated/"
    print(f"  [screener] fetching {url}…")
    soup = get_html(url, delay=3)
    
    # Fallback to standalone if consolidated not found
    if soup is None or soup.find("h1") is None:
        url = f"{SCREENER}/company/{ticker_nse}/"
        soup = get_html(url, delay=3)

    if soup is None:
        print(f"  [screener] no data for {ticker_nse}")
        return result

    # ── Key ratios table ──
    ratios = {}
    ratio_section = soup.find("section", id="ratios")
    if ratio_section:
        table = ratio_section.find("table")
        if table:
            headers = [th.get_text(strip=True) for th in table.find_all("th")]
            for row in table.find_all("tr")[1:]:
                cells = [td.get_text(strip=True) for td in row.find_all("td")]
                if cells and len(cells) == len(headers):
                    row_name = cells[0]
                    ratios[row_name] = dict(zip(headers[1:], cells[1:]))
    result["key_ratios_10yr"] = ratios

    # ── Quarterly results ──
    quarterly = []
    qr_section = soup.find("section", id="quarters")
    if qr_section:
        table = qr_section.find("table")
        if table:
            headers = [th.get_text(strip=True) for th in table.find_all("th")]
            for row in table.find_all("tr")[1:]:
                cells = [td.get_text(strip=True) for td in row.find_all("td")]
                if cells:
                    entry = dict(zip(headers, cells))
                    quarterly.append(entry)
    result["quarterly_results"] = quarterly

    # ── Profit & Loss (annual) ──
    pnl = []
    pnl_section = soup.find("section", id="profit-loss")
    if pnl_section:
        table = pnl_section.find("table")
        if table:
            headers = [th.get_text(strip=True) for th in table.find_all("th")]
            for row in table.find_all("tr")[1:]:
                cells = [td.get_text(strip=True) for td in row.find_all("td")]
                if cells:
                    pnl.append(dict(zip(headers, cells)))
    result["profit_loss_annual"] = pnl

    # ── Balance Sheet (annual) ──
    bs = []
    bs_section = soup.find("section", id="balance-sheet")
    if bs_section:
        table = bs_section.find("table")
        if table:
            headers = [th.get_text(strip=True) for th in table.find_all("th")]
            for row in table.find_all("tr")[1:]:
                cells = [td.get_text(strip=True) for td in row.find_all("td")]
                if cells:
                    bs.append(dict(zip(headers, cells)))
    result["balance_sheet_annual"] = bs

    # ── Cash Flow (annual) ──
    cf = []
    cf_section = soup.find("section", id="cash-flow")
    if cf_section:
        table = cf_section.find("table")
        if table:
            headers = [th.get_text(strip=True) for th in table.find_all("th")]
            for row in table.find_all("tr")[1:]:
                cells = [td.get_text(strip=True) for td in row.find_all("td")]
                if cells:
                    cf.append(dict(zip(headers, cells)))
    result["cash_flow_annual"] = cf

    # ── Shareholding pattern ──
    shareholding = []
    sh_section = soup.find("section", id="shareholding")
    if sh_section:
        table = sh_section.find("table")
        if table:
            headers = [th.get_text(strip=True) for th in table.find_all("th")]
            for row in table.find_all("tr")[1:]:
                cells = [td.get_text(strip=True) for td in row.find_all("td")]
                if cells:
                    shareholding.append(dict(zip(headers, cells)))
    result["shareholding_pattern"] = shareholding

    # ── Annual Report links ──
    ar_links = []
    docs_section = soup.find("section", id="documents")
    if docs_section:
        for a in docs_section.find_all("a", href=True):
            href = a["href"]
            if "AnnualReport" in href or "annual" in href.lower():
                ar_links.append({
                    "label": a.get_text(strip=True),
                    "url":   href if href.startswith("http") else f"https://www.bseindia.com{href}"
                })
    result["annual_report_links"] = ar_links

    # ── Peer comparison ──
    peers = []
    peer_section = soup.find("section", id="peers")
    if peer_section:
        table = peer_section.find("table")
        if table:
            headers = [th.get_text(strip=True) for th in table.find_all("th")]
            for row in table.find_all("tr")[1:]:
                cells = [td.get_text(strip=True) for td in row.find_all("td")]
                if cells:
                    peers.append(dict(zip(headers, cells)))
    result["peer_comparison"] = peers

    # ── Strengths / Concerns (Screener analysis) ──
    strengths, concerns = [], []
    pros_section = soup.find("div", class_="pros")
    if pros_section:
        strengths = [li.get_text(strip=True) for li in pros_section.find_all("li")]
    cons_section = soup.find("div", class_="cons")
    if cons_section:
        concerns = [li.get_text(strip=True) for li in cons_section.find_all("li")]
    result["screener_analysis"] = {"strengths": strengths, "concerns": concerns}

    # ── Company summary box (top stats) ──
    summary = {}
    top_ratios = soup.find("ul", id="top-ratios")
    if top_ratios:
        for li in top_ratios.find_all("li"):
            name_tag = li.find("span", class_="name")
            val_tag  = li.find("span", class_="value") or li.find("span", class_="number")
            if name_tag and val_tag:
                summary[name_tag.get_text(strip=True)] = val_tag.get_text(strip=True)
    result["top_summary"] = summary

    return result


# ─────────────────────────────────────────────
# 3. NSE PUBLIC APIs — GOVERNANCE, INSIDER TRADING, MF HOLDINGS
# ─────────────────────────────────────────────

def fetch_nse_data(ticker_nse: str) -> dict:
    """
    Fetch via NSE's public (unauthenticated) JSON endpoints:
      - Equity info & corporate info
      - Shareholding pattern
      - Corporate governance report
      - Insider trading disclosures (SAST/PIT)
      - Mutual fund holdings (via NSE bulk deals)
      - Corporate actions (dividends, bonuses, splits, rights)
      - Board meetings
      - Financial results filings
    """
    result = {}
    nse_headers = {
        "Referer":    "https://www.nseindia.com/",
        "User-Agent": random.choice(USER_AGENTS),
    }
    base = "https://www.nseindia.com/api"

    # ── Company info ──
    print(f"  [nse] equity info…")
    data = get_json(f"{base}/quote-equity", params={"symbol": ticker_nse}, headers=nse_headers)
    if data:
        result["nse_company_info"] = {
            "symbol":    data.get("info", {}).get("symbol"),
            "company_name": data.get("info", {}).get("companyName"),
            "industry":  data.get("info", {}).get("industry"),
            "series":    data.get("info", {}).get("series"),
            "isin":      data.get("info", {}).get("isin"),
            "face_value": data.get("metadata", {}).get("pdFaceValue"),
            "listing_date": data.get("metadata", {}).get("pdListDate"),
            "paid_up_value": data.get("metadata", {}).get("pdPaidupValue"),
            "market_lot": data.get("metadata", {}).get("pdMarketLot"),
        }
        price_info = data.get("priceInfo", {})
        result["nse_live_quote"] = {
            "last_price":      price_info.get("lastPrice"),
            "change":          price_info.get("change"),
            "pct_change":      price_info.get("pChange"),
            "52w_high":        price_info.get("weekHighLow", {}).get("max"),
            "52w_low":         price_info.get("weekHighLow", {}).get("min"),
            "total_buy_qty":   data.get("marketDeptOrderBook", {}).get("totalBuyQuantity"),
            "total_sell_qty":  data.get("marketDeptOrderBook", {}).get("totalSellQuantity"),
        }

    # ── Corporate actions ──
    print(f"  [nse] corporate actions…")
    ca = get_json(f"{base}/corporates-corporateActions",
                  params={"index": "equities", "symbol": ticker_nse}, headers=nse_headers)
    if ca and isinstance(ca, list):
        result["corporate_actions"] = [
            {
                "ex_date":    x.get("exDate"),
                "purpose":    x.get("subject"),
                "record_date": x.get("recDate"),
                "bc_start":   x.get("bcStartDate"),
                "bc_end":     x.get("bcEndDate"),
            }
            for x in ca[:50]
        ]

    # ── Board meetings ──
    print(f"  [nse] board meetings…")
    bm = get_json(f"{base}/corporate-board-meetings",
                  params={"index": "equities", "symbol": ticker_nse}, headers=nse_headers)
    if bm and isinstance(bm, list):
        result["board_meetings"] = [
            {
                "date":    x.get("bm_date"),
                "purpose": x.get("bm_purpose"),
                "desc":    x.get("bm_desc"),
            }
            for x in bm[:30]
        ]

    # ── Shareholding pattern (NSE) ──
    print(f"  [nse] shareholding…")
    sh = get_json(f"{base}/corporate-share-holdings-master",
                  params={"index": "equities", "symbol": ticker_nse}, headers=nse_headers)
    if sh and isinstance(sh, list):
        result["nse_shareholding"] = sh[:8]  # last 8 quarters

    # ── Financial results filings ──
    print(f"  [nse] financial results…")
    fr = get_json(f"{base}/corporates-financial-results",
                  params={"index": "equities", "symbol": ticker_nse}, headers=nse_headers)
    if fr and isinstance(fr, list):
        result["financial_results_filings"] = [
            {
                "period":      x.get("period"),
                "from_date":   x.get("fromDate"),
                "to_date":     x.get("toDate"),
                "xbrl_link":   x.get("xbrl"),
                "na_link":     x.get("na"),
                "broadcast_date": x.get("broadcastDate"),
            }
            for x in fr[:20]
        ]

    # ── Insider trading (PIT / SAST) ──
    print(f"  [nse] insider trading…")
    pit = get_json(f"{base}/corporates-pit",
                   params={"symbol": ticker_nse, "market": "equities"}, headers=nse_headers)
    if pit and isinstance(pit, list):
        result["insider_trading"] = [
            {
                "name":          x.get("acqName"),
                "category":      x.get("personCategory"),
                "transaction":   x.get("tdpTransactionType"),
                "securities":    x.get("secAcq"),
                "value_lakhs":   x.get("secVal"),
                "post_holding_pct": x.get("befAcqSharesNo"),
                "date":          x.get("date"),
            }
            for x in pit[:30]
        ]

    # ── Announcements ──
    print(f"  [nse] announcements…")
    ann = get_json(f"{base}/corporate-announcements",
                   params={"index": "equities", "symbol": ticker_nse}, headers=nse_headers)
    if ann and isinstance(ann, list):
        result["nse_announcements"] = [
            {
                "subject":     a.get("subject"),
                "date":        a.get("sort_date"),
                "attachment":  a.get("attchmntFile"),
                "description": a.get("desc"),
            }
            for a in ann[:50]
        ]

    return result


# ─────────────────────────────────────────────
# 4. BSE PUBLIC API — ANNOUNCEMENTS + DETAILED FILINGS
# ─────────────────────────────────────────────

def get_bse_code(ticker_nse: str) -> str | None:
    """Try to resolve NSE ticker → BSE 6-digit code via NSE API."""
    data = get_json(
        "https://www.nseindia.com/api/quote-equity",
        params={"symbol": ticker_nse},
        headers={"Referer": "https://www.nseindia.com/"}
    )
    if data:
        return data.get("info", {}).get("isinCode") or data.get("metadata", {}).get("pdSectorPe")
    return None


def fetch_bse_data(ticker_nse: str, bse_code: str = None) -> dict:
    """
    Fetch via BSE's public JSON API:
      - Corporate announcements (with category tags)
      - Annual report PDF links (from BSE's AR repository)
      - Shareholding pattern details
      - Bulk / block deals
    """
    result = {}
    if not bse_code:
        print(f"  [bse] no BSE code for {ticker_nse}, skipping BSE-specific calls")
        return result

    bse_headers = {
        "Referer":    "https://www.bseindia.com/",
        "User-Agent": random.choice(USER_AGENTS),
    }
    base = "https://api.bseindia.com/BseIndiaAPI/api"

    # ── Corporate announcements ──
    print(f"  [bse] corporate announcements (code={bse_code})…")
    ann = get_json(
        f"{base}/AnnSubCategoryGetData/w",
        params={"pageno": 1, "strCat": "-1", "strPrevDate": "", "strScrip": bse_code,
                "strSearch": "P", "strToDate": "", "strType": "C", "subcategory": "-1"},
        headers=bse_headers
    )
    if ann and "Table" in ann:
        result["bse_announcements"] = [
            {
                "date":       x.get("NewsDate"),
                "headline":   x.get("NEWSSUB"),
                "category":   x.get("categoryname"),
                "attachment": f"https://www.bseindia.com/xml-data/corpfiling/AttachHis/{x.get('ATTACHMENTNAME')}"
                              if x.get("ATTACHMENTNAME") else None,
            }
            for x in ann["Table"][:50]
        ]

    # ── Annual Reports from BSE ──
    print(f"  [bse] annual report links…")
    ar = get_json(
        f"{base}/AnnualReportNew/w",
        params={"scripcode": bse_code, "flag": "C"},
        headers=bse_headers
    )
    if ar and "Table" in ar:
        result["bse_annual_reports"] = [
            {
                "year":  x.get("FINYEAR"),
                "url":   f"https://www.bseindia.com/bseplus/AnnualReport/{bse_code}/{x.get('FILENAME')}",
                "type":  x.get("REPORT_TYPE"),
            }
            for x in ar["Table"]
        ]

    # ── Shareholding pattern (BSE) ──
    print(f"  [bse] shareholding pattern…")
    sh = get_json(
        f"{base}/ShareHoldingV2/w",
        params={"scripcode": bse_code, "flag": "C", "Scode": bse_code},
        headers=bse_headers
    )
    if sh and "ShareHolding" in sh:
        result["bse_shareholding"] = sh["ShareHolding"]

    return result


# ─────────────────────────────────────────────
# 5. SCREENER EXPORT API (JSON endpoint)
# ─────────────────────────────────────────────

def fetch_screener_export(ticker_nse: str) -> dict:
    """
    Use Screener.in's /api/company endpoint (undocumented but public)
    to get machine-readable data including full 10yr financials.
    """
    result = {}
    url = f"https://www.screener.in/api/company/{ticker_nse}/?format=json"
    print(f"  [screener-api] {url}…")
    
    headers = {
        "Referer": f"https://www.screener.in/company/{ticker_nse}/",
        "User-Agent": random.choice(USER_AGENTS),
        "X-Requested-With": "XMLHttpRequest",
        "Accept": "application/json",
    }
    try:
        time.sleep(3)
        r = SESSION.get(url, headers=headers, timeout=20)
        if r.status_code == 200:
            data = r.json()
            # Extract concise fields
            result["screener_json"] = {
                "name":          data.get("name"),
                "bse_code":      data.get("bse_code"),
                "nse_code":      data.get("nse_code"),
                "isin":          data.get("isin"),
                "website":       data.get("website"),
                "bse_url":       data.get("bse_url"),
                "nse_url":       data.get("nse_url"),
                "consolidated":  data.get("consolidated"),
                "standalone":    data.get("standalone"),
            }
            # Grab BSE code from here if available
            if data.get("bse_code"):
                result["bse_code_from_screener"] = str(data["bse_code"])
    except Exception as e:
        print(f"  [screener-api-error] {e}")
    return result


# ─────────────────────────────────────────────
# 6. MONEYCONTROL — MANAGEMENT & CONCALL LINKS
# ─────────────────────────────────────────────

def fetch_moneycontrol_data(ticker_nse: str) -> dict:
    """
    Scrape Moneycontrol for:
      - Management team details
      - Key ratios supplementary data
    """
    result = {}
    # Map common NSE tickers to Moneycontrol search slugs
    search_url = f"https://www.moneycontrol.com/mccode/common/autosuggestion/ajaxsearch.php?classic=true&query={ticker_nse}&type=1&format=json"
    try:
        time.sleep(2)
        r = SESSION.get(search_url, timeout=10, headers={"Referer": "https://www.moneycontrol.com"})
        if r.status_code == 200:
            items = r.json()
            if items:
                mc_id = items[0].get("sc_id")
                mc_name = items[0].get("stock_name")
                result["moneycontrol_info"] = {
                    "mc_id":      mc_id,
                    "stock_name": mc_name,
                    "link":       f"https://www.moneycontrol.com{items[0].get('link', '')}",
                }
    except Exception as e:
        print(f"  [moneycontrol] search error: {e}")
    return result


# ─────────────────────────────────────────────
# 7. PDF DOWNLOADER (for Annual Reports)
# ─────────────────────────────────────────────

def download_annual_reports(ticker_nse: str, ar_links: list, output_dir: Path, max_pdfs: int = 3):
    """Download Annual Report PDFs to disk (latest N years)."""
    ar_dir = output_dir / "annual_reports"
    ar_dir.mkdir(parents=True, exist_ok=True)
    downloaded = []

    for i, ar in enumerate(ar_links[:max_pdfs]):
        url = ar.get("url", "")
        if not url or not url.endswith(".pdf"):
            continue
        year = ar.get("year", f"year_{i+1}")
        filename = ar_dir / f"{ticker_nse}_AR_{year}.pdf"
        if filename.exists():
            downloaded.append(str(filename))
            continue
        try:
            print(f"  [pdf] downloading {year}: {url[:80]}…")
            time.sleep(2)
            r = SESSION.get(url, timeout=60, stream=True,
                            headers={"Referer": "https://www.bseindia.com"})
            if r.status_code == 200:
                with open(filename, "wb") as f:
                    for chunk in r.iter_content(8192):
                        f.write(chunk)
                downloaded.append(str(filename))
                print(f"    ✓ saved {filename.name}")
        except Exception as e:
            print(f"  [pdf-error] {year}: {e}")

    return downloaded


# ─────────────────────────────────────────────
# 8. DATA SAVING UTILITIES
def json_cleaner(obj):
    """Recursively convert float('nan') and +/-inf to None for valid JSON."""
    if isinstance(obj, float):
        if not (obj > float('-inf') and obj < float('inf')): # NaN or Inf
            return None
        return obj
    elif isinstance(obj, dict):
        return {k: json_cleaner(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [json_cleaner(i) for i in obj]
    return obj


# ─────────────────────────────────────────────

def save_outputs(ticker: str, data: dict, output_dir: Path, download_pdfs: bool = False):
    """Save all collected data to JSON + CSV files."""
    output_dir.mkdir(parents=True, exist_ok=True)

    # ── Master JSON ──
    json_path = output_dir / f"{ticker}_complete_data.json"
    clean_data = json_cleaner(data)
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(clean_data, f, indent=2, ensure_ascii=False, default=str)
    print(f"  ✓ {json_path}")

    # ── Ratios CSV ──
    ratios = data.get("screener", {}).get("key_ratios_10yr", {})
    if ratios:
        rows = []
        for metric, period_vals in ratios.items():
            row = {"Metric": metric}
            row.update(period_vals)
            rows.append(row)
        ratios_path = output_dir / f"{ticker}_ratios.csv"
        pd.DataFrame(rows).to_csv(ratios_path, index=False)
        print(f"  ✓ {ratios_path}")

    # ── Quarterly results CSV ──
    qr = data.get("screener", {}).get("quarterly_results", [])
    if qr:
        qr_path = output_dir / f"{ticker}_quarterly_results.csv"
        pd.DataFrame(qr).to_csv(qr_path, index=False)
        print(f"  ✓ {qr_path}")

    # ── Shareholding CSV ──
    sh = data.get("screener", {}).get("shareholding_pattern", [])
    if sh:
        sh_path = output_dir / f"{ticker}_shareholding.csv"
        pd.DataFrame(sh).to_csv(sh_path, index=False)
        print(f"  ✓ {sh_path}")

    # ── Announcements CSV ──
    ann_nse = data.get("nse", {}).get("nse_announcements", [])
    ann_bse = data.get("bse", {}).get("bse_announcements", [])
    all_ann = ann_nse + ann_bse
    if all_ann:
        ann_path = output_dir / f"{ticker}_announcements.csv"
        pd.DataFrame(all_ann).to_csv(ann_path, index=False)
        print(f"  ✓ {ann_path}")

    # ── Historical prices CSV ──
    prices = data.get("yfinance", {}).get("historical_prices", {})
    if prices:
        price_path = output_dir / f"{ticker}_historical_prices.csv"
        pd.DataFrame.from_dict(prices, orient="index").to_csv(price_path)
        print(f"  ✓ {price_path}")

    # ── Annual report links TXT ──
    ar_links = []
    ar_links += data.get("screener", {}).get("annual_report_links", [])
    ar_links += data.get("bse", {}).get("bse_annual_reports", [])
    if ar_links:
        ar_txt = output_dir / f"{ticker}_annual_report_links.txt"
        with open(ar_txt, "w") as f:
            for ar in ar_links:
                f.write(f"{ar.get('year','')} | {ar.get('label','')} | {ar.get('url','')}\n")
        print(f"  ✓ {ar_txt}")

        if download_pdfs:
            dl = download_annual_reports(ticker, ar_links, output_dir, max_pdfs=3)
            data["downloaded_pdfs"] = dl

    # ── Insider trading CSV ──
    insider = data.get("nse", {}).get("insider_trading", [])
    if insider:
        ins_path = output_dir / f"{ticker}_insider_trading.csv"
        pd.DataFrame(insider).to_csv(ins_path, index=False)
        print(f"  ✓ {ins_path}")

    # ── Corporate actions CSV ──
    ca = data.get("nse", {}).get("corporate_actions", [])
    if ca:
        ca_path = output_dir / f"{ticker}_corporate_actions.csv"
        pd.DataFrame(ca).to_csv(ca_path, index=False)
        print(f"  ✓ {ca_path}")

    # ── Summary report (human-readable) ──
    summary_path = output_dir / f"{ticker}_summary.txt"
    with open(summary_path, "w", encoding="utf-8") as f:
        f.write(f"{'='*70}\n")
        f.write(f"  EQUITY RESEARCH SUMMARY: {ticker}\n")
        f.write(f"  Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
        f.write(f"{'='*70}\n\n")

        profile = data.get("yfinance", {}).get("profile", {})
        f.write(f"COMPANY: {profile.get('company_name','N/A')}\n")
        f.write(f"Sector:  {profile.get('sector','N/A')}\n")
        f.write(f"Industry:{profile.get('industry','N/A')}\n")
        f.write(f"Website: {profile.get('website','N/A')}\n\n")

        quote = data.get("yfinance", {}).get("quote", {})
        f.write(f"QUOTE:\n")
        f.write(f"  Current Price : ₹{quote.get('current_price','N/A')}\n")
        f.write(f"  Market Cap    : ₹{quote.get('market_cap_cr','N/A')} Cr\n")
        f.write(f"  52W High/Low  : ₹{quote.get('52w_high','N/A')} / ₹{quote.get('52w_low','N/A')}\n\n")

        metrics = data.get("yfinance", {}).get("key_metrics", {})
        f.write(f"KEY METRICS:\n")
        for k, v in metrics.items():
            if v is not None:
                f.write(f"  {k:30s}: {v}\n")

        top = data.get("screener", {}).get("top_summary", {})
        if top:
            f.write(f"\nSCREENER TOP RATIOS:\n")
            for k, v in top.items():
                f.write(f"  {k:30s}: {v}\n")

        analysis = data.get("screener", {}).get("screener_analysis", {})
        if analysis.get("strengths"):
            f.write(f"\nSTRENGTHS (Screener.in):\n")
            for s in analysis["strengths"]:
                f.write(f"  + {s}\n")
        if analysis.get("concerns"):
            f.write(f"\nCONCERNS (Screener.in):\n")
            for c in analysis["concerns"]:
                f.write(f"  - {c}\n")

        f.write(f"\nDATA FILES SAVED:\n")
        for p in sorted(output_dir.glob("*")):
            f.write(f"  {p.name}\n")

    print(f"  ✓ {summary_path}")


# ─────────────────────────────────────────────
# 9. MASTER PIPELINE
# ─────────────────────────────────────────────

def run_pipeline(
    ticker_nse: str,
    download_pdfs: bool = False,
    upload_s3: bool = False,
    s3_bucket: str | None = None,
    s3_prefix: str = "doc-scrapper",
):
    """Run the full collection pipeline for a single NSE ticker."""
    ticker = ticker_nse.upper().strip()
    print(f"\n{'━'*65}")
    print(f"  PIPELINE: {ticker}")
    print(f"{'━'*65}")

    output_dir = OUTPUT_DIR / ticker
    output_dir.mkdir(parents=True, exist_ok=True)

    # Check if fresh run needed (skip if data <6h old)
    master_json = output_dir / f"{ticker}_complete_data.json"
    if master_json.exists():
        age = datetime.now().timestamp() - master_json.stat().st_mtime
        if age < 6 * 3600:
            print(f"  [skip] data is {age/3600:.1f}h old (< 6h), use --force to refresh")
            if upload_s3 and s3_bucket:
                try:
                    upload_outputs_to_s3(ticker, output_dir, s3_bucket, s3_prefix=s3_prefix)
                except Exception as e:
                    print(f"  [s3-error] {ticker}: {e}")
            return

    combined = {
        "ticker":         ticker,
        "pipeline_run_at": datetime.now().isoformat(),
        "yfinance":       {},
        "screener":       {},
        "screener_export":{},
        "nse":            {},
        "bse":            {},
        "moneycontrol":   {},
    }

    # ── Layer 1: yfinance (quotes, financials, news) ──
    combined["yfinance"] = fetch_yfinance_data(ticker)

    # ── Layer 2: Screener.in HTML scrape (ratios, shareholding, AR links) ──
    combined["screener"] = fetch_screener_data(ticker)

    # ── Layer 3: Screener.in JSON export (structured financials) ──
    screener_export = fetch_screener_export(ticker)
    combined["screener_export"] = screener_export
    # Propagate BSE code if found
    bse_code = screener_export.get("bse_code_from_screener")

    # ── Layer 4: NSE public APIs ──
    combined["nse"] = fetch_nse_data(ticker)
    
    # Try to get BSE code from NSE API if not yet found
    if not bse_code:
        nse_info = combined["nse"].get("nse_company_info", {})
        # Sometimes ISIN is in the NSE data — use as fallback identifier
        # Try direct BSE lookup
        bse_code = get_bse_code_from_screener_export(screener_export) or bse_code

    # ── Layer 5: BSE public API ──
    combined["bse"] = fetch_bse_data(ticker, bse_code)

    # ── Layer 6: Moneycontrol (supplementary links) ──
    combined["moneycontrol"] = fetch_moneycontrol_data(ticker)

    # ── Save everything ──
    print(f"\n  Saving outputs…")
    save_outputs(ticker, combined, output_dir, download_pdfs=download_pdfs)

    if upload_s3 and s3_bucket:
        try:
            upload_outputs_to_s3(ticker, output_dir, s3_bucket, s3_prefix=s3_prefix)
        except Exception as e:
            print(f"  [s3-error] {ticker}: {e}")

    print(f"\n  ✅ Done: {ticker} → {output_dir}")
    return combined


def get_bse_code_from_screener_export(screener_export: dict) -> str | None:
    """Extract BSE code from screener export data."""
    return screener_export.get("bse_code_from_screener") or \
           screener_export.get("screener_json", {}).get("bse_code")


# ─────────────────────────────────────────────
# 10. MULTI-STOCK RUNNER + CLI
# ─────────────────────────────────────────────

def run_multi(
    tickers: list,
    download_pdfs: bool = False,
    delay_between: int = 8,
    upload_s3: bool = False,
    s3_bucket: str | None = None,
    s3_prefix: str = "doc-scrapper",
):
    """Run pipeline for multiple tickers with polite delays."""
    results_summary = []
    for i, ticker in enumerate(tickers, 1):
        print(f"\n[{i}/{len(tickers)}] Processing {ticker}…")
        try:
            run_pipeline(
                ticker,
                download_pdfs=download_pdfs,
                upload_s3=upload_s3,
                s3_bucket=s3_bucket,
                s3_prefix=s3_prefix,
            )
            results_summary.append({"ticker": ticker, "status": "success"})
        except KeyboardInterrupt:
            print("\n  Interrupted by user.")
            break
        except Exception as e:
            print(f"  [PIPELINE ERROR] {ticker}: {e}")
            results_summary.append({"ticker": ticker, "status": "error", "error": str(e)})
        
        if i < len(tickers):
            print(f"\n  Waiting {delay_between}s before next ticker…")
            time.sleep(delay_between)

    # Print run summary
    print(f"\n{'='*65}")
    print(f"  PIPELINE COMPLETE — {len(tickers)} stocks processed")
    print(f"{'='*65}")
    for r in results_summary:
        status_icon = "✅" if r["status"] == "success" else "❌"
        print(f"  {status_icon} {r['ticker']:20s} {r['status']}")
    print(f"\nAll output saved to: {OUTPUT_DIR.absolute()}")


def main():
    load_env_file()

    parser = argparse.ArgumentParser(
        description="India Equity Research Pipeline — collects all SEBI-mandated documents & data",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python india_equity_pipeline.py --tickers RELIANCE TCS HDFCBANK
  python india_equity_pipeline.py --tickers INFY --download-pdfs
  python india_equity_pipeline.py --nifty50
  python india_equity_pipeline.py --nifty50 --delay 15
        """
    )
    parser.add_argument("--tickers",       nargs="+", help="NSE ticker symbols, e.g. RELIANCE TCS")
    parser.add_argument("--nifty50",       action="store_true", help="Run for all Nifty 50 stocks")
    parser.add_argument("--download-pdfs", action="store_true", help="Download Annual Report PDFs (latest 3 years)")
    parser.add_argument("--delay",         type=int, default=8, help="Seconds to wait between tickers (default: 8)")
    parser.add_argument("--force",         action="store_true", help="Re-fetch even if recent data exists")
    parser.add_argument("--output-dir",    default="output", help="Output directory (default: output/)")
    parser.add_argument("--upload-s3",     action="store_true", help="Upload generated ticker files to S3")
    parser.add_argument("--s3-bucket",     default=os.getenv("S3_BUCKET"), help="S3 bucket name (or set S3_BUCKET env)")
    parser.add_argument("--s3-prefix",     default=os.getenv("S3_PREFIX", "doc-scrapper"), help="S3 key prefix (default: doc-scrapper)")
    args = parser.parse_args()

    global OUTPUT_DIR
    OUTPUT_DIR = Path(args.output_dir)

    if args.nifty50:
        tickers = NIFTY50_TICKERS
    elif args.tickers:
        tickers = [t.upper() for t in args.tickers]
    else:
        parser.print_help()
        print("\n  No tickers specified. Running demo with RELIANCE, TCS, INFY…\n")
        tickers = ["RELIANCE", "TCS", "INFY"]

    if args.force:
        # Remove cached files to force fresh fetch
        for ticker in tickers:
            cached = OUTPUT_DIR / ticker / f"{ticker}_complete_data.json"
            if cached.exists():
                cached.unlink()

    if args.upload_s3 and not args.s3_bucket:
        print("\n  [config-error] --upload-s3 requires --s3-bucket or S3_BUCKET in environment")
        sys.exit(1)

    run_multi(
        tickers,
        download_pdfs=args.download_pdfs,
        delay_between=args.delay,
        upload_s3=args.upload_s3,
        s3_bucket=args.s3_bucket,
        s3_prefix=args.s3_prefix,
    )


if __name__ == "__main__":
    main()