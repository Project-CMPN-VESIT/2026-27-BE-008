# FinPilot: AI Equity Research & Market Intelligence Platform

## Overview

**FinPilot** is an institutional-grade equity research terminal and intelligence platform built specifically for Indian financial markets (NSE & BSE). 

It consolidates real-time market data, multi-agent AI research, regulatory compliance surveillance, fundamental stock screening, and risk-free trade simulation into a single command center.

---

## 1. Active Working Features & Value

---

### 1. CYRO Research War Room
> **AI-Powered Multi-Analyst Equity Research & Debate**

* **The Problem It Solves**: Conducting thorough equity research across technicals, balance sheets, options chains, and news flow takes hours and often suffers from confirmation bias.
* **The Value**: Generates comprehensive, institutional-grade research in minutes. Seven autonomous AI specialists investigate the company in parallel, followed by a simulated Bull vs. Bear debate to stress-test the thesis. Every statement is strictly grounded in verifiable market evidence to eliminate AI hallucinations.
* **What You Get**:
  * **Analyst Scorecard**: Composite score combining technicals, fundamentals, options data, and news sentiment.
  * **Bull vs. Bear Debate**: Unbiased clash of arguments exposing upside catalysts and downside risks.
  * **Three-Tier Trade Plans**: Concrete entry, target, and stop-loss levels for Conservative, Neutral, and Aggressive risk profiles.
  * **Market Flow Intelligence**: Live tracking of Institutional flows (FII/DII), Put-Call Ratio (PCR), Max Pain, and India VIX.
* **Real-World Example**:
  * **You Ask**: `@INFY What is the 3-to-6-month outlook for Infosys?`
  * **Outcome**: The engine evaluates Infosys across technicals (above 50 EMA), fundamentals (31.8% ROE, deal pipeline), options data (PCR: 1.14), and sector trends. The Bull highlights deal momentum, while the Bear flags rich valuations and US tech spend deceleration. The final synthesis delivers a **Moderately Bullish** stance with a clear trade plan (Entry: ₹1,865 | Target: ₹2,050 | Stop: ₹1,790).

---

### 2. Real-Time Index & Sector Heatmap
> **Live Market Breadth & Capital Flow Visualization**

* **The Problem It Solves**: Text-based watchlists make it difficult to see where capital is rotating across different sectors during market hours.
* **The Value**: Visualizes market breadth at a glance with live streaming price updates. Spot which sectors are leading or lagging, track market momentum, and identify strong setups instantly.
* **What You Get**:
  * **Deep Index Coverage**: Live coverage across Broad Market benchmarks, Sectoral indices (Bank, IT, Auto, Pharma, FMCG), and Thematic indices.
  * **Dynamic Tile Sizing**: Tiles automatically size according to index weight or market capitalization.
  * **Instant Filtering & Sorting**: Filter down to Gainers or Losers; sort by percentage change, volume, or market cap.
  * **One-Click Navigation**: Clicking any tile opens its detailed interactive chart.
* **Real-World Example**:
  * **Action**: You select **Nifty Bank** and filter by **Gainers**.
  * **Outcome**: The heatmap highlights outperforming private and public banks driving the sector's rally (e.g., HDFC Bank +1.15%, ICICI Bank +0.82%). Clicking HDFC Bank transitions directly into its full technical chart.

---

### 3. Interactive Chart Terminal & Pattern Intelligence
> **Live Charting with Algorithmic Pattern Detection**

* **The Problem It Solves**: Chart reading requires manual scanning for chart patterns, pivot points, and divergences, which is time-consuming and subjective.
* **The Value**: Combines responsive candlestick charting with an automated pattern detection engine that spots high-probability trading setups and provides historical win-rate statistics.
* **What You Get**:
  * **Professional Candlestick Charts**: Multi-timeframe views from 1-minute intraday to monthly horizons.
  * **Key Technical Overlays**: Real-time Simple Moving Averages (SMA 20, SMA 50) and RSI (14).
  * **Automated Pattern Detection**: Instantly alerts you to Breakouts, Reversals, Support/Resistance levels, and RSI Divergences.
  * **Calculated Trade Levels**: Every detected pattern provides exact Entry, Target, and Stop-Loss levels with sample size and backtested win rates.
  * **Fundamental & Company Snapshot**: Quick access to valuation metrics (P/E, P/B, ROE) and verified company leadership details.
