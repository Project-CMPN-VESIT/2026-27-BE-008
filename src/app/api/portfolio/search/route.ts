import { NextRequest, NextResponse } from "next/server";
import { getLiveQuote, resolveMarket, searchStocks } from "@/lib/tradingview";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim().toUpperCase() ?? "";
  if (!query) {
    return NextResponse.json({ ok: true, data: [] });
  }

  try {
    const resolved = await resolveMarket(query);
    const matches = resolved
      ? [resolved, ...(await searchStocks(query, 15)).filter((item) => item.marketId !== resolved.marketId)]
      : await searchStocks(query, 15);

    const unique = new Map<string, Awaited<ReturnType<typeof searchStocks>>[number]>();
    for (const item of matches) {
      if (item.exchange === "NSE" || item.exchange === "BSE") {
        unique.set(item.marketId, item);
      }
    }

    const enriched = await Promise.all(
      Array.from(unique.values()).slice(0, 15).map(async (item) => {
        let price = 0;
        let pChange = 0;
        try {
          const quote = await getLiveQuote(item.marketId);
          price = quote.ltp;
          pChange = quote.pChange;
        } catch {
          // Leave price at 0 rather than returning a fabricated market price.
        }
        return {
          symbol: item.symbol,
          companyName: item.companyName,
          sector: "General",
          industry: "Equity",
          exchange: item.exchange,
          price,
          pChange,
        };
      })
    );

    return NextResponse.json({ ok: true, data: enriched });
  } catch (error) {
    console.error("[portfolio-search] Dynamic search failed:", error);
    return NextResponse.json({ ok: true, data: [] });
  }
}
