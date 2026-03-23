import { NextRequest, NextResponse } from "next/server";
import { getLiveQuote, resolveMarket } from "@/lib/tradingview";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
};

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
        {
          status: 200,
          headers: noStoreHeaders,
        }
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
      {
        status: 200,
        headers: noStoreHeaders,
      }
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
      {
        status: 200,
        headers: noStoreHeaders,
      }
    );
  }
}
