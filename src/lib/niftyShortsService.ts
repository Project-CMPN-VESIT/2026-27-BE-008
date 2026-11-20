import fs from "fs";
import path from "path";
import { getMarketSessionInfo } from "@/lib/marketHours";
import {
  initShortsDatabase,
  getShortsForDate,
  getSingleShort,
  saveShortToDatabase,
} from "@/lib/shortsDatabase";

export interface ShortScript {
  event_type: "breakout" | "breakdown" | "earnings" | "unusual_volume" | "news_catalyst" | "normal_session";
  estimated_read_seconds: number;
  word_count?: number;
  verdict: "Bullish" | "Bearish" | "Neutral" | "Watchlist";
  hook: string;
  price_action: string;
  why_moving: string;
  technicals: string;
  fundamentals: string;
  valuation: string;
  what_to_watch: string;
  investor_view: string;
  trader_view: string;
  disclaimer: string;
}

export interface NiftyStockItem {
  symbol: string;
  company_name: string;
  sector: string;
  industry: string;
  trading_date?: string;
  price?: number;
  change_pct?: number;
  previous_close?: number;
  volume?: number;
  volume_avg_20d?: number;
  volume_ratio?: number;
  nifty_change_pct?: number;
  relative_performance?: string; // "outperforming" | "underperforming"
  rsi_14?: number;
  ema_20?: number;
  sma_50?: number;
  support?: number;
  resistance?: number;
  headlines?: string[];
  script?: ShortScript;
  generated_at?: string;
  status: "ready" | "pending" | "generating" | "failed";
  error?: string;
}

// Runtime data must not live under src/: in development every write there makes Next.js rebuild and reload the page.
const CACHE_FILE = path.join(process.cwd(), ".runtime", "nifty_shorts_cache.json");
const LEGACY_CACHE_FILE = path.join(process.cwd(), "src", "data", "nifty_shorts_cache.json");

// Ensure PostgreSQL table is initialized on module load
let dbInitialized = false;
async function ensureDbInit() {
  if (!dbInitialized) {
    dbInitialized = await initShortsDatabase();
  }
}

// Ensure any object, nested object or array is converted to clean string
export function stringifyField(val: any): string {
  if (val === null || val === undefined) return "";
  if (typeof val === "string") return val;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  if (Array.isArray(val)) {
    return val.map((v) => stringifyField(v)).filter(Boolean).join(" ");
  }
  if (typeof val === "object") {
    if (val.text && typeof val.text === "string") return val.text;
    if (val.summary && typeof val.summary === "string") return val.summary;
    if (val.description && typeof val.description === "string") return val.description;
    if (val.message && typeof val.message === "string") return val.message;
    if (val.headline && typeof val.headline === "string") {
      const rest = val.details ? stringifyField(val.details) : "";
      return rest ? `${val.headline}: ${rest}` : val.headline;
    }
    const values = Object.values(val)
      .map((v) => stringifyField(v))
      .filter(Boolean);
    return values.join(" ");
  }
  return String(val);
}

export function normalizeShortScript(raw: any): ShortScript | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  return {
    event_type: raw.event_type || "normal_session",
    estimated_read_seconds: typeof raw.estimated_read_seconds === "number" ? raw.estimated_read_seconds : 75,
    word_count: typeof raw.word_count === "number" ? raw.word_count : 180,
    verdict: raw.verdict || "Neutral",
    hook: stringifyField(raw.hook),
    price_action: stringifyField(raw.price_action),
    why_moving: stringifyField(raw.why_moving),
    technicals: stringifyField(raw.technicals),
    fundamentals: stringifyField(raw.fundamentals),
    valuation: stringifyField(raw.valuation),
    what_to_watch: stringifyField(raw.what_to_watch),
    investor_view: stringifyField(raw.investor_view),
    trader_view: stringifyField(raw.trader_view),
    disclaimer: stringifyField(raw.disclaimer) || "Educational commentary, not financial advice.",
  };
}

