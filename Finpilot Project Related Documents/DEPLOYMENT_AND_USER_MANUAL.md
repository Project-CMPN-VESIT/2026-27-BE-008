# FinPilot: Deployment Report and User Manual
**Department of Computer Engineering | Vivekanand Education Society's Institute of Technology (VESIT)**  
*Capstone Project–II (26CMCP71) | Academic Year 2026–27*

---

### Project Metadata & Institutional Details
* **Project Title**: FinPilot: AI-Driven Equity Research and Investment Platform
* **Project Group No.**: Group 8 (Class: D17B)
* **Team Members**:
  * Soham Kamathi (Roll No. 25 | `2023.soham.kamathi@ves.ac.in`)
  * Gaurang Gade (Roll No. 17 | `2023.gaurang.gade@ves.ac.in`)
  * Shivam Jha (Roll No. 22 | `2023.shivam.jha@ves.ac.in`)
  * Gaurav Khutwal (Roll No. 28 | `2023.gaurav.khutwal@ves.ac.in`)
* **Project Mentor / Guide**: Dr. Sujata Khedkar, Associate Professor, Department of Computer Engineering, VESIT
* **Alumni / Industry Mentor**: Mr. Vivek Sundaram
* **Course Outcome Mapping**: 
  * **CO1**: Implement and integrate all modules of the proposed system effectively.
  * **CO4**: Demonstrate deployment readiness, usability, security, scalability, and sustainability considerations.
  * **CO6**: Present and defend the complete project professionally through comprehensive technical documentation.
* **Program Outcomes (POs) & PSOs Covered**: PO1, PO2, PO3, PO5, PO6, PO7, PO8, PO9, PO10, PO11, PSO1, PSO2.
* **Sustainable Development Goals (SDGs)**: SDG 4 (Target 4.4), SDG 8 (Target 8.10), SDG 9 (Target 9.5), SDG 16 (Targets 16.6, 16.10).

---

## 1. System Architecture and Modular Decomposition

As established in Chapter 4 of the Capstone Project–II Blackbook, **FinPilot** is structured into four coordinated architectural layers: Presentation Layer, Identity and Routing Layer, Service Layer, and Data Layer.

```mermaid
flowchart TD
    subgraph Presentation_Layer["1. Presentation Layer (Port 3000)"]
        UI["Next.js 16 Web Application<br>React 19 | Tailwind CSS v4 | Lightweight Charts | Recharts"]
        BFF["Server Route Handlers & Proxies<br>/api/portfolio | /api/alerts | /api/tv-chart | /api/heatmap"]
    end

    subgraph Identity_Layer["2. Identity & Routing Layer"]
        Firebase["Firebase Authentication Client<br>Bearer ID Token Attachment"]
        AdminSDK["Firebase Admin SDK Gatekeeper<br>Cryptographic Token Verification"]
    end

    subgraph Service_Layer["3. Service Layer (Independent FastAPI Services)"]
        M1["M1: CYRO Conversational Agent<br>(Port 8765)"]
        M2["M2: CYRO Research Pipeline<br>(Port 8765)"]
        M3["M3: AI Baskets & Invest Like<br>(Port 8765)"]
        M4["M4: Market Intelligence API<br>(Port 8003)"]
        M5["M5: SEBI Regulatory Shield<br>(Port 8000)"]
        M6["M6: Paper Trading & Mentor<br>(Port 8001)"]
        M7["M7: Nifty Shorts Video Engine<br>(Port 8500)"]
        M8["M8: Portfolio & Alerts Engine<br>(Port 3000 / BFF)"]
        M9["M9: Admin Portal & Observability<br>(Port 3000 / logs/cyro.ndjson)"]
        M10["M10: Identity & Persistence<br>(Port 3000 / Neon PostgreSQL)"]
    end

    subgraph Data_Layer["4. Data Layer (Persistence & Market Feeds)"]
        Postgres["Neon PostgreSQL Database<br>(User Data, Portfolios, Ledger)"]
        ChromaStore["ChromaDB Vector Store<br>(Port 8100 | Document Embeddings)"]
        SQLiteStores["SQLite WAL Databases<br>(Sanctions, News, Security Master)"]
        S3Storage["AWS S3 Bucket<br>(Annual Reports & Filings)"]
        MistralAPI["Mistral AI API Gateway<br>(Ministral-8B & Mistral-Large)"]
        MarketFeeds["NSE / BSE / Upstox / Fyers<br>(Market Data Feeds)"]
    end

    UI --> Firebase
    Firebase --> BFF
    BFF --> AdminSDK
    AdminSDK --> Service_Layer
    M1 <--> ChromaStore
    M2 --> MistralAPI
    M5 --> SQLiteStores
    M6 --> Postgres
    M7 --> S3Storage
    Service_Layer <--> MarketFeeds
```

