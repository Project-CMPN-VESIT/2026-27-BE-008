# FinPilot

FinPilot is an AI-assisted equity research and compliance platform.

It combines:
- A real-time market and charting web app (Next.js).
- A regulatory sanctions ingestion and screening backend (Python FastAPI in scrapper).
- A separate paper-trading microservice with AI mentor audit (Python FastAPI in paper-trading).
- A news-feed microservice for live BSE/NSE corporate announcements (Python FastAPI in news-feed).

## 1) Product Overview

FinPilot helps you research listed companies, monitor market behavior, screen against regulatory signals, and simulate thesis-based trades.

Core product areas:
- Dashboard: live indices, most-traded symbols, and symbol search.
- Advanced Chart Terminal: TradingView-based charting, technical overlays, pattern intelligence, and company snapshot.
- War Room: chat-style research workspace with quote context.
- SEBI Regulatory Shield: sanctions entity feed and screening interface.
- RK/PL Scoring: risk and profit/loss composite view.
- Disparity Alerts: market narrative vs filing-fact mismatch surface.
- Agent Council: simulated multi-agent debate with position framing.
- Paper Trading Crucible: virtual ledger + AI mentor gatekeeper.

## 2) Tech Stack

Frontend:
- Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4.
- lightweight-charts + TradingView wrapper.
- Recharts for scoring visualizations.

Backend services:
- scrapper: FastAPI + SQLite, requests/BeautifulSoup/XML parsing, Mistral extraction.
- paper-trading: FastAPI + SQLite, Mistral mentor critique.
- news-feed: FastAPI + SQLite, APScheduler, requests-based BSE/NSE scraping.

## 3) Feature Status

### Implemented now

- Live market overview pipeline:
  - Next API market-overview combines TradingView and NSE fallback data.
  - Incremental quote polling for indices and most-traded instruments.

- Advanced chart workflow:
  - Symbol search and market resolution.
  - Candlestick and line charts with range controls.
  - Technical metrics (SMA20/SMA50/RSI14).
  - Pattern intelligence module (breakout, reversal, divergence, support/resistance).
  - Fundamentals and financial snapshot enrichment from Screener parser.
  - Company snapshot from Wikipedia + Wikidata profile pipeline.

- Regulatory Shield backend and UI:
  - Source registry config for RBI and UN feeds.
  - RBI index/detail scraping with diff detection via content hash.
  - UN XML structured ingestion.
  - Regex extraction for PAN/DIN/CIN/date pre-pass.
  - Mistral extraction for semi-structured circular text.
  - Name variant generation and fuzzy matching.
  - Screening endpoint with exact-ID + fuzzy + booster scoring waterfall.
  - Entity list endpoint and one-click pipeline trigger endpoint.

- News Feed backend and proxy:
  - Dedicated microservice on port 8002.
  - NSE and BSE announcement scraping every 60 seconds.
  - SQLite dedupe via unique content_hash.
  - REST feed APIs for list, symbol view, health, and stats.
  - Next.js proxy route for frontend consumption with no-store fetch.

- Paper Trading Crucible:
  - Independent FastAPI service and local SQLite ledger.
  - Virtual cash, holdings, and journal tracking.
  - Server-side live execution price fetch before order execution.
  - Mentor critique endpoint using Mistral prompt.
  - Next.js proxy routes for portfolio, execute, and mentor.

- UX modules available in app:
  - War Room UI and quote-aware interaction shell.
  - RK/PL dashboard visual model.
  - Disparity alerts panel.
  - Agent Council simulation panel.

### To be implemented / hardening roadmap

- Replace currently curated/static UI datasets in Alerts, Scoring, and Council with fully dynamic backend data contracts.
- Extend source registry to more regulators (SEBI debarred feeds, OFAC, MCA, other watchlists).
- Add scheduler/orchestrator-grade pipeline automation and alerting (currently CLI-triggered/manual).
- Add advanced search infra from architecture plan (Elasticsearch/OpenSearch + vector store).
- Add auth and per-user tenancy for paper trading and research sessions.
- Add full tests (unit/integration/e2e) and CI pipeline quality gates.
- Add production observability: metrics, tracing, and stale-source alarms.

## 4) How It Works (End-to-End)

### Web app request flow

1. User opens dashboard on port 3000.
2. Frontend calls Next API routes in src/app/api.
3. Next API routes aggregate data from:
   - TradingView market data wrappers.
   - NSE fallback endpoints.
   - Screener fundamentals parser.
   - Wikipedia/Wikidata company profile loader.
   - Local paper-trading service (port 8001) for ledger actions.
  - Local news-feed service (port 8002) for corporate announcements.
   - Local scrapper service (port 8000) for regulatory entity feeds.
4. UI modules render and poll updates with no-store semantics for fresh values.

### Regulatory pipeline flow

