import { NextResponse } from "next/server";
import { getLiveQuote, marketDataService } from "@/lib/tradingview";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
};

const indexConfig = [
  { label: "NIFTY", marketId: "NSE:NIFTY" },
  { label: "SENSEX", marketId: "BSE:SENSEX" },
  { label: "BANKNIFTY", marketId: "NSE:BANKNIFTY" },
  { label: "MIDCPNIFTY", marketId: "NSE:NIFTY_MID_SELECT" },
];

const DEFAULT_MOST_TRADED_STOCKS = [
  { symbol: "RELIANCE", companyName: "Reliance Industries Ltd", marketId: "NSE:RELIANCE" },
  { symbol: "HDFCBANK", companyName: "HDFC Bank Ltd", marketId: "NSE:HDFCBANK" },
  { symbol: "ICICIBANK", companyName: "ICICI Bank Ltd", marketId: "NSE:ICICIBANK" },
  { symbol: "INFY", companyName: "Infosys Ltd", marketId: "NSE:INFY" },
  { symbol: "TCS", companyName: "Tata Consultancy Services Ltd", marketId: "NSE:TCS" },
  { symbol: "TATAMOTORS", companyName: "Tata Motors Ltd", marketId: "NSE:TATAMOTORS" },
  { symbol: "SBIN", companyName: "State Bank of India", marketId: "NSE:SBIN" },
  { symbol: "BHARTIARTL", companyName: "Bharti Airtel Ltd", marketId: "NSE:BHARTIARTL" },
];

const ALL_SYMBOLS = [
  ...indexConfig.map((i) => i.marketId),
  ...DEFAULT_MOST_TRADED_STOCKS.map((s) => s.marketId),
];

// Pre-subscribe all dashboard symbols immediately so the WebSocket connection is primed
try {
  marketDataService.subscribe(ALL_SYMBOLS);
} catch {
  // Ignore subscription error on init
}

let cachedOverview: { data: any; timestamp: number } | null = null;
const CACHE_TTL_MS = 2000;

export async function GET() {
  try {
    const now = Date.now();
    if (cachedOverview && now - cachedOverview.timestamp < CACHE_TTL_MS) {
      return NextResponse.json(
        {
          ok: true,
          data: cachedOverview.data,
        },
        { headers: noStoreHeaders }
      );
    }

    // Ensure active subscriptions
    marketDataService.subscribe(ALL_SYMBOLS);

    // Fetch index quotes in parallel
    const indexPromises = indexConfig.map(async (item) => {
      const cached = marketDataService.getLatest(item.marketId);
      if (cached && cached.ltp > 0) {
        return {
          label: item.label,
          marketId: item.marketId,
          ltp: cached.ltp,
          change: cached.change,
          pChange: cached.pChange,
        };
      }

      try {
        const quote = await getLiveQuote(item.marketId);
        return {
          label: item.label,
          marketId: item.marketId,
          ltp: quote.ltp,
          change: quote.change,
          pChange: quote.pChange,
        };
      } catch {
        return {
          label: item.label,
          marketId: item.marketId,
          ltp: 0,
          change: 0,
          pChange: 0,
        };
      }
    });

    // Fetch stock quotes in parallel
    const stockPromises = DEFAULT_MOST_TRADED_STOCKS.map(async (stock) => {
      const cached = marketDataService.getLatest(stock.marketId);
      if (cached && cached.ltp > 0) {
        return {
          symbol: stock.symbol,
          companyName: stock.companyName,
          ltp: cached.ltp,
          change: cached.change,
          pChange: cached.pChange,
          volume: cached.volume ?? 0,
          tradedValue: (cached.volume ?? 0) * cached.ltp,
          marketId: stock.marketId,
        };
      }

      try {
        const quote = await getLiveQuote(stock.marketId);
        return {
          symbol: stock.symbol,
          companyName: stock.companyName,
          ltp: quote.ltp,
          change: quote.change,
          pChange: quote.pChange,
          volume: quote.volume ?? 0,
          tradedValue: (quote.volume ?? 0) * (quote.ltp || 1),
          marketId: stock.marketId,
        };
      } catch {
        return null;
      }
    });

    const [indices, stockResults] = await Promise.all([
      Promise.all(indexPromises),
      Promise.all(stockPromises),
    ]);

    const mostTraded = stockResults.filter(
      (s): s is NonNullable<typeof s> => s !== null && s.ltp > 0
    );

    const resultData = {
      indices,
      mostTraded,
      updatedAt: new Date().toISOString(),
    };

    cachedOverview = {
      data: resultData,
      timestamp: now,
    };

    return NextResponse.json(
      {
        ok: true,
        data: resultData,
      },
      { headers: noStoreHeaders }
    );
  } catch {
    if (cachedOverview) {
      return NextResponse.json(
        {
          ok: true,
          data: cachedOverview.data,
        },
        { headers: noStoreHeaders }
      );
    }

    return NextResponse.json(
      {
        ok: false,
        error: "Failed to load market overview",
      },
      {
        status: 500,
        headers: noStoreHeaders,
      }
    );
  }
}

