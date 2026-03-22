# FinPilot

FinPilot is a comprehensive financial intelligence and regulatory screening platform. It combines a real-time market dashboard with an AI-driven sanctions and regulatory screening engine (SEBI Shield).

## Features Implemented

### 1. Market Command Center (Frontend)
Built with **Next.js 15**, **React 19**, and **Tailwind CSS v4**, providing a sleek, broker-style dashboard.
- **Live Market Data:** Real-time indices and most-traded stocks fetched via Next.js API routes (`/api/nse-stock`, `/api/live-quote`).
- **Advanced Charting:** Integrates `@mathieuc/tradingview` and `lightweight-charts` for seamless stock search and live-updating interactive charts.
- **Intelligence Modules:** 
  - **War Room:** Source-backed AI analysis.
  - **SEBI Shield:** Automated regulatory integrity checks.
  - **RK/PL Scores:** Risk and Profit scoring.
  - **Disparity Alerts:** Real-time alert system checking market hype versus filing facts.
  - **Agent Council:** Multi-agent debate and paper trading simulation.

### 2. Regulatory Sanctions Engine (Backend)
An independent, high-performance Python backend (`scrapper/` directory) for ingesting and screening regulatory data.
- **Multi-Source Ingestion Pipeline:** Automated scrapers for UN Consolidated Sanctions (XML) and RBI Circulars (HTML). Designed for easy extension via a central source registry.
- **Robust Scraping:** Implements exponential backoff, rate limit handling (HTTP 429/529), jitter delays, and content diff detection (SHA-256) to practically eliminate redundant processing.
- **AI-Powered Extraction Engine:**
  - **Regex Pre-pass:** Extracts structured deterministic IDs (PAN, DIN, CIN) safely.
  - **Mistral LLM Extraction:** Surgical use of Mistral Small to extract entities, dates, and complex circular references directly from unstructured texts.
  - **Name Variant Generation:** Generates initials, surname-first, and transliteration alternates for thorough fuzzy matching.
- **FastAPI Screening Endpoint:** A lightning-fast (`~168ms` response time) bulk matching API.
  - **Scoring Waterfall:** Combines Exact ID hitting (1.0 conf), fuzzy trigram matching, and secondary boosts (DOB, Country). Name-only matches are securely capped to prevent false positives.
  - **Local Datastore:** Uses SQLite with full audit logging. Currently handles 1000+ entities reliably.

## Project Structure
- `/src` & `/app` - Next.js frontend code and UI components.
- `/public` - Static assets.
- `/scrapper` - Python regulatory backend containing:
  - `/api` - FastAPI endpoints for entity screening (`main.py`).
  - `/scrapers` - Adapters for individual websites (RBI, UN, etc.).
  - `/extraction` - Extraction processing logic (regex, mistral, variants).
  - `/db` - SQLite schema and database manager.
  - `run.py` - CLI orchestrator.

## Getting Started

### Frontend
```bash
npm install
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) with your browser to see the live dashboard.

### Backend (Sanctions API)
Requires Python 3.9+
```bash
cd scrapper
pip install -r requirements.txt
python run.py serve
```
You can also run scrapers via the CLI:
```bash
python run.py scrape --source un
python run.py extract
```

---
*Architecture Note: This split architecture ensures the heavy, AI-based data-ingestion pipeline operates independently from the ultra-fast screening and visualization APIs, providing resilience and high throughput.*
