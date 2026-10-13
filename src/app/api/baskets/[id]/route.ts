/**
 * src/app/api/baskets/[id]/route.ts
 * Proxy: GET /api/baskets/<id>?range=1M  ->  india-trade-cli GET /baskets/<id>
 */

import { NextRequest, NextResponse } from "next/server";

const BACKEND = process.env.INDIA_TRADE_CLI_URL ?? "http://127.0.0.1:8765";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const qs = req.nextUrl.searchParams.toString();
  try {
    const res = await fetch(`${BACKEND}/baskets/${encodeURIComponent(id)}${qs ? `?${qs}` : ""}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
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
