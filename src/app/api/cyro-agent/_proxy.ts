/** Shared forwarder for the CYRO chat-agent endpoints (leading underscore: not a route). */

import { NextRequest, NextResponse } from "next/server";

const BACKEND = process.env.INDIA_TRADE_CLI_URL ?? "http://127.0.0.1:8765";

export async function forward(req: NextRequest, path: string, opts: { stream?: boolean; timeoutMs?: number } = {}) {
  const qs = req.nextUrl.searchParams.toString();
  const url = `${BACKEND}/skills/cyro/chat${path}${qs ? `?${qs}` : ""}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const uid = req.headers.get("x-cyro-user");
  if (uid) headers["X-CYRO-User"] = uid;
  const hasBody = !["GET", "HEAD", "DELETE"].includes(req.method);
  try {
    const res = await fetch(url, {
      method: req.method,
      headers,
      body: hasBody ? await req.text() : undefined,
      cache: "no-store",
      signal: opts.stream ? req.signal : AbortSignal.timeout(opts.timeoutMs ?? 20_000),
    });
    if (opts.stream && res.body) {
      // pass the SSE stream straight through, unbuffered
      return new Response(res.body, {
        status: res.status,
        headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" },
      });
    }
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { detail: `Cannot reach the CYRO backend (${msg}). Is india-trade-cli running on port 8765?` },
      { status: 503 },
    );
  }
}
