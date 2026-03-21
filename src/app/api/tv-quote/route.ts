import { NextRequest, NextResponse } from "next/server";
import { getLiveQuote, resolveMarket } from "@/lib/tradingview";

export async function GET(request: NextRequest) {
  const requestedMarketId = request.nextUrl.searchParams.get("marketId")?.trim();
  const inputSymbol = request.nextUrl.searchParams.get("symbol")?.trim() ?? "RELIANCE";

  try {
    const resolved = requestedMarketId
      ? {
          marketId: requestedMarketId,
          exchange: requestedMarketId.split(":")[0] ?? "NSE",
          symbol: requestedMarketId.split(":")[1] ?? inputSymbol.toUpperCase(),
          companyName: requestedMarketId,
        }
      : await resolveMarket(inputSymbol);

    if (!resolved) {
      return NextResponse.json(
        {
          ok: false,
          error: "No matching market found",
        },
        { status: 404 }
      );
    }

    const quote = await getLiveQuote(resolved.marketId);

    return NextResponse.json({
      ok: true,
      data: {
        symbol: resolved.symbol,
        marketId: resolved.marketId,
        exchange: resolved.exchange,
        quote,
        updatedAt: new Date().toISOString(),
        source: "tradingview-api",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unable to fetch live quote",
      },
      { status: 500 }
    );
  }
}
