import { NextRequest, NextResponse } from "next/server";
import { AuthRequiredError, requireAuth } from "@/lib/server-auth";

const API_BASE = "http://127.0.0.1:8001/api";

export async function POST(request: NextRequest) {
  try {
    await requireAuth(request);
    const body = await request.json();
    
    const res = await fetch(`${API_BASE}/mentor-audit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: request.headers.get("authorization") ?? "" },
      body: JSON.stringify({
        action: body.action,
        quantity: body.quantity,
        ticker: body.ticker,
        user_thesis: body.userThesis,
        rk_score: body.rkScore || 50.0,
        pl_score: body.plScore || 50.0
      })
    });
    
    const data = await res.json();
    if (!res.ok) throw new Error("Mentor evaluation failed");
    
    return NextResponse.json({ ok: true, critique: data.critique });
  } catch (err: any) {
    if (err instanceof AuthRequiredError) return NextResponse.json({ ok: false, error: err.message }, { status: 401 });
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
