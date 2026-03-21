import { NextRequest, NextResponse } from "next/server";
import { getCandleHistory, getLiveQuote, resolveMarket } from "@/lib/tradingview";
import { getScreenerSnapshot } from "@/lib/screener";

const allowedTimeframes = new Set(["1", "3", "5", "15", "30", "60", "120", "240", "D", "W", "M"]);

const toNumber = (value: string | null, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const getSma = (values: number[], period: number) => {
  if (values.length < period) {
    return null;
  }
  const recent = values.slice(-period);
  const total = recent.reduce((sum, current) => sum + current, 0);
  return total / period;
};

const getRsi = (closes: number[], period = 14) => {
  if (closes.length <= period) {
    return null;
  }

  let gains = 0;
  let losses = 0;

  for (let i = closes.length - period; i < closes.length; i += 1) {
    const delta = closes[i] - closes[i - 1];
    if (delta > 0) gains += delta;
    if (delta < 0) losses += Math.abs(delta);
  }

  if (losses === 0) {
    return 100;
  }

  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
};

export async function GET(request: NextRequest) {
  const inputSymbol = request.nextUrl.searchParams.get("symbol")?.trim() ?? "RELIANCE";
  const requestedMarketId = request.nextUrl.searchParams.get("marketId")?.trim();
  const timeframeRaw = (request.nextUrl.searchParams.get("timeframe") ?? "D").toUpperCase();
  const timeframe = allowedTimeframes.has(timeframeRaw) ? timeframeRaw : "D";
  const range = toNumber(request.nextUrl.searchParams.get("range"), 120);

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

    const [quoteResult, candlesResult, screenerResult] = await Promise.allSettled([
      getLiveQuote(resolved.marketId),
      getCandleHistory(resolved.marketId, timeframe, range),
      getScreenerSnapshot(resolved.symbol),
    ]);

    const quote = quoteResult.status === "fulfilled"
      ? quoteResult.value
      : {
          ltp: 0,
          change: 0,
          pChange: 0,
        };

    const candles = candlesResult.status === "fulfilled" ? candlesResult.value : [];
    const screener = screenerResult.status === "fulfilled" ? screenerResult.value : null;

    const closes = candles.map((item) => item.close);

    return NextResponse.json({
      ok: true,
      data: {
        symbol: resolved.symbol,
        marketId: resolved.marketId,
        exchange: resolved.exchange,
        companyName: resolved.companyName,
        timeframe,
        quote,
        candles,
        technicals: {
          sma20: getSma(closes, 20),
          sma50: getSma(closes, 50),
          rsi14: getRsi(closes, 14),
        },
        fundamentals: screener?.fundamentals ?? {
          marketCap: null,
          peRatio: null,
          pbRatio: null,
          roe: null,
          eps: null,
          dividendYield: null,
          bookValue: null,
          faceValue: null,
          debtToEquity: null,
        },
        financials: screener?.financials ?? {
          revenueTtm: null,
          netProfitTtm: null,
          operatingProfitTtm: null,
          totalAssets: null,
          totalLiabilities: null,
        },
        note:
          quoteResult.status === "rejected" || candlesResult.status === "rejected" || screenerResult.status === "rejected"
            ? "Some feeds are delayed, serving available market data"
            : undefined,
        updatedAt: new Date().toISOString(),
        source: "tradingview-api + screener.in",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "TradingView chart request failed",
      },
      { status: 500 }
    );
  }
}
