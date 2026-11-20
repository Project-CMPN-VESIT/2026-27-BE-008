import { NextRequest, NextResponse } from "next/server";
import { searchStocks, getLiveQuote, marketDataService } from "@/lib/tradingview";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";

  if (!query) {
    return NextResponse.json({ ok: true, data: [] });
  }

  try {
    const data = await searchStocks(query, 8);

    // Subscribe and attempt live quotes for the returned stocks
    const enriched = await Promise.all(
      data.map(async (item) => {
        try {
          // Check if already in cache/store
          const cached = marketDataService.getLatest(item.marketId);
          if (cached && cached.ltp > 0) {
            return {
              ...item,
              price: `₹${cached.ltp.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
              chg: `${cached.pChange >= 0 ? "+" : ""}${cached.pChange.toFixed(2)}%`,
              up: cached.pChange >= 0,
            };
          }

          // Otherwise try quick live quote with 450ms race
          const quote = await Promise.race([
            getLiveQuote(item.marketId),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 450)),
          ]);

          if (quote && quote.ltp > 0) {
            return {
              ...item,
              price: `₹${quote.ltp.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
              chg: `${quote.pChange >= 0 ? "+" : ""}${quote.pChange.toFixed(2)}%`,
              up: quote.pChange >= 0,
            };
          }
        } catch {
          // ignore quote fetch errors
        }

        return item;
      })
    );

    return NextResponse.json({ ok: true, data: enriched });
  } catch {
    return NextResponse.json({ ok: true, data: [] });
  }
}
