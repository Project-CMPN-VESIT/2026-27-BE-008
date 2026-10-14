import { NextRequest, NextResponse } from "next/server";
import { AuthRequiredError, requireAuth } from "@/lib/server-auth";

const API_BASE = "http://127.0.0.1:8001/api";

export async function GET(request: NextRequest) {
  try {
    await requireAuth(request);
    const res = await fetch(`${API_BASE}/portfolio`, { cache: "no-store", headers: { Authorization: request.headers.get("authorization") ?? "" } });
    if (!res.ok) throw new Error("Backend error");
    const data = await res.json();
    return NextResponse.json({ ok: true, data });
  } catch (err: any) {
    if (err instanceof AuthRequiredError) return NextResponse.json({ ok: false, error: err.message }, { status: 401 });
    return NextResponse.json({ ok: false, error: err.message || "Failed to fetch portfolio" }, { status: 500 });
  }
}
