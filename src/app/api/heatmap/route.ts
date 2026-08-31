import { NextRequest } from "next/server";
import { marketDataService, NormalizedQuote } from "@/lib/tradingview";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const symbolsParam = url.searchParams.get("symbols");
  
  if (!symbolsParam) {
    return new Response("Missing symbols", { status: 400 });
  }

  const symbols = symbolsParam.split(",").map(s => s.trim()).filter(Boolean);
  
  if (symbols.length === 0) {
    return new Response("No valid symbols", { status: 400 });
  }

  const encoder = new TextEncoder();
  
  const stream = new ReadableStream({
    start(controller) {
      // Send initial data for all symbols
      for (const symbol of symbols) {
        const initial = marketDataService.getLatest(symbol);
        if (initial) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(initial)}\n\n`));
        }
      }

      // Define the listener
      const listener = (quote: NormalizedQuote) => {
        if (symbols.includes(quote.symbol)) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(quote)}\n\n`));
        }
      };

      // Subscribe and add listener
      marketDataService.subscribe(symbols);
      marketDataService.addListener(listener);

      // Handle disconnect
      req.signal.addEventListener("abort", () => {
        marketDataService.removeListener(listener);
        marketDataService.unsubscribe(symbols);
        controller.close();
      });
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
