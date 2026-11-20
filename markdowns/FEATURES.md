# FinPilot — Features Implemented

FinPilot is a comprehensive financial intelligence and regulatory screening platform combining a real-time market dashboard with an AI-driven sanctions and regulatory screening engine. This document outlines all features currently implemented.

---

## Table of Contents

1. [Frontend Dashboard](#frontend-dashboard)
2. [Intelligence Modules](#intelligence-modules)
3. [Paper Trading System](#paper-trading-system)
4. [Regulatory Sanctions Engine](#regulatory-sanctions-engine)
5. [API Routes & Backend Services](#api-routes--backend-services)
6. [Technical Stack](#technical-stack)

---

## Frontend Dashboard

Built with **Next.js 15**, **React 19**, **TailwindCSS v4**, and modern charting libraries for an institutional-grade interface.

### Core Features

#### 1. **Live Market Dashboard (Home/Page.tsx)**
- Real-time search functionality for NSE/BSE stocks with intelligent exchange prioritization
- Autocomplete suggestions for stock symbols with company names
- Deduplication logic to prefer NSE listings over BSE equivalents
- Interactive search interface with suggestion filtering
- Market overview integration

#### 2. **Advanced Charting (Chart Page)**
- Integration with **TradingView Lightweight Charts** for high-performance stock charts
- Integration with **@mathieuc/tradingview** for professional trading views
- Real-time chart updates with live price feeds
- Multiple chart types and timeframe support
- Technical indicator support
- Responsive chart rendering

#### 3. **Theme Management**
- Light/Dark mode toggle with persistent theme storage via `next-themes`
- System preference detection
- Smooth theme transitions across all components

#### 4. **UI Components**
- **Sidebar Navigation**: Core navigation with collapsible menu
- **Top Bar**: Header with user controls and status indicators
- **Theme Toggle**: Light/dark mode switcher
- **Trading Modal**: Modal for trade execution and order management

---

## Intelligence Modules

FinPilot provides five specialized intelligence modules accessible from the dashboard:

### 1. **War Room (AI Analysis Hub)**
- **Purpose**: Source-backed AI analysis of market movements and company fundamentals
- **Features**:
  - Chat-based interface with multi-turn conversation support
  - Real-time quote integration showing live stock prices alongside analysis
  - Conversation history with session management
  - Session tagging system ("Bullish", "Bearish", "Neutral")
  - Message reaction system (thumbs up/down for feedback)
  - Bookmark support for important analyses
  - Content sharing and copying capabilities
  - File attachment support for document analysis
  - Mic input for voice queries
  - Refresh capability for generating new analyses

### 2. **SEBI Shield (Regulatory Integrity Checks)**
- **Purpose**: Automated sanctions and regulatory screening against multiple sources
- **Features**:
  - Fast entity lookup against curated regulatory databases
  - PAN/DIN/CIN number matching
  - Name-based fuzzy matching with variant expansion
  - Confidence scoring for matches
  - Results display showing entity details, source, and links to circulars
  - Filter by regulatory source
  - Batch screening capability (supports up to 2,000 records)

### 3. **RK/PL Scores (Risk & Profit Analysis)**
- **Purpose**: Quantitative scoring of company risk and profitability potential
- **Features**:
  - **RK (Risk) Score**: Composite metric including:
    - Leverage analysis
    - Audit risk assessment
    - Regulatory flags detection
    - Promoter pledge monitoring
    - Related-party transaction analysis
  - **PL (Profit-Loss) Score**: Composite metric including:
    - Revenue trends analysis
    - Margin quality assessment
    - Cash flow health
    - Return on equity (ROE)
    - Debt service capacity
  - Visual scoring dashboard with:
    - Radial bar charts for score visualization
    - Trend indicators (up/down/stable)
    - Period-over-period change metrics
    - Radar charts showing component breakdown
    - Historical score trend lines
  - Hover tooltips with detailed explanations

### 4. **Disparity Alerts (Market Mismatch Detection)**
- **Purpose**: Identifies discrepancies between market sentiment and fundamental filing data
- **Features**:
  - Real-time alert system monitoring market hype vs. official filings
  - Severity leveling (critical, high, medium, low)
  - Dual-source comparison:
    - Market hype metrics (sentiment, media source, news headline)
    - Official facts (regulatory metrics, filing data, official details)
  - Disparity scoring algorithm quantifying the gap
  - Trading recommendations based on disparity analysis
  - Filing reference links to source documents
  - Alert filtering by severity and company
  - Search across alerts
  - Bell/alert notification system
  - Timestamp tracking for alert recency

### 5. **Agent Council (Multi-Agent Debate)**
- **Purpose**: Multi-agent AI debate system simulating institutional investment committee
- **Features**:
  - Three specialized AI agent roles:
    - **Scout Agent**: Source discovery and data gathering
    - **Analyst Agent**: Fundamental analysis and metrics interpretation
    - **Risk Agent**: Risk assessment and caution signals
  - Real-time debate interface showing concurrent agent messages
  - Play/Pause/Reset controls for debate sessions
  - Terminal-style output for technical details
  - Live portfolio position tracking:
    - Current holdings with quantity and average price
    - Real-time P&L calculations
    - Weighted portfolio metrics
  - Agent verdict system with final recommendations
  - Position-specific debate context
  - Message categorization (analysis, debate, verdict, system)

---

## Paper Trading System

A complete virtual trading environment with AI mentorship and reflection logging, running as an independent microservice on port 8001.

### Core Features

#### **Virtual Trading Ledger**
- Starting virtual balance: ₹1,000,000 (1 million rupees)
- Real-time balance tracking:
  - Available cash calculation
  - Current holdings inventory
  - Average buy price tracking per position
  - Realized P&L from closed positions
  - Unrealized P&L from open positions
- Order execution with live NSE market prices
- Position management and exit functionality

#### **AI Mentor Gatekeeper (Mistral Integration)**
- **Pre-Trade Validation**:
  - Evaluates user trading thesis against fundamental metrics
  - Cross-references against RK/PL Disparity Scores
  - Uses Warren Buffett's margin of safety framework
  - Can reject under-thesis trades or suggest modifications
- **Intelligent Feedback**: Provides reasoning for approvals/rejections

#### **Reflection Journal**
- Comprehensive trade logging capturing:
  - Trade details (entry, exit, quantity, price)
  - User's original trading thesis
  - AI mentor's evaluation and feedback
  - Execution details and fills
  - Trade outcome and P&L
- Post-trade analysis capability
- Historical trade review system
- Performance attribution tracking

#### **Backend Services**
- **FastAPI** server handling order execution
- **SQLite database** (`paper_trading.db`) for ledger and journal storage
- Isolated from main application scraper (port 8001 vs 8000)
- Modular microservice architecture

---

## Regulatory Sanctions Engine

A sophisticated, production-grade Python backend for ingesting and screening regulatory data against multiple government sources.

### Architecture Overview

**Two-Pipeline Design**:
- **Ingestion Pipeline**: Slow, AI-heavy, runs once daily
- **Serving Pipeline**: Ultra-fast, pre-indexed, handles real-time API calls
- Decoupled to ensure system resilience and high throughput

### 1. **Multi-Source Data Ingestion**

#### Source Registry System
- Central configuration store for all data sources
- Zero-code-change extensibility:
  - Add new sources by updating registry row
  - Support for SEBI, RBI, UN, OFAC, MCA, and custom sources
  - Dynamic scheduling via cron expressions
- Per-source configuration includes:
  - Source ID, URL/file path
  - Format type (html_table, pdf_index, csv_direct, xml_direct, excel_direct)
  - Field mapping configuration
  - Publishing regulatory body metadata
  - Scraping strategy hints

#### Automated Scrapers
- **UN Consolidated Sanctions**: XML format ingestion with schema mapping
- **RBI Circulars**: HTML table extraction from regulatory pages
- **Extensible Adapter Pattern**: Easy addition of new sources

#### Resilience Features
- **Rate Limit Handling**: Exponential backoff for HTTP 429/503 responses
- **Anti-Blocking Strategy**:
  - Randomized scrape timing (±2 hour windows)
  - User agent rotation
  - Request jitter (2–8 seconds between requests)
  - Residential proxy rotation for datacenter-blocked sites
  - Respectful crawl delays
- **Dead-Letter Alerts**: Slack/email alerts if source fails 3 consecutive days
- **Diff Detection**: SHA-256 content hashing eliminates redundant processing

### 2. **AI-Powered Data Extraction**

#### Three-Stage Extraction Pipeline

**Stage 1: Regex Pre-Pass (Fast, Deterministic)**
- Extracts structured identifiers without LLM:
  - **PAN**: `[A-Z]{5}[0-9]{4}[A-Z]` pattern
  - **DIN**: 8-digit pattern
  - **CIN**: `L/U + 5digits + state + company_type + 6digits` format
- Deterministic, cost-free, zero hallucination

**Stage 2: LLM Structured Extraction (Mistral AI)**
- Surgical use of Mistral Small for genuinely ambiguous fields:
  - Name extraction from unstructured text
  - Sanction dates buried in legal prose
  - Circular references in regulatory documents
  - Country inference
- **Strict Schema Output**: JSON structure enforces consistency
- **Confidence Scoring**: Per-field confidence tracking (0.0–1.0)
  - Clean HTML table extracts: 0.98 confidence
  - Garbled PDF scans: 0.71 confidence
- **Conservative Defaults**: `null` for uncertain fields rather than guesses

**Stage 3: Name Variant Generation**
- Automatic expansion of name variants for fuzzy matching:
  - Canonical form: `Ramesh Kumar Sharma`
  - Initials form: `R. K. Sharma`
  - Surname-first: `Sharma, Ramesh Kumar`
  - Transliteration alternates: `Suresh`/`Suresh Kumar`/`S. Kumar`
- All variants indexed for comprehensive matching

#### 11-Field Entity Schema
| Field | Source | Extraction Method | Notes |
|-------|--------|-------------------|-------|
| Name | Regulatory text | LLM + variants | Store all variants, not just canonical |
| DIN | Regulatory ID | Regex | 8-digit pattern, deterministic |
| CIN | Corporate ID | Regex | Known format, fully deterministic |
| PAN | Tax ID | Regex | `AAAAA9999A` pattern |
| Date of Birth | Regulatory text | LLM + normalization | Normalized to ISO 8601 |
| Country | Source config/text | Config fallback + LLM | Often implied by source |
| Circular Number | Regulatory text | LLM | Often mid-sentence, LLM robust |
| Date of Publish | Scraper metadata | From index page | Not extracted from body |
| Sanction Start Date | Regulatory text | LLM | Phrased as "with effect from..." |
| Sanction End Date | Regulatory text | LLM | Null for indefinite sanctions |
| Link to Circular | Scraper metadata | Extracted URL | Source document reference |

### 3. **FastAPI Screening Endpoint**

#### Batch Screening API
- **Endpoint**: `POST /v1/screen`
- **Batch Capacity**: Up to 2,000 records per request
- **Input Fields**: Name, Company Name, DIN, CIN, PAN, Date of Birth, Country
- **Response Time**: ~168ms per batch
- **Threshold Parameter**: Configurable match confidence (default 0.75)
- **Include Cleared Flag**: Toggle to show previously sanctioned, now-cleared entities

#### No-N+1 Matching Strategy
- Single Elasticsearch `_msearch` query for entire batch
- One HTTP round-trip for 1,000+ results
- Parallel matching across three strategies simultaneously

#### Three-Strategy Scoring Waterfall

**1. Exact ID Matching**
- Keyword lookups on PAN, DIN, CIN
- Immediate confidence: 1.0 if matched
- No further scoring required

**2. Fuzzy Name Matching**
- Elasticsearch trigram matching with `fuzziness: AUTO`
- Matches typos, missing middle names, minor transliteration differences
- Raw ES relevance score normalized to 0–1
- Confidence capped at 0.95 (prevents name-only false positives)

**3. Vector Semantic Search**
- Embedding-based similarity in pgvector/Qdrant
- Catches deep transliteration mismatches
- Handles alternate-script variants
- Cosine similarity threshold filtering

#### Security & Accuracy
- **Composite Score Aggregation**: Weighted combination of three strategies
- **Confidence Boosters**: Secondary fields (DOB, Country) boost final score
- **Conservative Thresholding**: Name-only matches capped at safe confidence levels
- **Full Audit Logging**: Every screening request logged with results

### 4. **Data Storage & Indexing**

#### PostgreSQL (Source of Truth)
- Canonical entity records with all 11 fields
- Source registry configuration
- Content hash table for diff detection
- Comprehensive audit log of all ingestion runs
- Computed `sanction_status` field:
  - `ACTIVE`: Current sanctions
  - `EXPIRED`: Term-limited sanctions ended
  - `PREVIOUSLY_SANCTIONED_CLEARED`: Historical clearance
- **Extension**: `pg_trgm` for trigram fuzzy matching at scale

#### Elasticsearch / OpenSearch (Query Index)
- Mirrored entity data after PostgreSQL upsert
- Name variants as searchable `text` field with n-gram analysis
- PAN/DIN/CIN as `keyword` fields for exact matching
- DOB and country as filter fields
- Optimized for bulk `_msearch` queries
- Handles 1000+ entities reliably

#### pgvector / Qdrant (Semantic Vector Store)
- Name and company name embeddings generated at ingest time
- Cosine similarity search for variant matching
- Handles transliteration and script variations
- Solves alternate-form entity matching

#### Write Order & Resilience
- Primary: PostgreSQL write (source of truth)
- Secondary: Elasticsearch sync
- Tertiary: Vector store sync
- Reconciliation job re-syncs ES/vector from Postgres on failures
- API reads only from ES/vector (never Postgres at query time)

---

## API Routes & Backend Services

### Next.js API Routes

#### Stock & Market Data
- **`/api/nse-stock`**: NSE stock listing and metadata
- **`/api/live-quote`**: Real-time stock quote data with bid/ask spreads
- **`/api/market-overview`**: Aggregate market indices and trends
- **`/api/tv-quote`**: TradingView quote integration
- **`/api/tv-chart`**: TradingView chart data interface
- **`/api/tv-search`**: TradingView stock symbol search

#### Paper Trading APIs
- **`/api/paper-trading/portfolio`**: Portfolio position and balance retrieval
- **`/api/paper-trading/execute`**: Order execution with price validation
- **`/api/paper-trading/mentor`**: AI mentor evaluation of trades

### Python Backend APIs (Regulations Scrapper)

#### Entity Management
- **`GET /v1/entities`**: List all scraped regulatory entities with pagination
  - Supports page size and filtering parameters
  - Returns entity details with IDs, DIN/PAN/CIN, publication dates, source links

#### Screening & Matching
- **`POST /v1/screen`**: Batch entity screening with high-performance matching
  - Accepts up to 2,000 records per request
  - Returns match status, confidence scores, and linked entities
  - ~168ms response time typical

#### Data Ingestion CLI
- **`python run.py scrape --source [un|rbi]`**: Manual scraper execution
- **`python run.py extract`**: Trigger AI extraction pipeline
- **`python run.py serve`**: Start FastAPI screening service

---

## Technical Stack

### Frontend Stack
- **Framework**: Next.js 16.1.6 with React 19.2.3
- **Styling**: Tailwind CSS 4.x with PostCSS
- **Charting**: 
  - `lightweight-charts` 5.1.0 (high-performance real-time charts)
  - `@mathieuc/tradingview` 3.5.2 (TradingView integration)
  - `recharts` 3.7.0 (statistical visualizations)
- **UI Icons**: lucide-react 0.576.0 (modern icon library)
- **Theme Management**: next-themes 0.4.6 (light/dark mode)
- **Language**: TypeScript 5.x

### Backend Stack
- **Primary Server**: FastAPI 0.110.0 (Python async API framework)
- **Web Server**: Uvicorn 0.27.0 (ASGI)
- **Data Validation**: Pydantic 2.0.0 (strict schema validation)
- **Database**: SQLite (local datastore), PostgreSQL (production-ready)
- **Search**: Elasticsearch / OpenSearch (full-text and fuzzy matching)
- **Vector Search**: pgvector or Qdrant (semantic similarity)
- **Scraping**:
  - `requests` 2.31.0 (HTTP client)
  - `beautifulsoup4` 4.12.0 (HTML parsing)
  - `lxml` 5.0.0 (XML parsing)
  - `Playwright` (headless browser for JS-rendered content)
  - `pdfplumber` / `pymupdf` (PDF text extraction)
- **AI Integration**: `mistralai` 1.0.0 (Mistral Small LLM)
- **Fuzzy Matching**: 
  - `thefuzz` 0.22.0 (fuzzy string matching)
  - `python-Levenshtein` 0.25.0 (string distance algorithms)
- **Environment**: python-dotenv 1.0.0 (configuration management)
- **Language**: Python 3.9+ with type hints

### Development Tools
- **Linting**: ESLint 9.x with Next.js config
- **Build Tool**: Turbopack (integrated with Next.js 16)
- **Package Manager**: npm (Node.js dependencies)

---

## Key Architectural Principles

### 1. **Separation of Concerns**
- **Data Pipeline**: Slow, AI-heavy ingestion (daily)
- **Serving Pipeline**: Ultra-fast, pre-indexed queries (real-time)
- Prevents blocking between processes

### 2. **Resilience & Reliability**
- Exponential backoff on network errors
- Dead-letter alerts for source failures
- Content diff detection eliminates reprocessing
- Audit logging for full traceability

### 3. **AI Used Surgically**
- Regex for deterministic identifiers (fast, free)
- LLM only for genuinely ambiguous fields (cost-conscious)
- Confidence scoring throughout pipeline
- Conservative thresholding prevents false positives

### 4. **Scalability**
- Batch processing supports 1,000+ entities per request
- Index-based querying eliminates N+1 problems
- Horizontal scaling via stateless API servers
- SQLite for development, PostgreSQL for production scale

### 5. **Extensibility**
- Registry-driven source configuration (add sources without code changes)
- Adapter pattern for scraper formats
- Clean module boundaries (scraper, extraction, db, api)

---

## Current Status & Limitations

### Implemented ✅
- ✅ Full frontend dashboard with 5 intelligence modules
- ✅ Live market data integration (NSE/BSE)
- ✅ Advanced charting with TradingView integration
- ✅ Paper trading ledger and mentor system
- ✅ Multi-source regulatory data ingestion (UN, RBI)
- ✅ AI-powered entity extraction pipeline
- ✅ High-performance batch screening API
- ✅ Fuzzy matching and semantic search foundation
- ✅ Complete audit logging and reconciliation

### In Development / Planned 🚧
- Additional regulatory sources (SEBI, OFAC, MCA, IRDAI)
- Vector store production deployment (pgvector/Qdrant)
- Distributed queue for scraper orchestration (Airflow/Step Functions)
- Enhanced transliteration handling across scripts
- Advanced portfolio risk analytics
- Real-time news sentiment integration
- Automated trade signal generation

---

## Getting Started

### Frontend
```bash
npm install
npm run dev
```
Open [http://localhost:3000](http://localhost:3000)

### Backend (Regulatory Sanctions API)
```bash
cd scrapper
pip install -r requirements.txt
python run.py serve
```
API available at `http://localhost:8000`

### Paper Trading Backend
```bash
cd paper-trading
pip install -r requirements.txt
python run.py
```
API available at `http://localhost:8001`

---

**Last Updated**: March 2026  
**Architecture**: Dual-pipeline with decoupled ingestion and serving  
**Performance Target**: ~168ms batch screening, sub-100ms live quotes