* **Real-World Example**:
  * **Action**: You open the chart for `TCS`.
  * **Outcome**: The pattern engine alerts you to a **Bullish RSI Divergence**. It suggests an Entry at ₹4,175, Target at ₹4,350, and Stop Loss at ₹4,080, noting a 69% historical success rate across 42 prior occurrences.

---

### 4. SEBI Shield: Regulatory Sanctions & Compliance Screening
> **Corporate Governance & Regulatory Risk Protection**

* **The Problem It Solves**: Investors often discover promoter bans, fraud investigations, or regulatory penalties only after a stock crashes.
* **The Value**: Continuously monitors regulatory orders and enforcement actions to protect capital from governance red flags and sanctioned management.
* **What You Get**:
  * **Multi-Agency Surveillance**: Covers official orders from SEBI, RBI circulars, exchange surveillance notices (NSE/BSE), and international sanctions.
  * **Fast Entity Search**: Instantly look up any individual, company, Director Identification Number (DIN), or PAN.
  * **Official Evidence**: Every flagged entity links directly to the original regulatory order and circular PDF.
  * **Batch Screening**: Screen lists of companies or executives to verify compliance standing before making investments.
* **Real-World Example**:
  * **Action**: You screen an executive or prospective investee company.
  * **Outcome**: The screening tool checks regulatory databases and flags active debarment orders, detailing the violation, effective sanction period, and direct links to the official SEBI circular.

---

### 5. Discovery Stock Screener
> **Multi-Factor Fundamental Screener with Explainable Results**

* **The Problem It Solves**: Most screeners give a list of matching stocks without explaining why they qualified or how close borderline candidates were.
* **The Value**: Screen the market using customizable financial filters and receive clear, step-by-step explanations for each matching company.
* **What You Get**:
  * **Ready-to-Use Presets**: One-click screening for *Value Plays (P/E < 20)*, *Premium Bluechips*, *Debt-Free Cash Cows*, and *High ROE Compounders*.
  * **Visual Filter Builder**: Construct multi-factor criteria using P/E, P/B, ROE, ROCE, Debt/Equity, and Dividend Yield.
  * **Match Explanations**: Itemized breakdown showing exact metrics against your required criteria.
  * **Cohort Insights**: Summary view showing median valuation, number of high-quality compounders, and top performers in the screened group.
* **Real-World Example**:
  * **Action**: You run the **Debt-Free Cash Cows** preset (`Debt to Equity < 0.5` AND `Dividend Yield > 1.0%`).
  * **Outcome**: Instantly returns qualifying companies (such as TCS and ITC) with an itemized explanation: TCS qualified with Debt/Equity of 0.02 and Dividend Yield of 1.35%.

---

### 6. Live Corporate Announcements Feed
> **Direct Exchange Disclosures & Official Filings**

* **The Problem It Solves**: Financial news outlets filter or delay official corporate announcements, leading to delayed reactions to market-moving events.
* **The Value**: Direct, real-time feed of official regulatory filings submitted under Regulation 30 (LODR) to the NSE and BSE, completely free of media noise.
* **What You Get**:
  * **Instant Disclosures**: Board meeting outcomes, financial results filings, dividend declarations, and management changes.
  * **Segment Filters**: Filter by Equities, SME, Debt, or Mutual Funds across NSE and BSE.
  * **Direct Source Documents**: One-click access to the official signed filing PDFs submitted by company leadership.
* **Real-World Example**:
  * **Action**: You monitor the feed during market hours.
  * **Outcome**: You receive an immediate alert for State Bank of India (SBIN) announcing a board approval for capital raising via Tier 2 bonds, complete with a link to read the original submission letter.

---

