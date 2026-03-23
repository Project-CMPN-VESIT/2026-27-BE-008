import { NextResponse } from "next/server";
import { getLiveQuote } from "@/lib/tradingview";

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

type NseStockItem = {
  symbol?: string;
  series?: string;
  meta?: {
    companyName?: string;
  };
  lastPrice?: number;
  change?: number;
  pChange?: number;
  totalTradedValue?: number;
};

type NseIndexItem = {
  index?: string;
  indexSymbol?: string;
  last?: number;
  variation?: number;
  percentChange?: number;
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

const indexConfig = [
  { label: "NIFTY", marketId: "NSE:NIFTY", nseKey: "NIFTY 50" },
  { label: "SENSEX", marketId: "BSE:SENSEX", nseKey: "SENSEX" },
  { label: "BANKNIFTY", marketId: "NSE:BANKNIFTY", nseKey: "NIFTY BANK" },
  { label: "MIDCPNIFTY", marketId: "NSE:MIDCPNIFTY", nseKey: "NIFTY MIDCAP SELECT" },
];

export async function GET() {
  try {
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

    const allIndicesPayload = allIndicesResponse.ok ? await allIndicesResponse.json() : null;
    const indexRows: NseIndexItem[] = Array.isArray(allIndicesPayload?.data) ? allIndicesPayload.data : [];

    const indexData = await Promise.all(
      indexConfig.map(async (item) => {
        const nseItem = indexRows.find(
          (row) => row?.index === item.nseKey || row?.indexSymbol === item.nseKey
        );

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
          if (nseItem && typeof nseItem.last === "number") {
            return {
              label: item.label,
              marketId: item.marketId,
              ltp: nseItem.last,
              change: typeof nseItem.variation === "number" ? nseItem.variation : 0,
              pChange: typeof nseItem.percentChange === "number" ? nseItem.percentChange : 0,
            };
          }

          return {
            label: item.label,
            marketId: item.marketId,
            ltp: 0,
            change: 0,
            pChange: 0,
          };
        }
      })
    );

    const response = await fetch("https://www.nseindia.com/api/equity-stockIndices?index=NIFTY%2050", {
      headers: {
        ...nseHeaders,
        Cookie: cookies,
      },
      cache: "no-store",
    });

    const payload = response.ok ? await response.json() : null;
    const rows: NseStockItem[] = Array.isArray(payload?.data) ? payload.data : [];

    const mostTraded = rows
      .filter((item) => {
        return typeof item.symbol === "string"
          && typeof item.lastPrice === "number"
          && item.series === "EQ"
          && !item.symbol.includes("NIFTY")
          && !item.symbol.includes("SENSEX");
      })
      .sort((a, b) => (b.totalTradedValue ?? 0) - (a.totalTradedValue ?? 0))
      .slice(0, 8)
      .map((item) => ({
        symbol: item.symbol as string,
        companyName: item.meta?.companyName ?? item.symbol,
        ltp: item.lastPrice as number,
        change: typeof item.change === "number" ? item.change : 0,
        pChange: typeof item.pChange === "number" ? item.pChange : 0,
        tradedValue: typeof item.totalTradedValue === "number" ? item.totalTradedValue : 0,
        marketId: `NSE:${item.symbol}`,
      }));

    return NextResponse.json(
      {
        ok: true,
        data: {
          indices: indexData,
          mostTraded,
          updatedAt: new Date().toISOString(),
        },
      },
      { headers: noStoreHeaders }
    );
  } catch {
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
