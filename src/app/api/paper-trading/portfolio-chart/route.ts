import { NextRequest, NextResponse } from "next/server";
import { getCandleHistory, TvCandle } from "@/lib/tradingview";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const API_BASE = "http://127.0.0.1:8001/api";
const INITIAL_CAPITAL = 1_000_000;

type Position = {
  ticker: string;
  quantity: number;
  average_buy_price: number;
};

// Global cache for individual stock candles
const stockCandleGlobalCache = new Map<string, { candles: TvCandle[]; timestamp: number }>();

// Cache composite portfolio chart
const chartCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL_MS = 180_000; // 3 minutes cache for composite chart (invalidated automatically on trade)

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get("userId") || "test_user";
  const range = (request.nextUrl.searchParams.get("range") || "1D").toUpperCase();
  const metricType = request.nextUrl.searchParams.get("metric") || "total"; // "total" or "holdings"

  const nowMs = Date.now();
  const nowSec = Math.floor(nowMs / 1000);

  try {
    // Fetch user portfolio first
    const portfolioRes = await fetch(`${API_BASE}/portfolio/${userId}`, { cache: "no-store" });
    if (!portfolioRes.ok) throw new Error("Failed to fetch user portfolio");
    const portfolioData = await portfolioRes.json();

    const cash = Number(portfolioData.balance) || 0;
    const positions: Position[] = portfolioData.positions || [];

    const portfolioFingerprint = positions.map((p) => `${p.ticker}:${p.quantity}:${p.average_buy_price}`).join(";");
    const cacheKey = `${userId}:${range}:${metricType}:${portfolioFingerprint}:${Math.round(cash)}`;
    const cached = chartCache.get(cacheKey);

    if (cached && nowMs - cached.timestamp < CACHE_TTL_MS) {
      return NextResponse.json({ ok: true, data: cached.data });
    }

    if (positions.length === 0) {
      return NextResponse.json({
        ok: true,
        data: {
          areaSeriesData: [],
          candleSeriesData: [],
          barSeriesData: [],
          investedBaseline: 0,
          capitalBaseline: INITIAL_CAPITAL,
          currentValue: cash,
          holdingsValue: 0,
        },
      });
    }

    const investedBaseline = positions.reduce((sum, p) => sum + p.quantity * p.average_buy_price, 0);

    // Determine timeframe & time cutoff for requested range
    let tvTimeframe = "D";
    let candleCount = 60;
    let minTimeSec = nowSec - 30 * 86400;

    if (range === "1D") {
      tvTimeframe = "5";
      candleCount = 80;
      minTimeSec = nowSec - 86400; // Last 24 hours
    } else if (range === "1W") {
      tvTimeframe = "30";
      candleCount = 80;
      minTimeSec = nowSec - 7 * 86400;
    } else if (range === "1M") {
      tvTimeframe = "D";
      candleCount = 45;
      minTimeSec = nowSec - 32 * 86400;
    } else if (range === "3M") {
      tvTimeframe = "D";
      candleCount = 100;
      minTimeSec = nowSec - 95 * 86400;
    } else if (range === "1Y") {
      tvTimeframe = "D";
      candleCount = 260;
      minTimeSec = nowSec - 370 * 86400;
    } else if (range === "ALL") {
      tvTimeframe = "W";
      candleCount = 120;
      minTimeSec = nowSec - 700 * 86400;
    }

    const isDaily = tvTimeframe === "D" || tvTimeframe === "W";
    const candleTtlMs = isDaily ? 1800_000 : 300_000;

    // Fetch candles for each position in parallel with stock candle cache
    const stockCandleEntries = await Promise.all(
      positions.map(async (pos) => {
        const marketId = `NSE:${pos.ticker.replace(/[-&]/g, "_")}`;
        const stockKey = `${marketId}:${tvTimeframe}:${candleCount}`;
        const cachedStock = stockCandleGlobalCache.get(stockKey);

        if (cachedStock && nowMs - cachedStock.timestamp < candleTtlMs) {
          return { ticker: pos.ticker, candles: cachedStock.candles };
        }

        try {
          const candles = await getCandleHistory(marketId, tvTimeframe, candleCount);
          if (candles && candles.length > 0) {
            stockCandleGlobalCache.set(stockKey, { candles, timestamp: nowMs });
          }
          return { ticker: pos.ticker, candles };
        } catch {
          return { ticker: pos.ticker, candles: cachedStock?.candles || ([] as TvCandle[]) };
        }
      })
    );

    // Build map: ticker -> sorted candles array
    const stockCandleMap = new Map<string, TvCandle[]>();
    const allTimestampsSet = new Set<number>();

    for (const entry of stockCandleEntries) {
      const sorted = [...entry.candles].sort((a, b) => a.time - b.time);
      stockCandleMap.set(entry.ticker, sorted);
      for (const candle of sorted) {
        if (candle.time >= minTimeSec) {
          allTimestampsSet.add(candle.time);
        }
      }
    }

    let rangeTimestamps = Array.from(allTimestampsSet).sort((a, b) => a - b);

    // Fallback: If no candles match the strict minTimeSec (e.g. over weekend or after hours for 1D)
    if (rangeTimestamps.length < 5) {
      // Collect the most recent 30 available timestamps across any stock
      const allRecent = new Set<number>();
      for (const entry of stockCandleEntries) {
        const recentSlice = entry.candles.slice(-30);
        recentSlice.forEach((c) => allRecent.add(c.time));
      }
      rangeTimestamps = Array.from(allRecent).sort((a, b) => a - b);
    }

    // Helper: Find closest candle price at or before timestamp
    const getPriceAtOrBefore = (candles: TvCandle[], timestamp: number, fallback: number): { open: number; high: number; low: number; close: number } => {
      if (!candles || candles.length === 0) {
        return { open: fallback, high: fallback, low: fallback, close: fallback };
      }
      // Exact match
      const exact = candles.find((c) => c.time === timestamp);
      if (exact) return exact;

      // Closest before
      let closest = candles[0];
      for (const c of candles) {
        if (c.time <= timestamp) closest = c;
        else break;
      }
      return closest;
    };

    const areaSeriesData: Array<{ time: number; value: number }> = [];
    const candleSeriesData: Array<{ time: number; open: number; high: number; low: number; close: number }> = [];
    const barSeriesData: Array<{ time: number; value: number; color: string }> = [];

    for (const timestamp of rangeTimestamps) {
      let holdingsOpen = 0;
      let holdingsHigh = 0;
      let holdingsLow = 0;
      let holdingsClose = 0;

      for (const pos of positions) {
        const candles = stockCandleMap.get(pos.ticker) || [];
        const price = getPriceAtOrBefore(candles, timestamp, pos.average_buy_price);

        holdingsOpen += pos.quantity * price.open;
        holdingsHigh += pos.quantity * price.high;
        holdingsLow += pos.quantity * price.low;
        holdingsClose += pos.quantity * price.close;
      }

      const totalOpen = metricType === "holdings" ? holdingsOpen : cash + holdingsOpen;
      const totalHigh = metricType === "holdings" ? holdingsHigh : cash + holdingsHigh;
      const totalLow = metricType === "holdings" ? holdingsLow : cash + holdingsLow;
      const totalClose = metricType === "holdings" ? holdingsClose : cash + holdingsClose;

      const baseline = metricType === "holdings" ? investedBaseline : INITIAL_CAPITAL;
      const pnl = totalClose - baseline;

      areaSeriesData.push({
        time: timestamp,
        value: Math.round(totalClose * 100) / 100,
      });

      candleSeriesData.push({
        time: timestamp,
        open: Math.round(totalOpen * 100) / 100,
        high: Math.round(totalHigh * 100) / 100,
        low: Math.round(totalLow * 100) / 100,
        close: Math.round(totalClose * 100) / 100,
      });

      barSeriesData.push({
        time: timestamp,
        value: Math.round(pnl * 100) / 100,
        color: pnl >= 0 ? "rgba(16, 185, 129, 0.85)" : "rgba(239, 68, 68, 0.85)",
      });
    }

    const latestValue = areaSeriesData.length > 0 ? areaSeriesData[areaSeriesData.length - 1].value : cash + investedBaseline;

    const resultData = {
      areaSeriesData,
      candleSeriesData,
      barSeriesData,
      investedBaseline: Math.round(investedBaseline * 100) / 100,
      capitalBaseline: INITIAL_CAPITAL,
      currentValue: latestValue,
      range,
      metricType,
      timeframe: tvTimeframe,
      pointsCount: areaSeriesData.length,
    };

    chartCache.set(cacheKey, { data: resultData, timestamp: nowMs });

    return NextResponse.json({ ok: true, data: resultData });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error.message || "Failed to generate portfolio chart" },
      { status: 500 }
    );
  }
}