---

### 1.1 Module Responsibilities, Inputs, and Outputs (Table 4.1 from Blackbook)

FinPilot is partitioned into ten formal modules ($M1$ to $M10$), each maintaining strict boundary contracts:

| Module Code | Module Name | Input Parameters | Generated Outputs |
|:---:|---|---|---|
| **M1** | **CYRO Conversational Agent** | User natural language message, session ID, stored memory tags | Streamed grounded answer, source cards, follow-up suggestions, memory updates |
| **M2** | **CYRO Research Pipeline** | Ticker symbol, target investment horizon | Comprehensive report with stance, evidence confidence, and cited claims |
| **M3** | **AI Baskets and Invest Like** | Nifty 500 lists, historical prices, quarterly financial statements | Scores, basket compositions, live tracking series, per-rule explanations |
| **M4** | **Market Intelligence** | Live quotes, price history, exchange announcements, balance sheets | Screener results, market heatmap, candlestick charts, announcements feed, calendar |
| **M5** | **SEBI Regulatory Shield** | Regulator and exchange publications; query records (DIN, PAN, Name) | Scraped entities, regulatory enforcement actions, match scores, circular links |
| **M6** | **Paper Trading and Mentor** | User virtual order, stated investment thesis | Order ledger, trade journal, Warren Buffett margin-of-safety critique |
| **M7** | **Nifty Shorts** | Nifty 50 stock symbol | Automated 5-stage script, synthesized voiceover, rendered vertical 9:16 MP4 video |
| **M8** | **Portfolio and Alerts** | User holdings, real-time exchange announcements, regulatory orders | Aggregated portfolio view, real-time filing, news, and regulatory debarment alerts |
| **M9** | **Administrator Portal** | Service heartbeat probes, user session records, structured logs | Subsystem health matrix, latency probes, live `logs/cyro.ndjson` stream viewer |
| **M10** | **Identity and Storage** | User credentials, Firebase ID tokens, database connection pool | Verified user identity, scoped PostgreSQL records, session isolation |

---

### 1.2 Principal API Interface Specifications (Table 4.2 from Blackbook)

Table 4.2 specifies the principal communication interfaces connecting the presentation layer to the underlying microservice mesh:

| Service Domain | Interface Endpoint | HTTP Method & Format | Operational Purpose |
|---|---|---|---|
| **CYRO Chat** | `/skills/cyro/chat` | `POST` (SSE Stream) | Executes one conversational turn; streams tokens and grounded sources |
| **Chat Sessions**| `/skills/cyro/chat/sessions` | `GET`, `POST`, `DELETE` | Session listing, creation, renaming, and deletion |
| **Chat Memory** | `/skills/cyro/chat/memory` | `GET`, `DELETE` | Views and edits whitelisted user memory preferences |
| **CYRO Research**| `/skills/cyro/stream`<br>`/skills/cyro/analyze` | `GET` (SSE Stream)<br>`POST` (JSON) | Dispatches full 10-role LangGraph state graph with real-time stage progress |
| **AI Baskets** | `/baskets`<br>`/baskets/{id}`<br>`/baskets/stocks/ranking`<br>`/baskets/stocks/{symbol}/scores` | `GET` (JSON) | Fetches basket cards, holdings, rebalances, and investor model scores |
| **Stock Screener**| `/screener/meta`<br>`/screener/run` | `GET` (JSON)<br>`POST` (JSON) | Returns field metadata and live preset counts; runs compound multi-factor screens |
| **Regulatory** | `/v1/screen`<br>`/v1/entities`<br>`/v1/stats` | `POST` (JSON)<br>`GET` (JSON) | Executes batch debarment screening, entity lookups, and statistics |
| **Paper Trading**| `/api/trade/execute`<br>`/api/portfolio`<br>`/api/mentor-audit` | `POST` (JSON)<br>`GET` (JSON)<br>`POST` (JSON) | Executes simulated market orders, tracks ledger, and runs pre-trade AI critique |
| **Web Proxies** | `/api/portfolio`, `/api/alerts`, `/api/screener`, `/api/admin`, `/api/tv-chart`, `/api/heatmap`, `/api/news` | Authenticated Next.js Route Handlers | Verifies Firebase bearer token and proxies requests to backend microservices |