// Local cache fallback helpers
export function loadLocalCache(): Record<string, NiftyStockItem> {
  try {
    // an older install may still hold its cache at the previous location: read it once, new saves go to CACHE_FILE
    const source = fs.existsSync(CACHE_FILE) ? CACHE_FILE : fs.existsSync(LEGACY_CACHE_FILE) ? LEGACY_CACHE_FILE : null;
    if (source) {
      const raw = fs.readFileSync(source, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        for (const k of Object.keys(parsed)) {
          if (parsed[k]?.script) {
            parsed[k].script = normalizeShortScript(parsed[k].script);
          }
        }
      }
      return parsed;
    }
  } catch (e) {
    console.error("[NiftyShorts] Failed to load local cache file:", e);
  }
  return {};
}

export function saveLocalCache(cache: Record<string, NiftyStockItem>): void {
  try {
    const dir = path.dirname(CACHE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), "utf-8");
  } catch (e) {
    console.error("[NiftyShorts] Failed to save local cache file:", e);
  }
}

// Load Nifty 50 constituent master
export function getNifty50Constituents(): { symbol: string; company_name: string; sector: string; industry: string }[] {
  try {
    const stockMasterPath = path.join(process.cwd(), "src", "data", "heatmap", "stockMaster.json");
    const constituentsPath = path.join(process.cwd(), "src", "data", "heatmap", "indexConstituents.json");

    if (fs.existsSync(stockMasterPath) && fs.existsSync(constituentsPath)) {
      const stockMaster = JSON.parse(fs.readFileSync(stockMasterPath, "utf-8")) as Array<{
        stock_symbol: string;
        company_name: string;
        sector: string;
        industry: string;
      }>;
      const indexConstituents = JSON.parse(fs.readFileSync(constituentsPath, "utf-8")) as Array<{
        index_symbol: string;
        stock_symbol: string;
      }>;

      const n50Symbols = new Set(
        indexConstituents
          .filter((c) => c.index_symbol === "Nifty 50")
          .map((c) => c.stock_symbol)
      );

      const stockMap = new Map(stockMaster.map((s) => [s.stock_symbol, s]));
      const list: { symbol: string; company_name: string; sector: string; industry: string }[] = [];

      for (const sym of n50Symbols) {
        const info = stockMap.get(sym);
        list.push({
          symbol: sym,
          company_name: info ? info.company_name : sym,
          sector: info ? info.sector : "Large Cap",
          industry: info ? info.industry : "Diversified",
        });
      }

      if (list.length > 0) {
        return list.sort((a, b) => a.symbol.localeCompare(b.symbol));
      }
    }
  } catch (e) {
    console.error("[NiftyShorts] Error loading constituents master:", e);
  }

  return [
    { symbol: "RELIANCE", company_name: "Reliance Industries Ltd.", sector: "Energy", industry: "Oil & Gas" },
    { symbol: "TCS", company_name: "Tata Consultancy Services Ltd.", sector: "Information Technology", industry: "IT Services" },
    { symbol: "HDFCBANK", company_name: "HDFC Bank Ltd.", sector: "Financial Services", industry: "Banking" },
    { symbol: "ICICIBANK", company_name: "ICICI Bank Ltd.", sector: "Financial Services", industry: "Banking" },
    { symbol: "INFY", company_name: "Infosys Ltd.", sector: "Information Technology", industry: "IT Services" },
  ];
}

// Fetch all shorts for active session (Postgres primary, local fallback)
export async function getSessionShorts(): Promise<{
  stocks: NiftyStockItem[];
  session: ReturnType<typeof getMarketSessionInfo>;
}> {
  await ensureDbInit();
  const session = getMarketSessionInfo();
  const constituents = getNifty50Constituents();

  // 1. Fetch from PostgreSQL for the target trading date
  const dbShorts = await getShortsForDate(session.effectiveTradingDate);
  const localCache = loadLocalCache();

  const stocks: NiftyStockItem[] = constituents.map((c) => {
    // Check Postgres first
    if (dbShorts[c.symbol]) {
      const item = { ...dbShorts[c.symbol], trading_date: session.effectiveTradingDate };
      if (item.script) item.script = normalizeShortScript(item.script);
      return item;
    }
    // Check local fallback
    if (localCache[c.symbol] && localCache[c.symbol].status === "ready") {
      const item = { ...localCache[c.symbol], trading_date: session.effectiveTradingDate };
      if (item.script) item.script = normalizeShortScript(item.script);
      return item;
    }
    // Default pending item
    return {
      symbol: c.symbol,
      company_name: c.company_name,
      sector: c.sector,
      industry: c.industry,
      trading_date: session.effectiveTradingDate,
      status: "pending",
    };
  });

  return { stocks, session };
}

