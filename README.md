# FinPilot

FinPilot is an AI-assisted equity research, trading, and compliance platform tailored for Indian markets.

It combines:
- A real-time market terminal and Next.js frontend web app.
- **CYRO Research Engine**: A multi-agent AI system with 7 specialized analysts, real-time debate, and retrieval-augmented generation (RAG) using live market data and SEC/NSE filings.
- A regulatory sanctions ingestion and screening backend (Python FastAPI).
- A paper-trading microservice with an AI mentor audit.
- A news-feed microservice for live BSE/NSE corporate announcements.

## 1) Product Overview

FinPilot helps you research listed companies, monitor market behavior, screen against regulatory signals, and simulate thesis-based trades.

Core product areas:
- **War Room (CYRO Research Engine)**: A chat-style research workspace with real-time Server-Sent Events (SSE) streaming. Features `@` mention ticker tagging, a multi-analyst Reasoning Mode (7 analysts debating Bull vs Bear cases), Explainable AI (XAI) source citations, animated scorecards, and persistent chat sessions.
- **Market Flow Intelligence**: Live right-panel dashboards in the War Room showing FII/DII flows, India VIX, Options data (PCR, Max Pain, IV Rank), and RAG index freshness.
- **Advanced Chart Terminal**: TradingView-based charting, technical overlays, pattern intelligence, and company snapshot.
- **SEBI Regulatory Shield**: Sanctions entity feed and screening interface.
- **RK/PL Scoring**: Risk and profit/loss composite view.
- **Paper Trading Crucible**: Virtual ledger + AI mentor gatekeeper.

## 2) Tech Stack

**Frontend**:
- Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4.
- Server-Sent Events (SSE) parsing for real-time agentic UI updates.
- lightweight-charts + TradingView wrapper.
- Recharts for scoring visualizations.

**Backend services**:
- `india-trade-cli` (CYRO Engine): FastAPI, Mistral API (via `mistralai`), ChromaDB for RAG, `yfinance`, `nsetools`. Orchestrates 7 concurrent AI analysts and streams debate progress.
- `scrapper`: FastAPI + SQLite, requests/BeautifulSoup/XML parsing, Mistral extraction.
- `paper-trading`: FastAPI + PostgreSQL, Firebase-authenticated user accounts and Mistral mentor critique.
- `news-feed`: FastAPI + SQLite, APScheduler, requests-based BSE/NSE scraping.

## 3) Feature Status

### CYRO Multi-Agent Research Engine & War Room
- **Reasoning Mode**: Fully wired 7-analyst team (`Technical`, `Fundamental`, `Options`, `News`, `Sentiment`, `Sector`, `Risk`) executing in parallel, followed by a simulated Bull vs Bear debate and a Facilitator synthesis.
- **Real-time UI**: Driven by Server-Sent Events (SSE). Renders `analyst_start`, `scorecard`, `debate_round`, `rebuttal`, `facilitator`, and `final_decision` events dynamically in message bubbles.
- **Explainable AI (XAI)**: Tool execution is transparently recorded via a `TrackedToolRegistry` and rendered as Source Citation cards (e.g., "Screener.in + Yahoo Finance").
- **RAG Pipeline**: Semantic search over S3-hosted JSON/CSV/PDF financial documents using ChromaDB. Auto-injects ticker-specific context into the LLM synthesis.
- **Ticker Tagging**: `@` mention detection with a dynamic Nifty 50 picker dropdown.
- **Session Persistence**: CYRO chat history and sessions are stored server-side in PostgreSQL and scoped to the signed-in Firebase user.
- **Market Intelligence**: Live background-polled data integration for FII/DII netflows, Options analytics, and RAG freshness.

### Live Market Overview & Charts
- Symbol search and market resolution.
- Candlestick and line charts with range controls.
- Technical metrics (SMA20/SMA50/RSI14) and pattern intelligence module (breakout, reversal, divergence, support/resistance).
- Fundamentals and financial snapshot enrichment from Screener parser.