---

## 2. Infrastructure Prerequisites and Environment Configuration

### 2.1 Hardware and Runtime Requirements
* **Host Platform**: Windows 11 Pro 64-bit (or Ubuntu 22.04 LTS / macOS 13+).
* **Processor**: Minimum 4 Physical Cores (Recommended: Intel Core i7 / AMD Ryzen 7).
* **System RAM**: Minimum 8 GB (Recommended: 16 GB DDR5 for concurrent microservice execution).
* **Storage**: 10 GB available SSD space (includes ChromaDB vector stores and SQLite databases).
* **Runtimes**:
  * Node.js v20.x or v22.x LTS with `npm`
  * Python 3.12.x or 3.13.x with `pip` and `virtualenv`
  * Git with Git LFS extension (`git-lfs/3.6.1`)
  * FFmpeg installed and accessible in system `PATH` (for Nifty Shorts video compositing)

---

### 2.2 Environment Variables Setup

Ensure that `.env` files are configured in their respective directories using the provided templates:

#### Root `.env` (Frontend & Shared Persistence)
```env
# AWS S3 Storage for Corporate Filings
AWS_ACCESS_KEY_ID="your_aws_access_key_id"
AWS_SECRET_ACCESS_KEY="your_aws_secret_access_key"
AWS_DEFAULT_REGION="ap-southeast-2"
S3_BUCKET="finpilot-doc-scrapper"
S3_PREFIX="doc-scrapper"

# Hosted LLM APIs (Mistral AI with multi-key rotation)
MISTRAL_API_KEY="your_primary_mistral_key"
MISTRAL_API_KEY_1="your_backup_key_1"
MISTRAL_API_KEY_2="your_backup_key_2"
MISTRAL_API_KEY_3="your_backup_key_3"
CYRO_MODEL="ministral-8b-latest"

# Internal Microservice Routing
INDIA_TRADE_CLI_URL="http://127.0.0.1:8765"

# Relational User Database (Neon PostgreSQL)
DATABASE_URL="postgresql://user:password@ep-host.aws.neon.tech/neondb?sslmode=require"
```

#### `india-trade-cli/.env` (CYRO Multi-Agent Engine)
```env
AI_PROVIDER=openai
OPENAI_BASE_URL=https://api.mistral.ai/v1
OPENAI_API_KEY="your_primary_mistral_key"
OPENAI_MODEL=ministral-8b-latest
CYRO_NORMAL_MODEL=ministral-8b-latest
CYRO_REASONING_MODEL=mistral-large-latest

FYERS_APP_ID="your_fyers_app_id"
FYERS_SECRET_KEY="your_fyers_secret_key"
FYERS_REDIRECT_URL="http://127.0.0.1:8765/fyers/callback"
UPSTOX_ACCESS_TOKEN="your_upstox_jwt_token"

CHROMA_DB_PATH="D:/Desktop/FinPilot/india-trade-cli/chroma_db"
```

---

## 3. Multi-Service Orchestration Runbook

FinPilot includes an automated PowerShell orchestrator (`start-all-services.ps1`) designed to launch and monitor the ten discrete service processes across designated local ports:

```powershell
# Open an elevated PowerShell session at the project root
cd D:\Desktop\FinPilot

# Launch full microservice topology with 30-minute regulatory scraper cycle
.\start-all-services.ps1 -ScrapeIntervalMinutes 30
```

