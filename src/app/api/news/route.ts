import { NextRequest, NextResponse } from "next/server";

const API_BASE = "http://127.0.0.1:8002/v1";

type SortableNewsItem = {
  id?: number;
  announced_at?: string | null;
  fetched_at?: string | null;
};

const toTimestamp = (value: string | null | undefined) => {
  if (!value) {
    return 0;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const sortNewsByLatest = <T extends SortableNewsItem>(items: T[]) => {
  return [...items].sort((a, b) => {
    const announcedDiff = toTimestamp(b.announced_at) - toTimestamp(a.announced_at);
    if (announcedDiff !== 0) {
      return announcedDiff;
    }

    const fetchedDiff = toTimestamp(b.fetched_at) - toTimestamp(a.fetched_at);
    if (fetchedDiff !== 0) {
      return fetchedDiff;
    }

    return (b.id || 0) - (a.id || 0);
  });
};

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

    if (data && typeof data === "object" && Array.isArray((data as { results?: unknown[] }).results)) {
      const sortedResults = sortNewsByLatest((data as { results: SortableNewsItem[] }).results);
      return NextResponse.json({ ...(data as Record<string, unknown>), results: sortedResults }, { status: res.status });
    }

    return NextResponse.json(data, { status: res.status });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Failed to fetch news feed" },
      { status: 500 }
    );
  }
}
