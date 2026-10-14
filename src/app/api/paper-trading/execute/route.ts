import { NextRequest, NextResponse } from "next/server";
import { getLiveQuote, resolveMarket } from "@/lib/tradingview";
import { AuthRequiredError, requireAuth } from "@/lib/server-auth";

const API_BASE = "http://127.0.0.1:8001/api";

export async function POST(request: NextRequest) {
  try {
    await requireAuth(request);
    const body = await request.json();
    const { ticker, action, quantity, userThesis, aiFeedback, idempotencyKey } = body;
    if (!idempotencyKey || typeof idempotencyKey !== "string") return NextResponse.json({ ok: false, error: "Missing idempotency key" }, { status: 400 });
    
    // Fetch live price securely on the server
    const resolved = await resolveMarket(ticker);
    let executionPrice = 0;
    if (resolved) {
      const quote = await getLiveQuote(resolved.marketId);
      executionPrice = quote.ltp;
    } else {
      return NextResponse.json({ ok: false, error: "Could not resolve a live market price for this ticker" }, { status: 400 });
    }
    if (!Number.isFinite(executionPrice) || executionPrice <= 0) return NextResponse.json({ ok: false, error: "A valid live price is unavailable" }, { status: 503 });

    const res = await fetch(`${API_BASE}/trade/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: request.headers.get("authorization") ?? "" },
      body: JSON.stringify({
        ticker,
        action,
        quantity,
        execution_price: executionPrice,
        user_thesis: userThesis,
        ai_feedback: aiFeedback,
        idempotency_key: idempotencyKey
      })
    });
    
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || "Execute failed");
    
    return NextResponse.json({ ok: true, data });
  } catch (err: any) {
    if (err instanceof AuthRequiredError) return NextResponse.json({ ok: false, error: err.message }, { status: 401 });
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
