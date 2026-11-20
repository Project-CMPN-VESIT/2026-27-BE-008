import { NextResponse } from "next/server";
import { getCandleHistory, marketDataService } from "@/lib/tradingview";
import indexConstituentsJson from "@/data/heatmap/indexConstituents.json";

export const dynamic = "force-dynamic";

/**
 * Real market numbers for the ticker bar and the home page: benchmark indices, sector indices,
 * a few large caps and Nifty 50 breadth, all from the TradingView feed (never hard-coded).
 */
const INDICES = [
  { name: "Nifty 50", id: "NSE:NIFTY" },
  { name: "BSE Sensex", id: "BSE:SENSEX" },
  { name: "Nifty Bank", id: "NSE:BANKNIFTY" },
  { name: "India VIX", id: "NSE:INDIAVIX" },
  { name: "Nifty Midcap 100", id: "NSE:CNXMIDCAP" },
  { name: "Nifty Smallcap 100", id: "NSE:CNXSMALLCAP" },
  { name: "Nifty 500", id: "NSE:CNX500" },
];
const SECTORS = [
  { name: "NIFTY IT", id: "NSE:CNXIT" },
  { name: "NIFTY BANK", id: "NSE:BANKNIFTY" },
  { name: "NIFTY AUTO", id: "NSE:CNXAUTO" },
  { name: "NIFTY PHARMA", id: "NSE:CNXPHARMA" },
  { name: "NIFTY FMCG", id: "NSE:CNXFMCG" },
];
const TRENDING = ["RELIANCE", "HDFCBANK", "TCS", "INFY"].map((s) => ({ name: s, id: `NSE:${s}` }));
const NIFTY50 = (indexConstituentsJson as Array<{ index_id: string; stock_symbol: string }>)
  .filter((c) => c.index_id === "IDX_1")
  .map((c) => `NSE:${c.stock_symbol.replace(/[-&]/g, "_")}`);

const SPARK_IDS = INDICES.slice(0, 4).map((i) => i.id);
const CACHE_MS = 5_000;

type Row = { name: string; id: string; value: number; change: number; pct: number; high?: number; low?: number; spark?: number[] };
let cache: { at: number; payload: unknown } | null = null;
let inflight: Promise<unknown> | null = null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForQuotes(ids: string[], maxMs: number) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (ids.every((id) => (marketDataService.getLatest(id)?.ltp ?? 0) > 0)) return;
    await sleep(40);
  }
}

function rowFor(def: { name: string; id: string }): Row | null {
  const q = marketDataService.getLatest(def.id);
  if (!q || !(q.ltp > 0)) return null;
  return { ...def, value: q.ltp, change: q.change ?? 0, pct: q.pChange ?? 0, high: q.dayHigh, low: q.dayLow };
}

async function build() {
  const all = [...INDICES, ...SECTORS, ...TRENDING];
  marketDataService.subscribe([...all.map((d) => d.id), ...NIFTY50]);
  await waitForQuotes(all.map((d) => d.id), 1800);

  const sparks = await Promise.allSettled(
    SPARK_IDS.map((id) =>
      Promise.race([
        getCandleHistory(id, "D", 30),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 1200)),
      ])
    )
  );
  const sparkById = new Map<string, number[]>();
  sparks.forEach((result, i) => {
    if (result.status === "fulfilled" && result.value.length > 1) {
      sparkById.set(SPARK_IDS[i], result.value.map((c) => c.close));
    }
  });

  const indices = INDICES.map(rowFor).filter((r): r is Row => r !== null).map((r) => ({ ...r, spark: sparkById.get(r.id) }));
  const sectors = SECTORS.map(rowFor).filter((r): r is Row => r !== null);
  const trending = TRENDING.map(rowFor).filter((r): r is Row => r !== null);

  let advances = 0;
  let declines = 0;
  let unchanged = 0;
  for (const id of NIFTY50) {
    const q = marketDataService.getLatest(id);
    if (!q || !(q.ltp > 0)) continue;
    if (q.pChange > 0) advances += 1;
    else if (q.pChange < 0) declines += 1;
    else unchanged += 1;
  }

  return {
    ok: true,
    updatedAt: new Date().toISOString(),
    indices,
    sectors,
    trending,
    breadth: { advances, declines, unchanged, universe: "Nifty 50" },
  };
}

export async function GET() {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) {
    return NextResponse.json(cache.payload, { headers: { "Cache-Control": "no-store" } });
  }
  try {
    // concurrent requests share one build instead of each waiting on the feed
    inflight = inflight ?? build().finally(() => { inflight = null; });
    const payload = await inflight;
    cache = { at: Date.now(), payload };
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (cache) return NextResponse.json(cache.payload, { headers: { "Cache-Control": "no-store" } });
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Market data unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