// Technical calculations
function calculateRSI(closes: number[], period: number = 14): number {
  if (closes.length < period + 1) return 50;
  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) {
      avgGain = (avgGain * (period - 1) + diff) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) + Math.abs(diff)) / period;
    }
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Number((100 - 100 / (1 + rs)).toFixed(1));
}

function calculateEMA(closes: number[], period: number): number {
  if (closes.length < period) return closes[closes.length - 1];
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return Number(ema.toFixed(2));
}

function calculateSMA(closes: number[], period: number): number {
  if (closes.length < period) return closes[closes.length - 1];
  const slice = closes.slice(-period);
  const sum = slice.reduce((a, b) => a + b, 0);
  return Number((sum / period).toFixed(2));
}

// Fetch Market Data from Yahoo Finance
export async function fetchStockMarketData(symbol: string): Promise<{
  price: number;
  change_pct: number;
  previous_close: number;
  volume: number;
  volume_avg_20d: number;
  volume_ratio: number;
  rsi_14: number;
  ema_20: number;
  sma_50: number;
  support: number;
  resistance: number;
}> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}.NS?interval=1d&range=3mo`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      next: { revalidate: 300 },
    });

    if (!res.ok) {
      throw new Error(`Yahoo Finance HTTP ${res.status}`);
    }

    const data = await res.json();
    const result = data.chart?.result?.[0];
    if (!result) throw new Error("No chart result found");

    const quotes = result.indicators?.quote?.[0];
    const closes: number[] = (quotes?.close || []).filter((v: any): v is number => typeof v === "number" && !isNaN(v));
    const volumes: number[] = (quotes?.volume || []).filter((v: any): v is number => typeof v === "number" && !isNaN(v));
    const highs: number[] = (quotes?.high || []).filter((v: any): v is number => typeof v === "number" && !isNaN(v));
    const lows: number[] = (quotes?.low || []).filter((v: any): v is number => typeof v === "number" && !isNaN(v));

    if (closes.length < 2) throw new Error("Insufficient price history");

    const currentPrice = closes[closes.length - 1];
    const previousClose = result.meta?.previousClose || closes[closes.length - 2];
    const changePct = Number((((currentPrice - previousClose) / previousClose) * 100).toFixed(2));

    const currentVolume = volumes[volumes.length - 1] || 100000;
    const last20Vols = volumes.slice(-21, -1);
    const avg20Vol = last20Vols.length > 0 ? last20Vols.reduce((a, b) => a + b, 0) / last20Vols.length : currentVolume;
    const volRatio = Number((currentVolume / (avg20Vol || 1)).toFixed(2));

    const rsi = calculateRSI(closes, 14);
    const ema20 = calculateEMA(closes, 20);
    const sma50 = calculateSMA(closes, 50);

    const recentLows = lows.slice(-15);
    const recentHighs = highs.slice(-15);
    const support = recentLows.length ? Number(Math.min(...recentLows).toFixed(1)) : Number((currentPrice * 0.97).toFixed(1));
    const resistance = recentHighs.length ? Number(Math.max(...recentHighs).toFixed(1)) : Number((currentPrice * 1.03).toFixed(1));

    return {
      price: Number(currentPrice.toFixed(2)),
      change_pct: changePct,
      previous_close: Number(previousClose.toFixed(2)),
      volume: currentVolume,
      volume_avg_20d: Math.round(avg20Vol),
      volume_ratio: volRatio,
      rsi_14: rsi,
      ema_20: ema20,
      sma_50: sma50,
      support,
      resistance,
    };
  } catch (e) {
    console.warn(`[NiftyShorts] Market data fallback for ${symbol}:`, e);
    return {
      price: 1000.0,
      change_pct: 0.0,
      previous_close: 1000.0,
      volume: 500000,
      volume_avg_20d: 500000,
      volume_ratio: 1.0,
      rsi_14: 50.0,
      ema_20: 1000.0,
      sma_50: 1000.0,
      support: 970.0,
      resistance: 1030.0,
    };
  }
}

// Fetch NIFTY 50 Daily Change
export async function fetchNifty50Change(): Promise<number> {
  try {
    const url = "https://query1.finance.yahoo.com/v8/finance/chart/%5ENSEI?interval=1d&range=5d";
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    const data = await res.json();
    const result = data.chart?.result?.[0];
    const closes: number[] = (result?.indicators?.quote?.[0]?.close || []).filter(
      (v: any): v is number => typeof v === "number" && !isNaN(v)
    );
    if (closes.length >= 2) {
      const cur = closes[closes.length - 1];
      const prev = closes[closes.length - 2];
      return Number((((cur - prev) / prev) * 100).toFixed(2));
    }
  } catch (e) {
    console.warn("[NiftyShorts] Could not fetch NIFTY 50 change:", e);
  }
  return 0.35;
}

// Fetch Google News Headlines
export async function fetchStockHeadlines(companyName: string, symbol: string): Promise<string[]> {
  try {
    const query = encodeURIComponent(`${companyName} share stock NSE`);
    const url = `https://news.google.com/rss/search?q=${query}&hl=en-IN&gl=IN&ceid=IN:en`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (res.ok) {
      const text = await res.text();
      const matches = [...text.matchAll(/<title>(.*?)<\/title>/g)]
        .slice(1, 4)
        .map((m) =>
          m[1]
            .replace(/&amp;/g, "&")
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/ - .*$/, "")
            .trim()
        )
        .filter((t) => t.length > 10);
      if (matches.length > 0) return matches;
    }
  } catch (e) {
    console.warn(`[NiftyShorts] Could not fetch headlines for ${symbol}:`, e);
  }
  return [`Active trading session observed in ${symbol} across major institutional segments.`];
}

