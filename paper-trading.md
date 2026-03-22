# FinPilot Paper Trading Crucible

## Overview
The Paper Trading Crucible is an AI-Mentored reflection loop and virtual ledger built for the FinPilot platform. Instead of just simulating fake-money trades, it actively audits a user's trading logic using Warren Buffett's margin of safety framework before allowing execution.

## Features
- **Virtual Ledger:** Starts users with a ₹1,000,000 balance and accurately updates available cash, current holdings, average buy prices, and Realized/Unrealized P&L.
- **AI Mentor Gatekeeper:** Integrates a Mistral AI agent to evaluate the user's explicit trading thesis against hard fundamentals (RK/PL Disparity Scores).
- **Reflection Journal:** Logs every executed trade alongside the user's original thesis and the AI's feedback for post-trade post-mortem analysis.
- **Live Market Execution:** Fetches live NSE quotes to simulate accurate execution prices.
- **Modular Microservice Architecture:** The backend APIs and database are cleanly decoupled from the main project scrapper.

## Tech Stack
- **Frontend:** Next.js, React, Tailwind CSS, `lightweight-charts`
- **Backend Framework:** FastAPI, Uvicorn
- **Database:** SQLite (`paper_trading.db`)
- **AI Integration:** Mistral AI (`mistralai` Python SDK)

## How to Run

1. **Set Environment Variables**
   Ensure you have a `.env` file active containing your keys:
   ```env
   MISTRAL_API_KEY="your-mistral-api-key"
   ```

2. **Start the Frontend (Next.js)**
   From the root `FinPilot` directory:
   ```bash
   npm run dev
   ```

3. **Start the Paper Trading Backend (FastAPI)**
   From the root `FinPilot` directory, navigate to the decoupled backend:
   ```bash
   cd paper-trading
   python run.py
   ```
   *(This API service runs on `http://127.0.0.1:8001` natively, avoiding port conflicts with the primary Scrapper server on `8000`).*
