/**
 * src/app/api/cyro-market/route.ts
 * ─────────────────────────────────
 * Next.js API bridge for CYRO right-panel market intelligence endpoints.
 *
 * Proxied routes (query param `endpoint` selects which one):
 *   /api/cyro-market?endpoint=fii-dii&days=5
 *   /api/cyro-market?endpoint=options&ticker=INFY
 *   /api/cyro-market?endpoint=flow&ticker=INFY
 *   /api/cyro-market?endpoint=session-memory&ticker=INFY
 *   /api/cyro-market?endpoint=rag-check&ticker=INFY
 */

import { NextRequest, NextResponse } from "next/server";

const BACKEND = process.env.INDIA_TRADE_CLI_URL ?? "http://127.0.0.1:8765";

const ALLOWED_ENDPOINTS = new Set([
  "fii-dii",
  "options",
  "flow",
  "session-memory",
  "rag-check",
  "news",
  "alerts",
]);

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const endpoint = sp.get("endpoint") ?? "";

  if (!ALLOWED_ENDPOINTS.has(endpoint)) {
    return NextResponse.json(
      { ok: false, error: `Unknown endpoint: ${endpoint}` },
      { status: 400 }
    );
  }

  // Forward all query params except `endpoint` to the backend
  const forwardParams = new URLSearchParams();
  for (const [key, val] of sp.entries()) {
    if (key !== "endpoint") forwardParams.set(key, val);
  }

  const backendUrl = `${BACKEND}/skills/cyro/market/${endpoint}?${forwardParams.toString()}`;

  try {
    const res = await fetch(backendUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(15_000), // 15s timeout
    });

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: `Backend returned ${res.status}` },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json({ ok: true, ...data });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: `Cannot reach CYRO backend (${msg}). Is india-trade-cli running on port 8765?` },
      { status: 503 }
    );
  }
}
