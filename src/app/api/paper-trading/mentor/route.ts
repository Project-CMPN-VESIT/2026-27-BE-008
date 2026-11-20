import { NextRequest, NextResponse } from "next/server";
import { AuthRequiredError, requireAuth } from "@/lib/server-auth";

const API_BASE = "http://127.0.0.1:8001/api";

export async function POST(request: NextRequest) {
  try {
    await requireAuth(request);
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ ok: false, error: "Send a JSON body" }, { status: 400 });
    }

    const res = await fetch(`${API_BASE}/mentor-audit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: request.headers.get("authorization") ?? "" },
      body: JSON.stringify({
        action: body.action,
        quantity: body.quantity,
        ticker: body.ticker,
        user_thesis: typeof body.userThesis === "string" ? body.userThesis.slice(0, 4000) : "",
        rk_score: Number(body.rkScore) || 50.0,
        pl_score: Number(body.plScore) || 50.0,
      }),
      signal: AbortSignal.timeout(45_000),
    });

    const data = await res.json().catch(() => ({}));
    if (res.status === 422 || res.status === 400) {
      return NextResponse.json({ ok: false, error: "Check the ticker, action and quantity and try again" }, { status: 400 });
    }
    if (!res.ok) throw new Error("Mentor evaluation failed");

    return NextResponse.json({ ok: true, critique: data.critique });
  } catch (err: unknown) {
    if (err instanceof AuthRequiredError) return NextResponse.json({ ok: false, error: err.message }, { status: 401 });
    const message = err instanceof Error ? err.message : "Mentor evaluation failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
