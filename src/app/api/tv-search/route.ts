import { NextRequest, NextResponse } from "next/server";
import { searchStocks } from "@/lib/tradingview";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";

  if (!query) {
    return NextResponse.json({ ok: true, data: [] });
  }

  try {
    const data = await searchStocks(query, 10);
    return NextResponse.json({ ok: true, data });
  } catch {
    return NextResponse.json({ ok: true, data: [] });
  }
}