### 3.1 Service Allocation Map
When initiated, the orchestrator spawns dedicated terminal windows corresponding to:
1. **Port 8100**: ChromaDB Vector Store (`chroma.exe run --port 8100`)
2. **Port 3000**: Next.js Web Application (`npm run dev`)
3. **Port 8765**: CYRO Multi-Agent Engine (`python -m web.api`)
4. **Port 8002**: News Feed & Announcements Backend (`python run.py`)
5. **Port 8001**: Paper Trading & Mentor Service (`python run.py`)
6. **Port 8000**: SEBI Shield Regulatory API (`python run.py serve`)
7. **Port 8003**: Stock Screener API (`python run.py serve-screener`)
8. **Port 8500**: Nifty Shorts Video Engine (`uvicorn main:app --port 8500`)
9. **Daemon**: Background Regulatory Scraper Pipeline (`run.py pipeline --source all`)
10. **Console**: CYRO Structured NDJSON Log Stream Viewer (`logs/cyro.ndjson`)

---

## 4. User Manual and Module Walkthroughs (Section 7.1 from Blackbook)

Access the live application interface by opening a web browser to:  
👉 **`http://localhost:3000`**

---

### 4.1 Home Dashboard & Live Market Heatmap (Figure 7.7)
* **Purpose**: Provides real-time market breadth and sector rotation visualization.
* **Operation**:
  1. Navigate to the **Heatmap** view from the primary navigation bar.
  2. Select an index category: **Nifty 50**, **Nifty Bank**, **Nifty IT**, **Nifty Auto**, or **Nifty Pharma**.
  3. Filter by **Gainers** or **Losers**; sort by percentage change or market capitalization.
  4. Clicking any stock tile dynamically transitions directly into that stock's **Interactive Chart Terminal**.

---

### 4.2 CYRO Conversational Agent & Research Report (Figure 7.2, 7.3)
* **Purpose**: Conducts grounded conversational research and generates institutional multi-analyst equity reports.
* **Operation**:
  1. In the chat prompt, reference a company using `@TICKER` (e.g. `@INFY What is the 3-to-6-month outlook for Infosys?`).
  2. To trigger a full research workflow, input an explicit request (e.g. `@TCS Generate full research report`).
  3. The workflow streams execution phases: *Intent Routing* $\rightarrow$ *Context Building* $\rightarrow$ *Quality Gate* $\rightarrow$ *Specialist Analysis* $\rightarrow$ *Risk Debate* $\rightarrow$ *Investment Committee Stance*.
  4. Review the **Analyst Scorecard**, **Bull vs. Bear Debate**, and **Three-Tier Trade Plan** (Conservative, Neutral, Aggressive). Hover over blue citation pills `[E-12]` to view primary evidence.

---

### 4.3 Interactive Candlestick Chart Terminal (Figure 7.8)
* **Purpose**: Multi-timeframe technical analysis with algorithmic chart pattern recognition.
* **Operation**:
  1. Select multi-timeframe views (1-minute intraday to monthly candles).
  2. Toggle technical overlays: 20 SMA, 50 SMA, 200 SMA, and 14-period RSI.
  3. Inspect the automated **Pattern Panel**: reviews detected breakouts, support/resistance levels, and historical win-rates (e.g. *Bullish RSI Divergence: 69% historical success rate over 42 prior instances*).

---

### 4.4 SEBI Regulatory Shield (Figure 7.9)
* **Purpose**: Pre-trade screening for corporate governance risks, debarred directors, and regulatory sanctions.
* **Operation**:
  1. Navigate to **SEBI Shield** on the top menu.
  2. Enter a company name, director name, DIN (Director Identification Number), or PAN.
  3. Review the confidence verdict:
     * `MATCH (1.0)`: Definite identifier match against an active regulatory debarment order.
     * `POSSIBLE_MATCH (0.74)`: Name match flagged for compliance review.
  4. Click the hyperlinked regulatory order to review the official signed SEBI/RBI circular PDF.

---

