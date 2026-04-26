/**
 * src/app/api/cyro-chat/route.ts
 * ─────────────────────────────
 * Next.js Route Handler — SSE bridge between the War Room UI and the
 * india-trade-cli CYRO Python backend.
 *
 * The UI connects here with:
 *   GET /api/cyro-chat?message=...&ticker=INFY&mode=normal&session_id=...
 *
 * This route:
 *   1. Validates the request
 *   2. Opens an SSE connection to india-trade-cli at INDIA_TRADE_CLI_URL
 *   3. Pipes every `data: ...` event straight through to the browser
 *
 * Environment variables required:
 *   INDIA_TRADE_CLI_URL=http://localhost:8765   (default)
 */

import { NextRequest } from "next/server";

// Runtime config: force Node.js runtime so we can use streaming fetch
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BACKEND_URL =
  process.env.INDIA_TRADE_CLI_URL ?? "http://127.0.0.1:8765";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  const message = searchParams.get("message")?.trim() ?? "";
  const ticker = searchParams.get("ticker") ?? "";
  const mode = searchParams.get("mode") ?? "normal";
  const sessionId = searchParams.get("session_id") ?? "default";

  if (!message) {
    return new Response(
      JSON.stringify({ error: "message is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Build the upstream SSE URL
  const params = new URLSearchParams({
    message,
    mode,
    session_id: sessionId,
    ...(ticker ? { ticker } : {}),
  });
  const upstreamUrl = `${BACKEND_URL}/skills/cyro/stream?${params.toString()}`;

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(upstreamUrl, {
      method: "GET",
      headers: {
        Accept: "text/event-stream",
        "Cache-Control": "no-cache",
      },
      // @ts-expect-error — Node.js fetch supports this for streaming
      duplex: "half",
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    // Return a synthetic SSE error event so the UI can show a toast
    const body = `data: ${JSON.stringify({
      type: "error",
      message: `Cannot reach CYRO backend at ${BACKEND_URL}: ${errMsg}. Make sure india-trade-cli is running (uvicorn web.api:app --port 8765).`,
    })}\n\ndata: ${JSON.stringify({ type: "done" })}\n\n`;

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  if (!upstreamRes.ok || !upstreamRes.body) {
    const errBody = `data: ${JSON.stringify({
      type: "error",
      message: `CYRO backend returned HTTP ${upstreamRes.status}`,
    })}\n\ndata: ${JSON.stringify({ type: "done" })}\n\n`;
    return new Response(errBody, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  // Pipe the upstream SSE body directly to the browser
  return new Response(upstreamRes.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