### 7. Paper Trading Crucible with AI Mentor
> **Risk-Free Trading with Pre-Trade AI Discipline Audits**

* **The Problem It Solves**: Paper trading typically lacks discipline because there are no real consequences for impulsive, poorly reasoned trades.
* **The Value**: Practice trading with virtual capital while an AI Mentor audits your investment thesis before every trade, helping you build disciplined habits and avoid emotional errors.
* **What You Get**:
  * **Virtual Portfolio**: ₹1,000,000 in virtual capital with real-time portfolio tracking, position management, and P&L metrics.
  * **Live Price Execution**: Orders execute against real NSE market prices.
  * **AI Mentor Gatekeeper**: Before confirming a trade, the AI mentor critiques your thesis using Warren Buffett's margin-of-safety principles and checks for governance red flags.
  * **Reflection Journal**: Automatically logs your trade thesis, execution price, and the mentor's feedback for post-trade learning and review.
* **Real-World Example**:
  * **Action**: You enter an order to BUY 50 shares of `TATAMOTORS`, writing: *"Stock fell 5% this week, expecting a quick rebound."*
  * **Outcome**: The AI Mentor audits your thesis:
    1. **Thesis Gap**: Warns against anchoring bias—a price drop alone does not guarantee a rebound without operational catalysts.
    2. **Valuation Check**: Points out commercial vehicle volumes plateauing this quarter.
    3. **Risk Limit**: Reminds you to size the trade within sensible portfolio limits.
  * You review the feedback, confirm the order, and the position and journal are updated.

---

### 8. Results Calendar
> **Quarterly Earnings Schedule & Filings Tracker**

* **The Problem It Solves**: Traders often get blindsided by sudden quarterly earnings releases that cause sharp stock price swings.
* **The Value**: Track upcoming quarterly financial results dates directly from official exchange schedules to plan trades around earnings volatility.
* **What You Get**:
  * **Verified Announcement Dates**: Live schedule of upcoming board meetings for financial results.
  * **Fast Search**: Search by company name or ticker symbol.
  * **Direct Exchange Links**: Direct hyperlinks to official exchange corporate announcement pages.
* **Real-World Example**:
  * **Action**: You search for `RELIANCE`.
  * **Outcome**: Displays the confirmed board meeting date for Q2 financial results, allowing you to adjust options positions or manage exposure ahead of the release.

---

### 9. Nifty Shorts Video Engine
> **Autonomous Short-Form Video & Script Generator**

* **The Problem It Solves**: Creating high-quality financial content for social media (YouTube Shorts, Instagram Reels) requires extensive research, scriptwriting, voice recording, and editing.
* **The Value**: Turns market data and technical setups for Nifty 50 stocks into ready-to-publish vertical videos and teleprompter scripts in seconds.
* **What You Get**:
  * **Cinematic Script Structure**: Automatically structures scripts into Hook (0–5s), Price Action (5–20s), Core Catalyst (20–40s), Technical Levels (40–55s), and Final Verdict (55–70s).
  * **Interactive Teleprompter**: Clean presentation mode with adjustable text sizing and one-click clipboard copying.
  * **Natural Voice Narration**: High-fidelity Indian English voiceover synthesis.
  * **Full Video Rendering**: Produces vertical (9:16) MP4 videos with animated charts, price indicators, and synchronized captions.
* **Real-World Example**:
  * **Action**: You select `TATA MOTORS` in Nifty Shorts.
  * **Outcome**: Automatically produces a punchy 60-second video script analyzing today's price action and key support/resistance levels. You can read it directly from the teleprompter or download the finished video with voiceover and motion graphics.

---

## 2. Active Feature Summary Matrix

