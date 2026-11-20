import { NextRequest } from "next/server";
import { marketDataService, NormalizedQuote } from "@/lib/tradingview";

export const dynamic = "force-dynamic";

const MAX_SYMBOLS = 120;
const SYMBOL = /^[A-Za-z0-9_]{1,15}:[A-Za-z0-9!_.&-]{1,30}$/;
let connectionCounter = 0;

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const symbolsParam = url.searchParams.get("symbols");

  if (!symbolsParam) {
    return new Response("Missing symbols", { status: 400 });
  }

  const symbols = Array.from(new Set(symbolsParam.split(",").map((s) => s.trim()).filter(Boolean)));

  if (symbols.length === 0) {
    return new Response("No valid symbols", { status: 400 });
  }
  if (symbols.length > MAX_SYMBOLS) {
    return new Response(`Too many symbols (max ${MAX_SYMBOLS})`, { status: 400 });
  }
  if (symbols.some((s) => !SYMBOL.test(s))) {
    return new Response("Symbols must look like EXCHANGE:TICKER", { status: 400 });
  }

  const encoder = new TextEncoder();
  const owner = `sse-${++connectionCounter}`;
  const wanted = new Set(symbols);
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let listener: ((quote: NormalizedQuote) => void) | undefined;

  const shutdown = (controller?: ReadableStreamDefaultController) => {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    if (listener) marketDataService.removeListener(listener);
    marketDataService.unsubscribe(symbols, owner);
    try {
      controller?.close();
    } catch {
      // already closed by the client
    }
  };

  const stream = new ReadableStream({
    start(controller) {
      const send = (text: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          shutdown(controller);
        }
      };

      // Send initial data for all symbols
      for (const symbol of symbols) {
        const initial = marketDataService.getLatest(symbol);
        if (initial) send(`data: ${JSON.stringify(initial)}

`);
      }

      listener = (quote: NormalizedQuote) => {
        if (wanted.has(quote.symbol)) send(`data: ${JSON.stringify(quote)}

`);
      };
      marketDataService.subscribe(symbols, owner);
      marketDataService.addListener(listener);

      // keeps idle connections alive through proxies while the market is closed and nothing changes
      heartbeat = setInterval(() => send(`: keep-alive

`), 25_000);

      req.signal.addEventListener("abort", () => shutdown(controller));
    },
    cancel() {
      shutdown();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