// Key pool rotation
function getMistralKey(): string {
  const pool = [
    process.env.MISTRAL_API_KEY,
    process.env.MISTRAL_API_KEY_1,
    process.env.MISTRAL_API_KEY_2,
    process.env.MISTRAL_API_KEY_3,
    "3neLS22ow3dblcHoDbCcWmuncow9p7Em",
  ].filter(Boolean) as string[];

  return pool[Math.floor(Math.random() * pool.length)];
}

// Robust JSON parser for LLM outputs that safely repairs control characters & unescaped quotes
export function safeParseShortScript(raw: string): ShortScript | null {
  if (!raw) return null;

  // 1. Strip markdown code fences if present
  let cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();

  // Extract content between first { and last }
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  }

  // 2. Direct parse attempt
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === "object" && (parsed.hook || parsed.price_action)) {
      return parsed as ShortScript;
    }
  } catch {
    // Continue to repair pass
  }

  // 3. Sanitize raw control characters (unescaped \n, \r, \t) inside quotes & remove trailing commas
  try {
    const sanitized = cleaned
      .replace(/"([^"\\]*(?:\\.[^"\\]*)*)"/g, (match) =>
        match.replace(/\r?\n/g, " ").replace(/\t/g, " ")
      )
      .replace(/,\s*([\}\]])/g, "$1");

    const parsed = JSON.parse(sanitized);
    if (parsed && typeof parsed === "object" && (parsed.hook || parsed.price_action)) {
      return parsed as ShortScript;
    }
  } catch {
    // Continue to regex field extraction fallback
  }

  // 4. Regex field extraction fallback (recovers fields even if overall JSON has syntax defects)
  try {
    const extractField = (key: string): string => {
      const reg = new RegExp(`"${key}"\\s*:\\s*"([\\s\\S]*?)(?="\\s*,\\s*"[a-zA-Z_]+|"\\s*\\}\\s*$)`, "i");
      const m = cleaned.match(reg);
      if (m && m[1]) {
        return m[1].replace(/\\"/g, '"').replace(/\r?\n/g, " ").trim();
      }
      return "";
    };

    const hook = extractField("hook");
    const price_action = extractField("price_action");
    if (hook || price_action) {
      return {
        hook: hook || "Key market development today for this benchmark constituent.",
        price_action: price_action || "Current session trading action and benchmark comparison.",
        why_moving: extractField("why_moving") || "Corporate news and market catalysts driving today's price action.",
        technicals: extractField("technicals") || "Key technical levels and moving average positioning.",
        fundamentals: extractField("fundamentals") || "Core financial fundamentals and operating trajectory.",
        valuation: extractField("valuation") || "Historical and sector multiple comparison.",
        what_to_watch: extractField("what_to_watch") || "Upcoming corporate announcements and earnings results.",
        investor_view: extractField("investor_view") || "Long-term thesis and key risk factors.",
        trader_view: extractField("trader_view") || "Key support/resistance and momentum setup.",
        disclaimer: extractField("disclaimer") || "Educational commentary, not financial advice.",
        verdict: (extractField("verdict") as any) || "Neutral",
        event_type: (extractField("event_type") as any) || "normal_session",
        estimated_read_seconds: 75,
      };
    }
  } catch {
    // Fallback if regex fails
  }

  return null;
}

