import { NextRequest, NextResponse } from "next/server";
import { getLiveQuote, resolveMarket } from "@/lib/tradingview";

const fallbackPrices: Record<string, number> = {
  NSE_ADANIENT: 1928.9,
  NSE_RELIANCE: 1414.4,
  NSE_INFY: 1602.15,
  NSE_HDFCBANK: 1578.1,
};

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol") ?? "NSE_ADANIENT";
  const company = request.nextUrl.searchParams.get("company") ?? symbol;
  const normalizedSymbol = symbol.replace(/^NSE_/, "");

  try {
    const resolved = await resolveMarket(normalizedSymbol);

    if (!resolved) {
      return NextResponse.json(
        {
          ok: true,
          data: {
            symbol,
            company,
            ltp: fallbackPrices[symbol] ?? 0,
            source: "fallback",
            updatedAt: new Date().toISOString(),
          },
        },
        { status: 200 }
      );
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
      { status: 200 }
    );
  } catch {
    return NextResponse.json(
      {
        ok: true,
        data: {
          symbol,
          company,
          ltp: fallbackPrices[symbol] ?? 0,
          source: "fallback",
          updatedAt: new Date().toISOString(),
        },
      },
      { status: 200 }
    );
  }
}
