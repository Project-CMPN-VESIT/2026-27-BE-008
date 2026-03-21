import { NextRequest, NextResponse } from "next/server";
import { getChartHistory, getLiveQuote, resolveMarket } from "@/lib/tradingview";

const fallbackBaseBySymbol: Record<string, number> = {
  RELIANCE: 1414.4,
  INFY: 1602.15,
  TCS: 3935.7,
  ADANIENT: 1928.9,
  HDFCBANK: 1578.1,
  ICICIBANK: 1297.5,
  SBIN: 734.8,
};

type HistoryPoint = {
  time: string;
  price: number;
};

const normalizeSymbol = (value: string) => {
  const cleaned = value.trim().toUpperCase().replace(/^NSE[_:]/, "");
  return cleaned || "RELIANCE";
};

const buildFallbackHistory = (base: number): HistoryPoint[] => {
  const labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Mon", "Tue", "Wed", "Thu", "Fri"];
  return labels.map((time, index) => ({
    time,
    price: Number((base + Math.sin(index) * base * 0.01).toFixed(2)),
  }));
};

const buildFallbackPayload = (symbol: string) => {
  const base = fallbackBaseBySymbol[symbol] ?? 1000;
  return {
    symbol,
    marketId: `NSE:${symbol}`,
    exchange: "NSE",
    companyName: symbol,
    ltp: base,
    change: 0,
    pChange: 0,
    dayHigh: Number((base * 1.01).toFixed(2)),
    dayLow: Number((base * 0.99).toFixed(2)),
    history: buildFallbackHistory(base),
    source: "fallback",
    updatedAt: new Date().toISOString(),
  };
};

export async function GET(request: NextRequest) {
  const inputSymbol = normalizeSymbol(request.nextUrl.searchParams.get("symbol") ?? "RELIANCE");
  const requestedMarketId = request.nextUrl.searchParams.get("marketId");

  try {
    const resolved = requestedMarketId
      ? {
          marketId: requestedMarketId,
          exchange: requestedMarketId.split(":")[0] ?? "NSE",
          symbol: requestedMarketId.split(":")[1] ?? inputSymbol,
          companyName: requestedMarketId,
        }
      : await resolveMarket(inputSymbol);

    if (!resolved) {
      return NextResponse.json(
        {
          ok: true,
          data: {
            ...buildFallbackPayload(inputSymbol),
            note: "No live NSE match found for symbol",
          },
        },
        { status: 200 }
      );
    }

    const quote = await getLiveQuote(resolved.marketId);
    const history = await getChartHistory(resolved.marketId, 50);

    return NextResponse.json({
      ok: true,
      data: {
        symbol: resolved.symbol,
        marketId: resolved.marketId,
        exchange: resolved.exchange,
        companyName: resolved.companyName,
        ltp: quote.ltp,
        change: quote.change,
        pChange: quote.pChange,
        dayHigh: quote.dayHigh,
        dayLow: quote.dayLow,
        volume: quote.volume,
        history: history.length ? history : buildFallbackHistory(quote.ltp),
        source: "tradingview-api",
        updatedAt: new Date().toISOString(),
      },
    });
  } catch {
    return NextResponse.json(
      {
        ok: true,
        data: buildFallbackPayload(inputSymbol),
      },
      { status: 200 }
    );
  }
}
