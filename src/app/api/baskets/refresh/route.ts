/**
 * src/app/api/baskets/refresh/route.ts
 * Proxy: POST /api/baskets/refresh  ->  india-trade-cli POST /baskets/pipeline/refresh
 * (the backend only accepts this from localhost)
 */

import { NextRequest, NextResponse } from "next/server";
import { AuthRequiredError, requireAuth } from "@/lib/server-auth";

const BACKEND = process.env.INDIA_TRADE_CLI_URL ?? "http://127.0.0.1:8765";

export async function POST(req: NextRequest) {
  // the backend only checks that the caller is localhost, and this proxy is localhost: sign-in is the real gate
  try {
    await requireAuth(req);
  } catch (err) {
    const message = err instanceof AuthRequiredError ? err.message : "Could not authenticate";
    return NextResponse.json({ detail: message }, { status: 401 });
  }
  const qs = req.nextUrl.searchParams.toString();
  try {
    const res = await fetch(`${BACKEND}/baskets/pipeline/refresh${qs ? `?${qs}` : ""}`, {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ detail: `Cannot reach the baskets backend (${msg}).` }, { status: 503 });
  }
}
