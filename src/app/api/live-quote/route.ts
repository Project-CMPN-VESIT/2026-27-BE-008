import { NextRequest, NextResponse } from "next/server";
import { getLiveQuote, resolveMarket } from "@/lib/tradingview";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
};

// A made-up "fallback" price is worse than no price in a trading product: it looked live and fed order estimates.
const SYMBOL_PATTERN = /^[A-Za-z0-9&_.:-]{1,30}$/;

const unavailable = (symbol: string, company: string) =>
  NextResponse.json(
    { ok: true, data: { symbol, company, ltp: 0, source: "unavailable", updatedAt: new Date().toISOString() } },
    { status: 200, headers: noStoreHeaders }
  );

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol")?.trim() ?? "";
  if (!symbol || !SYMBOL_PATTERN.test(symbol)) {
    return NextResponse.json(
      { ok: false, error: "A valid symbol is required" },
      { status: 400, headers: noStoreHeaders }
    );
  }
  const company = (request.nextUrl.searchParams.get("company") ?? symbol).slice(0, 80);
  const normalizedSymbol = symbol.replace(/^NSE_/, "");

  try {
    const resolved = await resolveMarket(normalizedSymbol);

    if (!resolved) {
      return unavailable(symbol, company);
    }

    const quote = await getLiveQuote(resolved.marketId);

    return NextResponse.json(
      {
        ok: true,
        data: {
          symbol,
          company,
          ltp: quote.ltp,
          dayChange: quote.change,
          dayChangePerc: quote.pChange,
          source: "live",
          updatedAt: new Date().toISOString(),
        },
      },
      {
        status: 200,
        headers: noStoreHeaders,
      }
    );
  } catch {
    return unavailable(symbol, company);
  }
}
