/** Authenticated proxy to the stock screener endpoints of the CYRO engine (kept out of the route tree: leading underscore). */

import { NextRequest, NextResponse } from "next/server";
import { AuthRequiredError, requireAuth } from "@/lib/server-auth";

const BACKEND = process.env.INDIA_TRADE_CLI_URL ?? "http://127.0.0.1:8765";

export async function proxyScreener(req: NextRequest, path: string, method: "GET" | "POST", timeoutMs = 30_000) {
  try {
    await requireAuth(req);
    const body = method === "POST" ? await req.text() : undefined;
    const res = await fetch(`${BACKEND}${path}`, {
      method,
      cache: "no-store",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err: unknown) {
    if (err instanceof AuthRequiredError) return NextResponse.json({ detail: err.message }, { status: 401 });
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { detail: `Cannot reach the screener backend (${msg}). Is india-trade-cli running on port 8765?` },
      { status: 503 },
    );
  }
}
