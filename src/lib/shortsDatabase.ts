import "@/lib/dns-fallback";
import { Pool } from "pg";
import type { NiftyStockItem } from "@/lib/niftyShortsService";

let pool: Pool | null = null;

function getPool(): Pool | null {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.warn("[ShortsDB] DATABASE_URL not found, using memory/local fallback");
    return null;
  }

  if (!pool) {
    let connectionString = dbUrl;
    if (connectionString.includes("sslmode=require") && !connectionString.includes("uselibpqcompat=")) {
      connectionString += (connectionString.includes("?") ? "&" : "?") + "uselibpqcompat=true";
    }

    pool = new Pool({
      connectionString,
      ssl: {
        rejectUnauthorized: false,
      },
      max: 10,
      idleTimeoutMillis: 30000,
    });
  }
  return pool;
}

// Initialize PostgreSQL schema
export async function initShortsDatabase(): Promise<boolean> {
  const clientPool = getPool();
  if (!clientPool) return false;

  try {
    const client = await clientPool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS nifty_shorts (
          id SERIAL PRIMARY KEY,
          symbol VARCHAR(20) NOT NULL,
          company_name VARCHAR(150),
          sector VARCHAR(100),
          industry VARCHAR(100),
          trading_date DATE NOT NULL,
          price NUMERIC(12, 2),
          change_pct NUMERIC(6, 2),
          previous_close NUMERIC(12, 2),
          volume BIGINT,
          volume_avg_20d BIGINT,
          volume_ratio NUMERIC(6, 2),
          nifty_change_pct NUMERIC(6, 2),
          relative_performance VARCHAR(20),
          rsi_14 NUMERIC(6, 2),
          ema_20 NUMERIC(12, 2),
          sma_50 NUMERIC(12, 2),
          support NUMERIC(12, 2),
          resistance NUMERIC(12, 2),
          headlines JSONB,
          script JSONB NOT NULL,
          event_type VARCHAR(50),
          verdict VARCHAR(20),
          created_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(symbol, trading_date)
        );

        CREATE INDEX IF NOT EXISTS idx_nifty_shorts_date ON nifty_shorts(trading_date);
        CREATE INDEX IF NOT EXISTS idx_nifty_shorts_symbol_date ON nifty_shorts(symbol, trading_date);
      `);
      return true;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("[ShortsDB] Failed to initialize table in PostgreSQL:", err);
    return false;
  }
}

// Fetch all stock shorts for a given trading date
export async function getShortsForDate(tradingDate: string): Promise<Record<string, NiftyStockItem>> {
  const clientPool = getPool();
  if (!clientPool) return {};

  try {
    const res = await clientPool.query(
      `SELECT * FROM nifty_shorts WHERE trading_date = $1`,
      [tradingDate]
    );

    const map: Record<string, NiftyStockItem> = {};
    for (const r of res.rows) {
      map[r.symbol] = {
        symbol: r.symbol,
        company_name: r.company_name,
        sector: r.sector,
        industry: r.industry,
        price: r.price !== null ? parseFloat(r.price) : undefined,
        change_pct: r.change_pct !== null ? parseFloat(r.change_pct) : undefined,
        previous_close: r.previous_close !== null ? parseFloat(r.previous_close) : undefined,
        volume: r.volume !== null ? parseInt(r.volume, 10) : undefined,
        volume_avg_20d: r.volume_avg_20d !== null ? parseInt(r.volume_avg_20d, 10) : undefined,
        volume_ratio: r.volume_ratio !== null ? parseFloat(r.volume_ratio) : undefined,
        nifty_change_pct: r.nifty_change_pct !== null ? parseFloat(r.nifty_change_pct) : undefined,
        relative_performance: r.relative_performance,
        rsi_14: r.rsi_14 !== null ? parseFloat(r.rsi_14) : undefined,
        ema_20: r.ema_20 !== null ? parseFloat(r.ema_20) : undefined,
        sma_50: r.sma_50 !== null ? parseFloat(r.sma_50) : undefined,
        support: r.support !== null ? parseFloat(r.support) : undefined,
        resistance: r.resistance !== null ? parseFloat(r.resistance) : undefined,
        headlines: Array.isArray(r.headlines) ? r.headlines : [],
        script: r.script,
        generated_at: r.created_at ? new Date(r.created_at).toISOString() : undefined,
        status: "ready",
      };
    }
    return map;
  } catch (err) {
    console.error(`[ShortsDB] Query error for date ${tradingDate}:`, err);
    return {};
  }
}

// Fetch single stock short for a specific date
export async function getSingleShort(symbol: string, tradingDate: string): Promise<NiftyStockItem | null> {
  const clientPool = getPool();
  if (!clientPool) return null;

  try {
    const res = await clientPool.query(
      `SELECT * FROM nifty_shorts WHERE symbol = $1 AND trading_date = $2 LIMIT 1`,
      [symbol, tradingDate]
    );

    if (res.rows.length === 0) return null;
    const r = res.rows[0];

    return {
      symbol: r.symbol,
      company_name: r.company_name,
      sector: r.sector,
      industry: r.industry,
      price: r.price !== null ? parseFloat(r.price) : undefined,
      change_pct: r.change_pct !== null ? parseFloat(r.change_pct) : undefined,
      previous_close: r.previous_close !== null ? parseFloat(r.previous_close) : undefined,
      volume: r.volume !== null ? parseInt(r.volume, 10) : undefined,
      volume_avg_20d: r.volume_avg_20d !== null ? parseInt(r.volume_avg_20d, 10) : undefined,
      volume_ratio: r.volume_ratio !== null ? parseFloat(r.volume_ratio) : undefined,
      nifty_change_pct: r.nifty_change_pct !== null ? parseFloat(r.nifty_change_pct) : undefined,
      relative_performance: r.relative_performance,
      rsi_14: r.rsi_14 !== null ? parseFloat(r.rsi_14) : undefined,
      ema_20: r.ema_20 !== null ? parseFloat(r.ema_20) : undefined,
      sma_50: r.sma_50 !== null ? parseFloat(r.sma_50) : undefined,
      support: r.support !== null ? parseFloat(r.support) : undefined,
      resistance: r.resistance !== null ? parseFloat(r.resistance) : undefined,
      headlines: Array.isArray(r.headlines) ? r.headlines : [],
      script: r.script,
      generated_at: r.created_at ? new Date(r.created_at).toISOString() : undefined,
      status: "ready",
    };
  } catch (err) {
    console.error(`[ShortsDB] Query error for ${symbol} on ${tradingDate}:`, err);
    return null;
  }
}

// Upsert stock short into PostgreSQL — enforces 1 script per stock per day!
export async function saveShortToDatabase(item: NiftyStockItem, tradingDate: string): Promise<boolean> {
  const clientPool = getPool();
  if (!clientPool || !item.script) return false;

  try {
    await clientPool.query(
      `
      INSERT INTO nifty_shorts (
        symbol, company_name, sector, industry, trading_date,
        price, change_pct, previous_close, volume, volume_avg_20d,
        volume_ratio, nifty_change_pct, relative_performance,
        rsi_14, ema_20, sma_50, support, resistance,
        headlines, script, event_type, verdict, created_at
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10,
        $11, $12, $13,
        $14, $15, $16, $17, $18,
        $19, $20, $21, $22, NOW()
      )
      ON CONFLICT (symbol, trading_date) DO UPDATE SET
        price = EXCLUDED.price,
        change_pct = EXCLUDED.change_pct,
        previous_close = EXCLUDED.previous_close,
        volume = EXCLUDED.volume,
        volume_avg_20d = EXCLUDED.volume_avg_20d,
        volume_ratio = EXCLUDED.volume_ratio,
        nifty_change_pct = EXCLUDED.nifty_change_pct,
        relative_performance = EXCLUDED.relative_performance,
        rsi_14 = EXCLUDED.rsi_14,
        ema_20 = EXCLUDED.ema_20,
        sma_50 = EXCLUDED.sma_50,
        support = EXCLUDED.support,
        resistance = EXCLUDED.resistance,
        headlines = EXCLUDED.headlines,
        script = EXCLUDED.script,
        event_type = EXCLUDED.event_type,
        verdict = EXCLUDED.verdict,
        created_at = NOW();
      `,
      [
        item.symbol,
        item.company_name,
        item.sector,
        item.industry,
        tradingDate,
        item.price ?? null,
        item.change_pct ?? null,
        item.previous_close ?? null,
        item.volume ?? null,
        item.volume_avg_20d ?? null,
        item.volume_ratio ?? null,
        item.nifty_change_pct ?? null,
        item.relative_performance ?? null,
        item.rsi_14 ?? null,
        item.ema_20 ?? null,
        item.sma_50 ?? null,
        item.support ?? null,
        item.resistance ?? null,
        JSON.stringify(item.headlines || []),
        JSON.stringify(item.script),
        item.script.event_type,
        item.script.verdict,
      ]
    );
    return true;
  } catch (err) {
    console.error(`[ShortsDB] Save error for ${item.symbol} on ${tradingDate}:`, err);
    return false;
  }
}
