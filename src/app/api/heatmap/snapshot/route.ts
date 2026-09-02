import { NextRequest, NextResponse } from "next/server";
import { marketDataService } from "@/lib/tradingview";
import indexConstituentsJson from "@/data/heatmap/indexConstituents.json";

export const dynamic = "force-dynamic";

// Pre-subscribe Nifty 50 constituents on module initialization
const DEFAULT_SYMBOLS = (indexConstituentsJson as Array<{ index_id: string; stock_symbol: string }>)
  .filter((c) => c.index_id === "IDX_1")
  .map((c) => `NSE:${c.stock_symbol.replace(/[-&]/g, "_")}`);

try {
  if (DEFAULT_SYMBOLS.length > 0) {
    marketDataService.subscribe(DEFAULT_SYMBOLS);
  }
} catch {
  // Ignore subscription error on init
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const symbolsParam = url.searchParams.get("symbols");

  if (!symbolsParam) {
    return NextResponse.json({ error: "Missing symbols" }, { status: 400 });
  }

  const symbols = symbolsParam.split(",").map((s) => s.trim()).filter(Boolean);
  const result: Record<string, any> = {};

  if (symbols.length > 0) {
    marketDataService.subscribe(symbols);

    // Fast adaptive wait (up to 300ms) for newly requested symbols if not in cache yet
    const missing = symbols.filter((s) => !marketDataService.getLatest(s));
    if (missing.length > 0) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 300);
        const checkInterval = setInterval(() => {
          const stillMissing = symbols.filter((s) => !marketDataService.getLatest(s));
          if (stillMissing.length === 0 || stillMissing.length < missing.length / 2) {
            clearInterval(checkInterval);
            clearTimeout(timer);
            resolve();
          }
        }, 25);
      });
    }
  }

  for (const symbol of symbols) {
    const cached = marketDataService.getLatest(symbol);
    if (cached) {
      result[symbol] = cached;
    }
  }

  return NextResponse.json(result, {
    headers: {
      "Cache-Control": "public, max-age=1, stale-while-revalidate=5",
    },
  });
}