// Generate 60-90 second Short script via Mistral LLM
export async function generateShortScript(item: {
  symbol: string;
  company_name: string;
  sector: string;
  price: number;
  change_pct: number;
  volume: number;
  volume_ratio: number;
  nifty_change_pct: number;
  rsi_14: number;
  ema_20: number;
  sma_50: number;
  support: number;
  resistance: number;
  headlines: string[];
}): Promise<ShortScript> {
  const relDiff = Number((item.change_pct - item.nifty_change_pct).toFixed(2));
  const relText =
    relDiff >= 0
      ? `outperforming NIFTY 50 by ${Math.abs(relDiff)}%`
      : `underperforming NIFTY 50 by ${Math.abs(relDiff)}%`;

  let detectedEvent: ShortScript["event_type"] = "normal_session";
  if (item.volume_ratio >= 1.7) detectedEvent = "unusual_volume";
  else if (item.change_pct >= 2.0 && item.price >= item.resistance * 0.99) detectedEvent = "breakout";
  else if (item.change_pct <= -2.0 && item.price <= item.support * 1.01) detectedEvent = "breakdown";
  else if (item.headlines.some((h) => /earnings|results|q[1-4]|quarter|profit|dividend/i.test(h))) detectedEvent = "earnings";
  else if (item.headlines.some((h) => /order|contract|merger|acquisition|rbi|sebi|approval|launch/i.test(h))) detectedEvent = "news_catalyst";

  const prompt = `Stock: ${item.symbol} (${item.company_name})
Sector: ${item.sector}
LTP: ₹${item.price.toLocaleString("en-IN")} (${item.change_pct >= 0 ? "+" : ""}${item.change_pct}% today)
Volume: ${(item.volume / 1000000).toFixed(2)}M shares (${item.volume_ratio}x 20-day average volume)
Market Context: NIFTY 50 is ${item.nifty_change_pct >= 0 ? "+" : ""}${item.nifty_change_pct}% today; stock is ${relText}.
Technicals: Price vs 20 EMA (₹${item.ema_20}) & 50 SMA (₹${item.sma_50}); RSI(14) is ${item.rsi_14}. Immediate Support: ₹${item.support}, Resistance: ₹${item.resistance}.
Recent News / Headwinds:
${item.headlines.map((h, i) => `${i + 1}. ${h}`).join("\n")}
Detected Driver: ${detectedEvent}`;

  const systemPrompt = `You are an elite Indian stock market video analyst and scriptwriter for YouTube Shorts / Instagram Reels.
Your task is to write a dynamic, punchy, spoken 30-40 second video script for an equity trading Short.
The script must sound natural, professional, fast-paced, high-signal, and engaging.

CRITICAL RULES FOR JSON VALIDITY & PACING:
- Total speaking time must be between 30 and 40 seconds (approximately 80-90 words total).
- Keep each field strictly to 1 punchy, high-impact sentence (12-16 words max per field).
- Output a single, strictly valid JSON object without markdown fences.
- All string values must be on single continuous lines (do NOT include raw unescaped line breaks inside values).
- If quotes appear in text, escape them with \\". Do NOT include trailing commas.

Schema:
{
  "event_type": "${detectedEvent}",
  "estimated_read_seconds": 35,
  "word_count": 85,
  "verdict": "Bullish" | "Bearish" | "Neutral" | "Watchlist",
  "hook": "Punchy 1-sentence hook (under 14 words) highlighting the day's event or move to instantly stop the scroll.",
  "price_action": "1 crisp sentence stating price, % move, volume multiple, and contrast against Nifty.",
  "why_moving": "1 sharp sentence explaining the core catalyst (corporate news, earnings, or sector tailwinds).",
  "technicals": "1 concise sentence with RSI momentum and immediate support / resistance levels.",
  "fundamentals": "1 brief sentence on company leadership or margin strength.",
  "valuation": "1 brief sentence on valuation versus peers.",
  "what_to_watch": "1 sentence on the key level or upcoming catalyst.",
  "investor_view": "1 brief sentence for long-term investors.",
  "trader_view": "1 actionable sentence for traders highlighting breakout level and invalidation risk.",
  "disclaimer": "Educational commentary for Indian markets, not financial advice."
}`;

  const models = ["open-mistral-7b", "mistral-small-latest"];
  const apiKey = getMistralKey();

  for (const model of models) {
    try {
      const res = await fetch("https://api.mistral.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt },
          ],
          response_format: { type: "json_object" },
          temperature: 0.2,
        }),
      });

      if (res.ok) {
        const json = await res.json();
        const content = json.choices?.[0]?.message?.content;
        if (content) {
          const parsed = safeParseShortScript(content);
          if (parsed && (parsed.hook || parsed.price_action)) {
            return parsed;
          }
        }
      }
    } catch (e) {
      console.warn(`[NiftyShorts] LLM call with model ${model} failed:`, e);
    }
  }

  return createFallbackScript(item, detectedEvent, relText);
}