| Feature | Primary User Value | Practical Use Case |
|---|---|---|
| **CYRO War Room** | Institutional-grade equity research in minutes | Getting balanced bull/bear debate & trade plans before entering a position |
| **Market Heatmap** | Spot market breadth and sector rotation live | Seeing where money is moving during market hours |
| **Chart Terminal** | Automated technical pattern detection with win rates | Finding high-probability breakout and reversal entries |
| **SEBI Shield** | Protect capital against fraud and promoter sanctions | Verifying company and executive compliance history |
| **Stock Screener** | Filter stocks with transparent reasoning | Finding undervalued, dividend-paying, or high-growth compounders |
| **News Feed** | Unfiltered, real-time corporate announcements | Reading official company filings and board resolutions first |
| **Paper Trading** | Risk-free practice with an AI trading coach | Testing strategies and getting thesis critique before risking real money |
| **Results Calendar** | Stay ahead of earnings volatility | Knowing exact upcoming earnings dates |
| **Nifty Shorts** | Autonomous financial content creation | Generating vertical video scripts and finished social videos in seconds |

---

## 3. Proposed & Roadmap Features (New Capabilities)

The following distinct modules represent planned extensions that introduce entirely new capabilities to the platform, avoiding overlap with currently active features:

---

### 1. Conversational Copilot & Contextual Memory
> **Interactive Dialogue with Persistent Long-Term Recall**

* **What It Does**: Transforms the research experience from static, one-way report generation into an ongoing, multi-turn conversation that remembers user preferences, portfolio holdings, risk tolerance, and past discussions across sessions.
* **User Value**: Eliminates repetitive context-setting and allows users to actively drill down, challenge assumptions, and run natural language queries across the entire market universe.
* **Capabilities**:
  * **Stock Inquiries**: Ask natural questions about specific stocks (`"What drove the sharp volume spike in Reliance yesterday?"`).
  * **Investment Research & Frameworks**: Request theses matching your horizon or evaluate ideas using specific frameworks (`"Evaluate Bharti Airtel under a 3-year DCF framework"`).
  * **Thematic & Sector Exploration**: Explore macro themes (`"Which auto ancillaries benefit most from EV localization mandates?"`).
  * **Discovery & Portfolio Audits**: Find opportunities or audit holdings (`"Find capital goods companies with order books exceeding 3x revenue"` or `"Check my holdings for concentration risk"`).
  * **Predefined Routines**: Run instant audit commands (Forensic Audit, Earnings Preview, Moat Assessment).
* **Real-World Example**:
  * *Session 1*: You discuss your conservative risk appetite and preference for dividend-paying bluechips.
  * *Session 2 (Weeks later)*: You ask: *"Find three stocks to research this weekend."* The AI automatically prioritizes low-debt, high-dividend large caps without needing to be re-prompted.

---

### 2. AI Thematic & Strategy Baskets
> **Curated, Algorithmic Thematic Portfolios**

* **What It Does**: Pre-built, dynamically tracked stock baskets built around high-conviction market themes and proven investment philosophies.
* **User Value**: Allows investors to discover and track rule-based thematic portfolios without manually researching and balancing dozens of individual stocks.
* **Core Baskets**:
  * **Small & Mid Cap Movers**: Fast-growing emerging market leaders showing institutional accumulation.
  * **RJ's Small Cap Movers**: Growth-at-a-reasonable-price picks inspired by legendary Indian investor strategies.
  * **Large Order Book**: Infrastructure, defense, and capital goods firms with multi-year confirmed revenue backlogs.
  * **Mayer's Small Cap Movers**: High-reinvestment compounders inspired by Chris Mayer's 100-Bagger criteria.
  * **Top Small + Mid Cap High Growth Movers**: Companies with top-decile revenue and earnings acceleration.
  * **RJ's Large Cap Movers**: Market leaders with dominant domestic consumer moats.
* **What Each Basket Displays**:
  * Included stocks and individual weightages
  * Overall basket return (1M, 6M, 1Y, and Since Inception)
  * Strategy philosophy and underlying thesis
  * Visual performance charts benchmarked against NIFTY 50 and NIFTY 500
  * Complete holdings list and rebalance history

---

### 3. "Invest Like" Legends & Proprietary AI Scoring
> **Iconic Investor Persona Grades & Composite Health Ratings**

