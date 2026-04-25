# India Equity Research Pipeline

A fully automated Python pipeline to collect every major document and data
point for BSE/NSE listed companies — no paid API key required.

---

## What it collects

| # | Document / Data | Source | Cadence |
|---|----------------|--------|---------|
| 1 | Company profile, description, sector | yfinance | Live |
| 2 | Live quote, 52W high/low, volume, market cap | yfinance | Live |
| 3 | Key metrics: PE, PB, EV/EBITDA, Beta, ROE, ROA | yfinance | Live |
| 4 | Annual P&L, Balance Sheet, Cash Flow | yfinance + Screener.in | Annual |
| 5 | Quarterly P&L, Balance Sheet, Cash Flow | yfinance + Screener.in | Quarterly |
| 6 | 10-year ratio history: ROCE, ROE, EPS, D/E, OPM | Screener.in | Annual |
| 7 | Shareholding pattern (Promoter/FII/DII/Public) | Screener.in + NSE | Quarterly |
| 8 | Corporate announcements (Reg 30 disclosures) | NSE + BSE | Real-time |
| 9 | Annual Report PDF links (with optional download) | Screener.in + BSE | Annual |
| 10 | Investor presentations (slide decks) | BSE (via announcements) | Quarterly |
| 11 | Corporate actions (dividends, bonus, splits, rights) | NSE | As declared |
| 12 | Board meeting dates & agenda | NSE | As scheduled |
| 13 | Financial results XBRL/PDF filing links | NSE | Quarterly |
| 14 | Insider trading disclosures (PIT/SAST) | NSE | Real-time |
| 15 | 2-year daily OHLCV price history | yfinance | Daily |
| 16 | Analyst recommendations | yfinance | Periodic |
| 17 | Dividends & stock split history | yfinance | Historical |
| 18 | Recent news headlines | yfinance | Live |
| 19 | Peer comparison table | Screener.in | Live |
| 20 | Strengths & concerns (Screener analysis) | Screener.in | Live |
| 21 | Moneycontrol ID & link | Moneycontrol | Reference |
| 22 | BSE code mapping | Screener.in JSON API | Reference |

---

## Output structure

```
output/
└── RELIANCE/
    ├── RELIANCE_complete_data.json       # All data combined (master file)
    ├── RELIANCE_summary.txt              # Human-readable summary report
    ├── RELIANCE_ratios.csv               # 10-year key ratios table
    ├── RELIANCE_quarterly_results.csv    # Quarterly P&L history
    ├── RELIANCE_shareholding.csv         # Quarterly shareholding pattern
    ├── RELIANCE_announcements.csv        # Corporate announcements
    ├── RELIANCE_insider_trading.csv      # Insider buy/sell disclosures
    ├── RELIANCE_corporate_actions.csv    # Dividends, bonus, splits
    ├── RELIANCE_historical_prices.csv    # 2-year daily OHLCV
    ├── RELIANCE_annual_report_links.txt  # AR PDF URLs (one per line)
    └── annual_reports/                   # PDFs (if --download-pdfs used)
        ├── RELIANCE_AR_2023-24.pdf
        └── RELIANCE_AR_2022-23.pdf
```

---

## Installation

```bash
pip install -r requirements.txt
```

---

## Usage

```bash
# Single stock
python india_equity_pipeline.py --tickers RELIANCE

# Multiple stocks
python india_equity_pipeline.py --tickers RELIANCE TCS HDFCBANK INFY ICICIBANK

# All Nifty 50 stocks (takes ~20-30 minutes with polite delays)
python india_equity_pipeline.py --nifty50

# Download Annual Report PDFs (latest 3 years)
python india_equity_pipeline.py --tickers RELIANCE --download-pdfs

# Run Nifty50 and upload all ticker outputs to S3
python india_equity_pipeline.py --nifty50 --upload-s3 --s3-bucket finpilot-doc-scrapper --s3-prefix doc-scrapper

# Force refresh (ignore cached data)
python india_equity_pipeline.py --tickers RELIANCE --force

# Custom output directory
python india_equity_pipeline.py --tickers RELIANCE --output-dir /data/equity_research

# Custom delay between tickers (seconds)
python india_equity_pipeline.py --nifty50 --delay 15

# Upload to S3 using bucket from environment variable S3_BUCKET
python india_equity_pipeline.py --nifty50 --upload-s3
```

### S3 environment variables

Set these before running with `--upload-s3`:

```bash
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_DEFAULT_REGION=ap-southeast-2
S3_BUCKET=finpilot-doc-scrapper
S3_PREFIX=doc-scrapper
```

Uploads are written to:

- `doc-scrapper/latest/<TICKER>/...` (latest snapshot used by FinPilot)
- `doc-scrapper/raw/<YYYY-MM-DD>/<TICKER>/...` (dated archive snapshots)

---

## Data sources & approach

### Layer 1: yfinance (Yahoo Finance)
- No API key needed
- Covers: quotes, fundamentals, financial statements, historical prices,
  analyst recommendations, dividends, splits, news
- NSE tickers are used as `{SYMBOL}.NS` format

### Layer 2: Screener.in HTML scrape
- Public data, no login required for most metrics
- Covers: 10-year ratio history, quarterly results, shareholding pattern,
  annual report PDF links, peer comparison, management insights

### Layer 3: Screener.in JSON API
- Undocumented but public endpoint
- Returns machine-readable BSE code, ISIN, and structured financial data

### Layer 4: NSE public JSON endpoints
- NSE's own website endpoints (used by nseindia.com frontend)
- Covers: live quote, corporate actions, board meetings, shareholding,
  XBRL financial results, insider trading (PIT), announcements

### Layer 5: BSE public API
- BSE's unauthenticated API endpoints
- Covers: corporate announcements with categories, annual report PDFs,
  shareholding pattern details

### Layer 6: Moneycontrol
- Used for supplementary ID resolution and links

---

## Rate limiting & etiquette

The pipeline includes built-in polite delays:
- 2–4 seconds between API calls within a ticker
- 8 seconds (configurable via `--delay`) between tickers
- Automatic retry with exponential backoff on 429 errors
- Rotating User-Agent headers

For large batches (100+ stocks), increase `--delay` to 15-20 seconds.

---

## Adding more sources

The pipeline is modular. To add a new source:

1. Create a `fetch_<source>_data(ticker)` function returning a dict
2. Call it in `run_pipeline()` and add the result to `combined`
3. Add CSV export logic in `save_outputs()` if needed

Suggested additions:
- `trendlyne.com` — promoter pledge data, corporate governance scores
- `tickertape.in` — mutual fund holding details
- SEBI EDIFAR — XBRL-structured financial filings
- Company IR pages (individual scrapers per company for concall transcripts)

---

## Disclaimer

This tool collects publicly available data for research and educational purposes.
All data belongs to the respective exchanges and data providers.
Not financial advice. Verify all data before making investment decisions.