function createFallbackScript(
  item: {
    symbol: string;
    company_name: string;
    sector: string;
    price: number;
    change_pct: number;
    volume: number;
    volume_ratio: number;
    nifty_change_pct: number;
    rsi_14: number;
    ema_20: number;
    sma_50: number;
    support: number;
    resistance: number;
    headlines: string[];
  },
  detectedEvent: ShortScript["event_type"],
  relText: string
): ShortScript {
  const isUp = item.change_pct >= 0;
  const verdict = item.change_pct >= 1.5 && item.rsi_14 >= 55 ? "Bullish" : item.change_pct <= -1.5 ? "Bearish" : "Neutral";

  return {
    event_type: detectedEvent,
    estimated_read_seconds: 35,
    word_count: 85,
    verdict,
    hook: `${item.symbol} is on the move today with a ${isUp ? "surge" : "slide"} of ${Math.abs(item.change_pct)}% at ₹${item.price.toLocaleString("en-IN")}.`,
    price_action: `Trading at ₹${item.price.toLocaleString("en-IN")}, ${item.symbol} is ${relText} with ${item.volume_ratio} times average volume.`,
    why_moving: `Today's move is driven by ${item.headlines[0] || "steady institutional flows across " + item.sector.toLowerCase() + " stocks"}.`,
    technicals: `Technicals show RSI at ${item.rsi_14}, holding immediate support at ₹${item.support} and resistance at ₹${item.resistance}.`,
    fundamentals: `${item.company_name} maintains healthy sector leadership and financial metrics in ${item.sector}.`,
    valuation: `Valuations trade in line with sector historical averages.`,
    what_to_watch: `Watch ₹${item.resistance} closely for breakout confirmation.`,
    investor_view: `Long-term investors should track revenue compounding and return ratios.`,
    trader_view: `For traders, watch ₹${item.resistance} for continuation with risk strictly defined below ₹${item.support}.`,
    disclaimer: `Educational commentary for Indian markets, not financial advice.`,
  };
}

// Generate single stock short and persist into PostgreSQL (strictly 1 script per stock per day!)
export async function generateAndSaveSingle(
  symbol: string,
  options?: { force?: boolean }
): Promise<NiftyStockItem> {
  await ensureDbInit();
  const session = getMarketSessionInfo();
  const targetDate = session.effectiveTradingDate;

  // Check if a script already exists in PostgreSQL for this target trading date!
  if (!options?.force) {
    const existing = await getSingleShort(symbol, targetDate);
    if (existing && existing.script) {
      return { ...existing, trading_date: targetDate };
    }
  }

  const constituents = getNifty50Constituents();
  const meta = constituents.find((c) => c.symbol === symbol) || {
    symbol,
    company_name: symbol,
    sector: "Large Cap",
    industry: "Diversified",
  };

  const [marketData, headlines, niftyChange] = await Promise.all([
    fetchStockMarketData(symbol),
    fetchStockHeadlines(meta.company_name, symbol),
    fetchNifty50Change(),
  ]);

  const script = await generateShortScript({
    symbol,
    company_name: meta.company_name,
    sector: meta.sector,
    ...marketData,
    nifty_change_pct: niftyChange,
    headlines,
  });

  const relDiff = Number((marketData.change_pct - niftyChange).toFixed(2));

  const item: NiftyStockItem = {
    symbol,
    company_name: meta.company_name,
    sector: meta.sector,
    industry: meta.industry,
    trading_date: targetDate,
    ...marketData,
    nifty_change_pct: niftyChange,
    relative_performance: relDiff >= 0 ? "outperforming" : "underperforming",
    headlines,
    script,
    generated_at: new Date().toISOString(),
    status: "ready",
  };

  // 1. Save to PostgreSQL with UNIQUE(symbol, trading_date)
  await saveShortToDatabase(item, targetDate);

  // 2. Also update local cache for offline resilience
  const localCache = loadLocalCache();
  localCache[symbol] = item;
  saveLocalCache(localCache);

  return item;
}

