import { NextRequest } from "next/server";
import { marketDataService, NormalizedQuote } from "@/lib/tradingview";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const marketId = searchParams.get("marketId");

  if (!marketId) {
    return new Response("Missing marketId", { status: 400 });
  }

  // Ensure we are subscribed to this marketId in TradingView
  marketDataService.subscribe([marketId]);

  let isClosed = false;

  const stream = new ReadableStream({
    start(controller) {
      // Send an initial connected message
      controller.enqueue(`data: {"type": "connected"}\n\n`);

      // Immediately send the latest quote if available
      const existing = marketDataService.getLatest(marketId);
      if (existing) {
        controller.enqueue(`data: ${JSON.stringify({ type: "quote", data: existing })}\n\n`);
      }

      // Listener for real-time quote updates
      const listener = (quote: NormalizedQuote) => {
        if (isClosed) return;
        if (quote.symbol === marketId) {
          try {
            controller.enqueue(`data: ${JSON.stringify({ type: "quote", data: quote })}\n\n`);
          } catch (error) {
            console.error("Error enqueuing to SSE stream", error);
          }
        }
      };

      marketDataService.addListener(listener);

      // Keep connection alive with pings every 30s
      const interval = setInterval(() => {
        if (!isClosed) {
          try {
            controller.enqueue(`:\n\n`); // SSE comment acts as ping
          } catch {
            cleanup();
          }
        }
      }, 30000);

      const cleanup = () => {
        if (isClosed) return;
        isClosed = true;
        clearInterval(interval);
        marketDataService.removeListener(listener);
        // Only unsubscribe from TV if nobody else is listening, 
        // but for safety in this simple implementation, we just leave the subscription
        // active or let marketDataService manage it.
      };

      request.signal.addEventListener("abort", cleanup);
    },
    cancel() {
      isClosed = true;
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no" // Prevents Nginx/Vercel from buffering the stream
    },
  });
}