### Regulatory Shield backend and UI
- Source registry config for RBI and UN feeds.
- RBI index/detail scraping with diff detection via content hash.
- UN XML structured ingestion.
- Regex extraction for PAN/DIN/CIN/date pre-pass and Mistral extraction for semi-structured text.
- Screening endpoint with exact-ID + fuzzy + booster scoring waterfall.

### Paper Trading Crucible
- Independent FastAPI service and PostgreSQL ledger scoped to authenticated Firebase users.
- Virtual cash, holdings, and journal tracking.
- Server-side live execution price fetch before order execution.
- Mentor critique endpoint using Mistral prompt.

## 4) How to Use

### Step A: Prerequisites & Environment Setup
- Node.js 20+
- Python 3.10+
- Mistral API Key (`MISTRAL_API_KEY`)

Create a `.env` file in the root (`FinPilot/.env`):
```env
MISTRAL_API_KEY=your_key_here
INDIA_TRADE_CLI_URL=http://localhost:8765
AWS_ACCESS_KEY_ID=your_aws_access_key
AWS_SECRET_ACCESS_KEY=your_aws_secret_key
AWS_DEFAULT_REGION=ap-southeast-2
S3_BUCKET=finpilot-doc-scrapper
S3_PREFIX=doc-scrapper
```

### Step B: Running the Frontend

From the `FinPilot` directory:
```bash
npm install
npm run dev
```
App URL: http://localhost:3000

### Step C: Running the CYRO Engine Backend (`india-trade-cli`)

This service powers the War Room, reasoning mode, and real-time market data.

From the `india-trade-cli` directory:
```bash
pip install -r requirements.txt
python -m web.api
```
API URL: http://localhost:8765

**Using the War Room:**
1. Navigate to **War Room** in the frontend sidebar.
2. Ensure the "Deep Reasoning" toggle is ON.
3. Type `@` in the chat to open the ticker picker. Select a stock (e.g., `@INFY`).
4. Ask a question: *"What is the long-term outlook for this stock?"*
5. Watch the real-time SSE stream as 7 analysts investigate, debate, and deliver a final synthesis with trade plans and source citations.

*(Optional)* **Indexing documents for RAG:**
From the `india-trade-cli` directory:
```bash
python scripts/index_s3_docs.py --ticker INFY
```

### Step D: Running Auxiliary Services (Optional)

**Regulatory Backend (scrapper):**
```bash
cd doc_Scrapper
pip install -r requirements.txt
python run.py serve
```

**Paper Trading Backend:**
```bash
cd paper-trading
python run.py
```

**News Feed Backend:**
```bash
cd news-feed
pip install -r requirements.txt
python run.py
```

## 5) Architecture Overview (CYRO Engine)

```text
User types "@INFY What do you think?"
        │
        ▼
War Room input → @ picker → taggedTicker = "INFY"
        │
        ▼
Next.js route.ts → EventSource proxy → india-trade-cli FastAPI (port 8765)
        │
        ▼
cyro_skill.py /_run_reasoning_analysis()
  ├─ RAG: search_financial_docs → ChromaDB → Mistral embeddings
  ├─ CyroMultiAgentAnalyzer (7 parallel analysts)
  │   ├─ TechnicalAnalyst     → NSE charts, S/R levels
  │   ├─ FundamentalAnalyst   → Screener.in + yFinance
  │   ├─ OptionsAnalyst       → PCR, OI, max pain
  │   ├─ NewsMacroAnalyst     → RSS feeds + Mistral sentiment
  │   ├─ SentimentAnalyst     → social signals
  │   ├─ SectorRotationAnalyst→ NSE sector indices
  │   └─ RiskManager          → drawdown, volatility
  ├─ Bull/Bear Debate (5 Mistral calls)
  ├─ compute_scorecard(reports) → AnalystScorecard
  └─ Fund Manager synthesis → final_decision
        │
        ▼ SSE events
War Room: analyst pills → scorecard card → debate cards → trade plans → signal badge
        │
        ▼
Firebase Auth → verified API identity → PostgreSQL user-owned chat history
```
