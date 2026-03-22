import { NextRequest, NextResponse } from "next/server";

const API_BASE = "http://127.0.0.1:8001/api";

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get("userId") || "default_user";
  try {
    const res = await fetch(`${API_BASE}/portfolio/${userId}`, { cache: "no-store" });
    if (!res.ok) throw new Error("Backend error");
    const data = await res.json();
    return NextResponse.json({ ok: true, data });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message || "Failed to fetch portfolio" }, { status: 500 });
  }
}
