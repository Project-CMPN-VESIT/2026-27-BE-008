import { NextRequest, NextResponse } from "next/server";
import { marketDataService } from "@/lib/tradingview";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const symbolsParam = url.searchParams.get("symbols");
  
  if (!symbolsParam) {
    return NextResponse.json({ error: "Missing symbols" }, { status: 400 });
  }

  const symbols = symbolsParam.split(",").map(s => s.trim()).filter(Boolean);
  const result: Record<string, any> = {};

  // Request the service to subscribe to these symbols to ensure they are active
  // This is non-blocking. The SSE stream will manage the actual active subscriptions.
  if (symbols.length > 0) {
    marketDataService.subscribe(symbols);
  }

  for (const symbol of symbols) {
    const cached = marketDataService.getLatest(symbol);
    if (cached) {
      result[symbol] = cached;
    }
  }

  return NextResponse.json(result);
}