* **What It Does**: Evaluates every stock through the lenses of world-renowned investing masters while assigning a unified quantitative quality score and trend posture.
* **User Value**: Gives an immediate, multi-perspective assessment showing how different investment styles (Value, Growth, Quality, Momentum) view the exact same company.
* **Featured Legend Frameworks**:
  * **Rakesh Jhunjhunwala**: Focuses on domestic consumption growth, operating leverage, competitive moats, and visionary promoter execution.
  * **Peter Lynch**: Assesses PEG ratios, product simplicity, everyday consumer adoption, and company category (Fast Growers, Stalwarts, Turnarounds).
  * **Warren Buffett**: Strict scrutiny of durable economic moats, pricing power, high return on invested capital, and margin of safety.
  * **100 Baggers**: Evaluates high capital reinvestment rates, long reinvestment runways, and capital efficiency.
  * **CANSLIM**: William O'Neil's framework evaluating earnings acceleration, institutional sponsorship, and technical breakouts.
* **Proprietary Indicators**:
  * **AI Score (0–100)**: Holistic grade synthesizing financial strength, balance sheet resilience, valuation discount, and governance integrity.
  * **Magic Trend**: Dynamic indicator identifying whether the stock is in Strong Bullish expansion, Pullback, Accumulation, or Distribution.
* **Real-World Example**:
  * For **ITC**: Buffett Score: `88/100` (Exceptional moat and pricing power) | Lynch Score: `74/100` (Steady stalwart with high dividend yield) | CANSLIM Score: `52/100` (Lower quarterly growth velocity) | AI Score: `85/100` | Magic Trend: `Bullish Consolidation`.

---

### 4. Forensic Accounting & Red Flag Deep-Dive
> **Forensic Statement Scrutiny & Financial Manipulation Detection**

* **The Problem It Solves**: Standard ratios often hide aggressive accounting practices, unbilled revenue, unbacked cash flows, and balance sheet deterioration.
* **The Value**: Conducts deep forensic accounting audits to protect investors from earnings manipulation and corporate distress before major stock declines occur.
* **Core Modules**:
  * **Accounting Red Flag Analysis**: Scrutinizes sudden auditor resignations, contingent liabilities, related-party transactions, and promoter share pledges.
  * **Cash Flow Quality Audit**: Evaluates the CFO-to-EBITDA conversion ratio, unbilled revenue growth, and Free Cash Flow (FCF) yield.
  * **Balance Sheet Integrity**: Analyzes working capital elongation, debt maturity schedules, and asset impairment risk.
  * **DuPont ROE vs. ROCE Comparison**: Deconstructs returns into profit margin, asset turnover, and financial leverage to reveal whether profitability is genuine or debt-fueled.
* **Real-World Example**:
  * A midcap company reports a 30% jump in net profit, but the forensic audit reveals that Cash Flow from Operations (CFO) declined by 40% due to surging trade receivables—immediately triggering an accounting red flag.

---

### 5. Institutional Watchlist & Peer Comparison Hub
> **Centralized Monitoring with Automated Competitor Benchmarking**

* **What It Does**: A comprehensive watchlist workspace combining customizable tracking with automated competitor clustering.
* **User Value**: Keeps high-conviction ideas organized while answering the critical question: *"Is this company truly the best pick among its industry peers?"*
* **Key Capabilities**:
  * **Unified Watchlist**: Track stocks alongside their **Magic Trend**, **AI Score**, and custom financial metrics in one consolidated view.
  * **Custom Columns**: Easily toggle columns for P/E ratios, market cap, Legend scores, and risk flags.
  * **Similar Stocks & Peer Benchmarking**: Automatically surfaces direct and adjacent competitors, comparing valuation multiples, growth rates, and AI Scores side-by-side against the industry median.
  * **One-Click Export**: Download watchlists and peer comparison tables to CSV or Excel for offline analysis.
* **Real-World Example**:
  * Adding `Tata Motors` to your watchlist automatically surfaces competitors (`Mahindra & Mahindra`, `Maruti Suzuki`), showing that while Tata Motors has a higher Magic Trend score, M&M maintains a higher AI Score due to lower balance sheet leverage.
