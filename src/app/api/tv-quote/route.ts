import { NextRequest, NextResponse } from "next/server";
import { getLiveQuote, resolveMarket } from "@/lib/tradingview";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
};

const NSE_BASE_URL = "https://www.nseindia.com";

const nseHeaders = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Accept: "application/json,text/plain,*/*",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://www.nseindia.com/",
  Connection: "keep-alive",
};

type NseIndexItem = {
  index?: string;
  indexSymbol?: string;
  last?: number;
  variation?: number;
  percentChange?: number;
};

const indexKeyByMarketId: Record<string, string> = {
  "NSE:NIFTY": "NIFTY 50",
  "BSE:SENSEX": "SENSEX",
  "NSE:BANKNIFTY": "NIFTY BANK",
  "NSE:MIDCPNIFTY": "NIFTY MIDCAP SELECT",
};

const extractCookieHeader = (rawSetCookie: string | null) => {
  if (!rawSetCookie) {
    return "";
  }

  return rawSetCookie
    .split(/,(?=\s*[^;=]+=[^;]+)/)
    .map((cookie) => cookie.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
};

let nseIndexCache: { fetchedAt: number; rows: NseIndexItem[] } = {
  fetchedAt: 0,
  rows: [],
};

const getNseIndexRows = async () => {
  const now = Date.now();
  if (nseIndexCache.rows.length && now - nseIndexCache.fetchedAt < 3000) {
    return nseIndexCache.rows;
  }

  const seedResponse = await fetch(NSE_BASE_URL, {
    headers: nseHeaders,
    cache: "no-store",
  });

  const cookies = extractCookieHeader(seedResponse.headers.get("set-cookie"));

  const allIndicesResponse = await fetch("https://www.nseindia.com/api/allIndices", {
    headers: {
      ...nseHeaders,
      Cookie: cookies,
    },
    cache: "no-store",
  });

  const payload = allIndicesResponse.ok ? await allIndicesResponse.json() : null;
  const rows: NseIndexItem[] = Array.isArray(payload?.data) ? payload.data : [];
  nseIndexCache = { fetchedAt: now, rows };
  return rows;
};

const getIndexFallbackQuote = async (marketId: string) => {
  const nseKey = indexKeyByMarketId[marketId.toUpperCase()];
  if (!nseKey) {
    return null;
  }

  const rows = await getNseIndexRows();
  const row = rows.find((item) => item?.index === nseKey || item?.indexSymbol === nseKey);
  if (!row || typeof row.last !== "number") {
    return null;
  }

  return {
    ltp: row.last,
    change: typeof row.variation === "number" ? row.variation : 0,
    pChange: typeof row.percentChange === "number" ? row.percentChange : 0,
  };
};

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
        {
          status: 404,
          headers: noStoreHeaders,
        }
      );
    }

    try {
      const quote = await getLiveQuote(resolved.marketId);

      return NextResponse.json(
        {
          ok: true,
          data: {
            symbol: resolved.symbol,
            marketId: resolved.marketId,
            exchange: resolved.exchange,
            quote,
            updatedAt: new Date().toISOString(),
            source: "tradingview-api",
          },
        },
        { headers: noStoreHeaders }
      );
    } catch {
      const fallbackQuote = await getIndexFallbackQuote(resolved.marketId);
      if (fallbackQuote) {
        return NextResponse.json(
          {
            ok: true,
            data: {
              symbol: resolved.symbol,
              marketId: resolved.marketId,
              exchange: resolved.exchange,
              quote: fallbackQuote,
              updatedAt: new Date().toISOString(),
              source: "nse-fallback",
            },
          },
          { headers: noStoreHeaders }
        );
      }

      throw new Error("Unable to fetch live quote");
    }
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unable to fetch live quote",
      },
      {
        status: 500,
        headers: noStoreHeaders,
      }
    );
  }
}
