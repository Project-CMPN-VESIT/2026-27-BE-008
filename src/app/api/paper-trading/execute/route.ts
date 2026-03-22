import { NextRequest, NextResponse } from "next/server";
import { getLiveQuote, resolveMarket } from "@/lib/tradingview";

const API_BASE = "http://127.0.0.1:8001/api";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId = "default_user", ticker, action, quantity, userThesis, aiFeedback } = body;
    
    // Fetch live price securely on the server
    const resolved = await resolveMarket(ticker);
    let executionPrice = 0;
    if (resolved) {
      const quote = await getLiveQuote(resolved.marketId);
      executionPrice = quote.ltp;
    } else {
      executionPrice = 100.0; // Fallback
    }

    const res = await fetch(`${API_BASE}/trade/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: userId,
        ticker,
        action,
        quantity,
        execution_price: executionPrice,
        user_thesis: userThesis,
        ai_feedback: aiFeedback
      })
    });
    
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || "Execute failed");
    
    return NextResponse.json({ ok: true, data });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