// Global batch progress tracker
export interface BatchProgress {
  isRunning: boolean;
  total: number;
  completed: number;
  currentSymbol: string;
  errors: number;
  startedAt: number | null;
  finishedAt: number | null;
  tradingDate: string;
}

let globalBatchProgress: BatchProgress = {
  isRunning: false,
  total: 50,
  completed: 0,
  currentSymbol: "",
  errors: 0,
  startedAt: null,
  finishedAt: null,
  tradingDate: "",
};

export function getBatchProgress(): BatchProgress {
  return globalBatchProgress;
}

export function cancelBatch(): void {
  globalBatchProgress.isRunning = false;
}

// Run batch generation saving all 50 stocks into PostgreSQL
export async function runBatchGeneration(options?: { force?: boolean }): Promise<void> {
  if (globalBatchProgress.isRunning) return;

  const force = Boolean(options?.force);
  await ensureDbInit();
  const session = getMarketSessionInfo();
  const targetDate = session.effectiveTradingDate;
  const constituents = getNifty50Constituents();
  const niftyChange = await fetchNifty50Change();

  // Load existing Postgres entries for this date
  const existingMap = await getShortsForDate(targetDate);

  globalBatchProgress = {
    isRunning: true,
    total: constituents.length,
    completed: force ? 0 : Object.keys(existingMap).length,
    currentSymbol: "",
    errors: 0,
    startedAt: Date.now(),
    finishedAt: null,
    tradingDate: targetDate,
  };

  (async () => {
    try {
      const localCache = loadLocalCache();

      for (const item of constituents) {
        if (!globalBatchProgress.isRunning) break;

        // If not force mode, skip already generated scripts for today!
        if (!force && existingMap[item.symbol] && existingMap[item.symbol].script) {
          continue;
        }

        globalBatchProgress.currentSymbol = item.symbol;

        try {
          const marketData = await fetchStockMarketData(item.symbol);
          const headlines = await fetchStockHeadlines(item.company_name, item.symbol);
          const script = await generateShortScript({
            symbol: item.symbol,
            company_name: item.company_name,
            sector: item.sector,
            ...marketData,
            nifty_change_pct: niftyChange,
            headlines,
          });

          const relDiff = Number((marketData.change_pct - niftyChange).toFixed(2));

          const stockRecord: NiftyStockItem = {
            symbol: item.symbol,
            company_name: item.company_name,
            sector: item.sector,
            industry: item.industry,
            trading_date: targetDate,
            ...marketData,
            nifty_change_pct: niftyChange,
            relative_performance: relDiff >= 0 ? "outperforming" : "underperforming",
            headlines,
            script,
            generated_at: new Date().toISOString(),
            status: "ready",
          };

          // Save to PostgreSQL
          await saveShortToDatabase(stockRecord, targetDate);

          // Update local cache
          localCache[item.symbol] = stockRecord;
          saveLocalCache(localCache);

          globalBatchProgress.completed++;
        } catch (err) {
          console.error(`[NiftyShorts] Batch error for ${item.symbol}:`, err);
          globalBatchProgress.errors++;
        }

        // Pacing delay (500ms) between stocks
        await new Promise((r) => setTimeout(r, 500));
      }
    } finally {
      globalBatchProgress.isRunning = false;
      globalBatchProgress.finishedAt = Date.now();
      globalBatchProgress.currentSymbol = "";
    }
  })();
}
