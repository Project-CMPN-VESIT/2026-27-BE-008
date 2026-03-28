import { NextRequest, NextResponse } from "next/server";
import { getCompanyProfile } from "@/lib/company-profile";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
};

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol")?.trim() ?? "";
  const companyName = request.nextUrl.searchParams.get("companyName")?.trim() ?? symbol;

  if (!symbol && !companyName) {
    return NextResponse.json(
      { ok: false, error: "symbol or companyName is required" },
      { status: 400, headers: noStoreHeaders }
    );
  }

  try {
    const profile = await getCompanyProfile(companyName, symbol);
    return NextResponse.json({ ok: true, data: profile }, { headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unable to fetch company profile",
      },
      { status: 500, headers: noStoreHeaders }
    );
  }
}
