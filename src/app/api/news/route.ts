import { NextRequest, NextResponse } from "next/server";

const API_BASE = "http://127.0.0.1:8002/v1";

export async function GET(request: NextRequest) {
  const upstreamUrl = new URL(`${API_BASE}/news`);

  const symbol = request.nextUrl.searchParams.get("symbol");
  const source = request.nextUrl.searchParams.get("source");
  const nseIndex = request.nextUrl.searchParams.get("nse_index");
  const limit = request.nextUrl.searchParams.get("limit");

  if (symbol) upstreamUrl.searchParams.set("symbol", symbol);
  if (source) upstreamUrl.searchParams.set("source", source);
  if (nseIndex) upstreamUrl.searchParams.set("nse_index", nseIndex);
  if (limit) upstreamUrl.searchParams.set("limit", limit);

  try {
    const res = await fetch(upstreamUrl.toString(), { cache: "no-store" });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Failed to fetch news feed" },
      { status: 500 }
    );
  }
}