1. scrapper/run.py executes scrape jobs.
2. Scrapers fetch raw RBI/UN records.
3. Raw records are deduped by SHA-256 content hash in DB.
4. Unprocessed records go through regex and optional LLM extraction.
5. Canonical entities + variants are stored in SQLite.
6. Screening API matches input records against stored entities and returns confidence breakdown.

### Paper trading flow

1. User submits thesis from frontend modal.
2. Mentor route requests critique from paper-trading microservice.
3. Execute route fetches live quote server-side, then posts trade request.
4. paper-trading service updates user balance, positions, and trade journal atomically.

## 5) Local Run Guide

Prerequisites:
- Node.js 20+
- Python 3.10+
- Optional: MISTRAL_API_KEY for mentor/extraction features

### Step A: Frontend

From repo root:

```bash
npm install
npm run dev
```

App URL:
- http://localhost:3000

### Step B: Regulatory backend (scrapper)

```bash
cd scrapper
pip install -r requirements.txt
python run.py serve
```

API URL:
- http://localhost:8000

Useful commands:

```bash
python run.py scrape --source all
python run.py extract
python run.py pipeline --source rbi --max 5
python run.py stats
```

### Step C: Paper trading backend

```bash
cd paper-trading
python run.py
```

API URL:
- http://localhost:8001

### Step D: News Feed backend

```bash
cd news-feed
pip install -r requirements.txt
python run.py
```

API URL:
- http://localhost:8002

Environment variables:

```env
MISTRAL_API_KEY=your_key_here
```

## 6) API Surface (Quick)

Next.js API routes (src/app/api):
- GET /api/market-overview
- GET /api/nse-stock
- GET /api/live-quote
- GET /api/tv-search
- GET /api/tv-quote
- GET /api/tv-chart
- GET /api/company-profile
- GET /api/news
- GET /api/paper-trading/portfolio
- POST /api/paper-trading/mentor
- POST /api/paper-trading/execute

scrapper service (port 8000):
- POST /v1/screen
- GET /v1/stats
- GET /v1/entities
- POST /v1/pipeline/run
- GET /health

paper-trading service (port 8001):
- POST /api/trade/execute
- GET /api/portfolio/{user_id}
- POST /api/mentor-audit

news-feed service (port 8002):
- GET /v1/news
- GET /v1/news/{symbol}
- GET /v1/stats
- GET /health

## 7) Full Project Structure And File Responsibilities

Note:
- The list below focuses on project-owned files.
- Runtime-generated artifacts are listed separately at the end.

### Root files

- .gitignore: ignore rules for node, Python, and build artifacts.
- README.md: master project documentation.
- FEATURES.md: detailed module-level feature notes.
- paper-trading.md: dedicated paper trading product note and runbook.
- package.json: frontend scripts and JS dependencies.
- package-lock.json: locked npm dependency graph.
- tsconfig.json: TypeScript compiler options and path aliases.
- eslint.config.mjs: ESLint setup for Next + TS.
- postcss.config.mjs: Tailwind PostCSS plugin wiring.
- next.config.ts: Next runtime/turbopack configuration.
- next-env.d.ts: Next.js type bootstrap file.

### Public assets

- public/next.svg: Next.js logo asset.
- public/vercel.svg: Vercel logo asset.
- public/file.svg: generic icon asset.
- public/window.svg: generic icon asset.
- public/globe.svg: generic icon asset.

### Frontend app shell and pages

- src/app/layout.tsx: root layout with ThemeProvider + Sidebar + TopBar shell.
- src/app/globals.css: global theme tokens, layout offsets, and utility animations.
- src/app/favicon.ico: app favicon.
- src/app/page.tsx: dashboard page with search, live indices, and most-traded board.
- src/app/chart/page.tsx: advanced chart terminal with range modes, overlays, and profile panel.
- src/app/war-room/page.tsx: CYRO research chat workspace UI and quote-aware sidecards.
- src/app/regulatory/page.tsx: SEBI Shield table view, filtering, source badges, and pipeline trigger.
- src/app/scoring/page.tsx: RK/PL scoring visualization page with radar and trend components.
- src/app/alerts/page.tsx: disparity alert monitoring interface and severity filtering.
- src/app/council/page.tsx: multi-agent council simulation UI and verdict timeline.
- src/app/paper-trading/page.tsx: paper portfolio dashboard with execution form and journal tabs.

### Next.js API routes

- src/app/api/market-overview/route.ts: combines index and most-traded feeds with NSE fallback.
- src/app/api/nse-stock/route.ts: resolves symbol and returns quote + short history payload.
- src/app/api/live-quote/route.ts: lightweight quote endpoint with fallback pricing.
- src/app/api/tv-search/route.ts: TradingView-backed symbol search endpoint.
- src/app/api/tv-quote/route.ts: live quote endpoint with index fallback cache path.
- src/app/api/tv-chart/route.ts: chart candles + technicals + screener snapshot + pattern intelligence.
- src/app/api/company-profile/route.ts: company snapshot endpoint using profile library.
- src/app/api/news/route.ts: proxy route for corporate announcements feed.
- src/app/api/paper-trading/portfolio/route.ts: proxy to paper-trading service portfolio endpoint.
- src/app/api/paper-trading/mentor/route.ts: proxy to mentor audit endpoint.
- src/app/api/paper-trading/execute/route.ts: server-side execution price + proxy trade execution.

