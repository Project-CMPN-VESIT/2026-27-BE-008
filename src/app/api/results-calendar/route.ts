import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const BSE_RESULTS_URL = "https://api.bseindia.com/BseIndiaAPI/api/Corpforthresults/w";

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
};

type BseResultRow = {
  scrip_Code?: string;
  short_name?: string;
  Long_Name?: string;
  meeting_date?: string;
  URL?: string;
};

const normalizeDate = (value?: string) => {
  if (!value) {
    return 0;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

export async function GET(request: NextRequest) {
  const symbol = (request.nextUrl.searchParams.get("symbol") || "").trim();
  const fromDate = (request.nextUrl.searchParams.get("fromdate") || "").trim();
  const toDate = (request.nextUrl.searchParams.get("todate") || "").trim();

  const upstreamUrl = new URL(BSE_RESULTS_URL);
  if (symbol) upstreamUrl.searchParams.set("scripcode", symbol);
  if (fromDate) upstreamUrl.searchParams.set("fromdate", fromDate);
  if (toDate) upstreamUrl.searchParams.set("todate", toDate);

  try {
    const response = await fetch(upstreamUrl.toString(), {
      cache: "no-store",
      headers: {
        Accept: "application/json,text/plain,*/*",
        Referer: "https://www.bseindia.com/corporates/Forth_Results.html",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      },
    });

    const payload = await response.json();
    const rows: BseResultRow[] = Array.isArray(payload) ? payload : [];

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

    return NextResponse.json(
      {
        count: results.length,
        source: "BSE",
        fetchedAt: new Date().toISOString(),
        results,
      },
      {
        status: response.status,
        headers: noStoreHeaders,
      }
    );
  } catch (error: unknown) {
    return NextResponse.json(
      {
        count: 0,
        source: "BSE",
        fetchedAt: new Date().toISOString(),
        results: [],
        detail: error instanceof Error ? error.message : "Failed to fetch BSE results calendar",
      },
      {
        status: 500,
        headers: noStoreHeaders,
      }
    );
  }
}