### 4.5 Stock Screener Engine (Figure 7.4)
* **Purpose**: Transparent multi-factor screening across 501 Indian equities.
* **Operation**:
  1. Navigate to **Screener**.
  2. Choose a preset screen (*Debt-Free Cash Cows*, *High ROE Compounders*, *Value Plays*) or construct custom compound filters using P/E, P/B, ROE, ROCE, and Dividend Yield.
  3. Expand any qualifying result row to inspect the **Why Matched** itemized audit proving how each parameter met the criteria.

---

### 4.6 AI Baskets & Invest Like Ranking (Figure 7.5, 7.6)
* **Purpose**: Algorithmic thematic baskets and multi-persona equity scoring models.
* **Operation**:
  1. Open **AI Baskets** to explore eight rule-based baskets holding 10 to 15 stocks each.
  2. Review historical simulated returns, active live performance, and sector weight constraints (max 12% single stock, max 30% sector).
  3. Open **Invest Like** to filter the Nifty 500 universe through five distinct investor philosophies (*Warren Buffett*, *Peter Lynch*, *Rakesh Jhunjhunwala*, *100-Baggers*, *CANSLIM*).

---

### 4.7 Paper Trading Crucible with AI Mentor (Figure 7.12, 7.13)
* **Purpose**: Risk-free portfolio execution with pre-trade cognitive bias auditing.
* **Operation**:
  1. Open **Paper Trading** (starts with ₹1,000,000 in virtual capital).
  2. Create an order: specify ticker, quantity, and transaction direction (BUY / SELL).
  3. Input your mandatory **Trade Thesis** explaining the rationale behind the trade.
  4. The **AI Mentor** audits the thesis against Warren Buffett and Charlie Munger margin-of-safety principles, alerting you to emotional anchoring or unverified assumptions before order execution.
  5. Confirmed trades execute at live server-fetched prices and append to your **Reflection Journal**.

---

### 4.8 Autonomous Nifty Shorts Video Studio (Figure 7.15)
* **Purpose**: Automated creation of short-form vertical market videos and teleprompter scripts.
* **Operation**:
  1. Navigate to **Nifty Shorts** and select any Nifty 50 constituent.
  2. The system automatically structures a 60-second script into *Hook (0–5s)*, *Price Action (5–20s)*, *Catalyst (20–40s)*, *Key Levels (40–55s)*, and *Verdict (55–70s)*.
  3. Read directly from the built-in teleprompter, listen to the synthesized Indian English voice narration, or download the rendered vertical 9:16 MP4 video.

---

### 4.9 Administrator Portal & Health Observability (Figure 7.16)
* **Purpose**: System diagnostics, service health probes, and structured log audits.
* **Operation**:
  1. Navigate to `/admin` and authenticate with administrator credentials.
  2. Review real-time heartbeat latency for all eight microservices and database connection pools.
  3. Monitor live agent actions in the streaming viewer tailing `logs/cyro.ndjson`.

---

## 5. Operational Troubleshooting Runbook

| Fault Symptom | Diagnostic Root Cause | Corrective Remediation Action |
|---|---|---|
| **Port Conflict (`EADDRINUSE: 8765`)** | An orphaned Python process is holding the socket | In PowerShell, execute: `Get-Process \| Where-Object { $_.ProcessName -match 'python' } \| Stop-Process -Force` |
| **ChromaDB Connection Error (8100)** | Chroma server stopped or lockfile active | Confirm `chroma.exe` is running; remove any stale `chroma_db/*.lock` files |
| **HTTP 401 Unauthorized across API** | Firebase client authentication token expired | Sign out of the web client and re-authenticate to refresh session credentials |
| **Missing Mistral API Key Warning** | `.env` missing active `MISTRAL_API_KEY` | Ensure valid Mistral API keys are populated in both root `.env` and `india-trade-cli/.env` |
| **Git LFS File Pointer Errors** | Git LFS smudge filter was bypassed during clone | Run: `git lfs install` followed by `git lfs pull` |
| **Paper Trade Stale Price Warning** | Market closed or broker WebSocket interrupted | Normal behavior outside market hours; simulation automatically falls back to last close |

---

### Operational Sign-Off
FinPilot is fully verified and ready for deployment. The platform establishes an institutional-grade, fully auditable benchmark for AI-driven equity research and regulatory surveillance in Indian financial markets.
