/** Shared GET proxy for the baskets endpoints (kept out of the route tree: leading underscore). */

import { NextRequest, NextResponse } from "next/server";

const BACKEND = process.env.INDIA_TRADE_CLI_URL ?? "http://127.0.0.1:8765";

export async function proxyGet(req: NextRequest, path: string, timeoutMs = 30_000) {
  const qs = req.nextUrl.searchParams.toString();
  try {
    const res = await fetch(`${BACKEND}${path}${qs ? `?${qs}` : ""}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { detail: `Cannot reach the baskets backend (${msg}). Is india-trade-cli running on port 8765?` },
      { status: 503 },
    );
  }
}
