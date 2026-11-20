import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const BSE_RESULTS_URL = "https://api.bseindia.com/BseIndiaAPI/api/Corpforthresults/w";

type BseResultRow = {
  scrip_Code?: string;
  short_name?: string;
  Long_Name?: string;
  meeting_date?: string;
  URL?: string;
};

// Global in-memory cache for ultra-fast instant responses
let cachedResults: any[] | null = null;
let lastFetchedTime = 0;
const CACHE_TTL_MS = 180_000; // 3 minutes fresh TTL

const normalizeDate = (value?: string) => {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

async function fetchFromBse(upstreamUrl: URL): Promise<BseResultRow[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6500);

  try {
    const response = await fetch(upstreamUrl.toString(), {
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Accept: "application/json,text/plain,*/*",
        Referer: "https://www.bseindia.com/corporates/Forth_Results.html",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      },
    });

    if (!response.ok) throw new Error(`BSE returned HTTP ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload)) throw new Error("Invalid response format from BSE");
    return payload as BseResultRow[];
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function GET(request: NextRequest) {
  const symbol = (request.nextUrl.searchParams.get("symbol") || "").trim();
  const fromDate = (request.nextUrl.searchParams.get("fromdate") || "").trim();
  const toDate = (request.nextUrl.searchParams.get("todate") || "").trim();
  const forceRefresh = request.nextUrl.searchParams.get("refresh") === "true";

  // BSE expects a numeric scrip code and YYYYMMDD dates: reject anything else before it reaches the upstream URL
  if (symbol && !/^[A-Za-z0-9&._-]{1,30}$/.test(symbol)) {
    return NextResponse.json({ detail: "symbol contains unsupported characters" }, { status: 400 });
  }
  if ((fromDate && !/^\d{8}$/.test(fromDate)) || (toDate && !/^\d{8}$/.test(toDate))) {
    return NextResponse.json({ detail: "fromdate and todate must be YYYYMMDD" }, { status: 400 });
  }

  const now = Date.now();

  // Instant response if warm cache exists and no custom filters requested
  if (!symbol && !fromDate && !toDate && !forceRefresh && cachedResults && cachedResults.length > 0 && (now - lastFetchedTime < CACHE_TTL_MS)) {
    return NextResponse.json({
      count: cachedResults.length,
      source: "BSE (Fast Cache)",
      fetchedAt: new Date(lastFetchedTime).toISOString(),
      results: cachedResults,
    });
  }

  const upstreamUrl = new URL(BSE_RESULTS_URL);
  if (symbol) upstreamUrl.searchParams.set("scripcode", symbol);
  if (fromDate) upstreamUrl.searchParams.set("fromdate", fromDate);
  if (toDate) upstreamUrl.searchParams.set("todate", toDate);

  try {
    const rows = await fetchFromBse(upstreamUrl);

    const sortedRows = [...rows].sort((a, b) => {
      return normalizeDate(a.meeting_date) - normalizeDate(b.meeting_date);
    });

    const results = sortedRows.map((row) => ({
      securityCode: row.scrip_Code || "",
      shortName: row.short_name || "",
      companyName: row.Long_Name || "",
      resultDate: row.meeting_date || "",
      url: row.URL || "",
    }));

    if (!symbol && results.length > 0) {
      cachedResults = results;
      lastFetchedTime = now;
    }

    return NextResponse.json({
      count: results.length,
      source: "BSE",
      fetchedAt: new Date().toISOString(),
      results,
    });
  } catch {
    // Prefer the last real data we hold. Never invent result dates: an honest "unavailable" beats a made-up calendar.
    if (cachedResults && cachedResults.length > 0 && !symbol) {
      return NextResponse.json({
        count: cachedResults.length,
        source: "BSE (Resilient Cache)",
        fetchedAt: new Date(lastFetchedTime).toISOString(),
        results: cachedResults,
        notice: "BSE is not responding; showing the last data received.",
      });
    }
    return NextResponse.json({ detail: "BSE results data is not reachable right now. Please retry shortly." }, { status: 503 });
  }
}