### Components

- src/components/sidebar.tsx: collapsible left navigation and route highlighting.
- src/components/top-bar.tsx: sticky header with search affordance, notifications, theme toggle.
- src/components/theme-provider.tsx: wrapper around next-themes provider.
- src/components/theme-toggle.tsx: light/dark toggle control.
- src/components/TradingModal.tsx: thesis capture and mentor-gated trade confirmation modal.

### Shared frontend libraries and types

- src/lib/tradingview.ts: TradingView client wrapper for search, quote, and candle history with caching.
- src/lib/screener.ts: Screener.in fundamentals and financials parser with TTL cache.
- src/lib/company-profile.ts: Wikipedia + Wikidata company profile enrichment helper.
- src/lib/pattern-intelligence.ts: candle pattern detection, confidence stats, support/resistance computation.
- src/types/tradingview.d.ts: module declaration for TradingView wrapper package.

### scrapper service

- scrapper/run.py: CLI orchestrator for scrape/extract/serve/stats/pipeline commands.
- scrapper/requirements.txt: Python dependencies for scraper and API service.
- scrapper/plan.txt: long-form target architecture and roadmap plan.
- scrapper/walkthrough.md: implementation walkthrough and verification notes.

#### scrapper config

- scrapper/config/sources.json: source registry for RBI and UN inputs.

#### scrapper API package

- scrapper/api/__init__.py: package marker.
- scrapper/api/main.py: FastAPI app for screening, entity listing, stats, and pipeline trigger.

#### scrapper DB package

- scrapper/db/__init__.py: package marker.
- scrapper/db/schema.sql: SQLite schema for sources, raw records, entities, variants, runs, and trading tables.
- scrapper/db/database.py: DB manager for source registry, ingest records, entities, variants, and screening read models.

#### scrapper extraction package

- scrapper/extraction/__init__.py: package marker.
- scrapper/extraction/regex_extractor.py: deterministic PAN/DIN/CIN/date extraction.
- scrapper/extraction/name_variants.py: canonical/initial/surname-first variant generation.
- scrapper/extraction/mistral_extractor.py: LLM extraction with JSON schema and retry/backoff handling.
- scrapper/extraction/mentor_agent.py: mentor prompt helper used by API fallback endpoint.

#### scrapper scraper adapters

- scrapper/scrapers/__init__.py: package marker.
- scrapper/scrapers/rbi_scraper.py: RBI index/detail scraper with request jitter and hash dedupe.
- scrapper/scrapers/un_scraper.py: UN consolidated XML ingestion and canonical entity conversion.

### paper-trading microservice

- paper-trading/run.py: uvicorn bootstrap for port 8001 service.
- paper-trading/main.py: FastAPI endpoints for execute, portfolio, and mentor audit.
- paper-trading/database.py: SQLite ledger and journal operations.
- paper-trading/mentor_agent.py: Mistral mentor prompt/evaluation helper.

### news-feed microservice

- news-feed/run.py: uvicorn bootstrap for port 8002 plus DB init and scheduler startup.
- news-feed/main.py: FastAPI endpoints for health, feed list, symbol feed, and stats.
- news-feed/database.py: sqlite3 schema/init, dedup insert, feed query, and source stats.
- news-feed/scheduler.py: 60-second polling job that scrapes NSE/BSE and persists new rows.
- news-feed/requirements.txt: service dependencies (fastapi, uvicorn, requests, apscheduler).
- news-feed/scrapers/__init__.py: scraper package exports.
- news-feed/scrapers/nse.py: NSE corporate announcements fetch with cookie bootstrap + mapping.
- news-feed/scrapers/bse.py: BSE announcements fetch with DDMMYYYY date params + mapping.

### Runtime-generated / data artifacts

- scrapper/data/sanctions.db: local sanctions SQLite database file.
- paper-trading/paper_trading.db: local paper trading SQLite database file.
- news-feed/news.db: local announcements SQLite database file.
- scrapper/logs/: runtime log files for scraper runs.
- paper-trading/__pycache__/: Python bytecode cache.
- scrapper/db/__pycache__/: Python bytecode cache.

## 8) Current Maturity Notes

- The architecture and route wiring are strong and modular.
- Market + chart stack is functional with live quote pipelines.
- Compliance pipeline is working locally with real scraping and screening.
- Some intelligence pages still use curated datasets and should be connected to live backend contracts next.
