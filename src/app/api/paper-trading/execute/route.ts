import { NextRequest, NextResponse } from "next/server";
import { getLiveQuote, resolveMarket } from "@/lib/tradingview";
import { AuthRequiredError, requireAuth } from "@/lib/server-auth";

const API_BASE = "http://127.0.0.1:8001/api";

/** FastAPI errors arrive as {detail: "text"} or, for validation, {detail: [{msg, loc}, ...]}. */
const upstreamMessage = (data: unknown, fallback: string) => {
  const detail = (data as { detail?: unknown; error?: unknown } | null)?.detail ?? (data as { error?: unknown } | null)?.error;
  if (typeof detail === "string" && detail) return detail;
  if (Array.isArray(detail) && detail.length) {
    const first = detail[0] as { msg?: string; loc?: unknown[] };
    return `${String(first.loc?.slice(-1)[0] ?? "request")}: ${first.msg ?? "invalid"}`;
  }
  return fallback;
};

export async function POST(request: NextRequest) {
  try {
    await requireAuth(request);
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ ok: false, error: "Send a JSON body" }, { status: 400 });
    }
    const { ticker, userThesis, aiFeedback, idempotencyKey } = body;
    const action = typeof body.action === "string" ? body.action.trim().toUpperCase() : "";
    const quantity = Number(body.quantity);

    if (typeof ticker !== "string" || !ticker.trim() || ticker.length > 32) {
      return NextResponse.json({ ok: false, error: "A valid ticker is required" }, { status: 400 });
    }
    if (action !== "BUY" && action !== "SELL") {
      return NextResponse.json({ ok: false, error: "Action must be BUY or SELL" }, { status: 400 });
    }
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 1_000_000) {
      return NextResponse.json({ ok: false, error: "Quantity must be a whole number between 1 and 1,000,000" }, { status: 400 });
    }
    if (!idempotencyKey || typeof idempotencyKey !== "string" || idempotencyKey.length > 128) {
      return NextResponse.json({ ok: false, error: "Missing idempotency key" }, { status: 400 });
    }

    // Fetch live price securely on the server: the browser never gets to choose the execution price
    const resolved = await resolveMarket(ticker);
    if (!resolved) {
      return NextResponse.json({ ok: false, error: "Could not resolve a live market price for this ticker" }, { status: 400 });
    }
    const quote = await getLiveQuote(resolved.marketId);
    const executionPrice = quote.ltp;
    if (!Number.isFinite(executionPrice) || executionPrice <= 0) {
      return NextResponse.json({ ok: false, error: "A valid live price is unavailable" }, { status: 503 });
    }

    const res = await fetch(`${API_BASE}/trade/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: request.headers.get("authorization") ?? "" },
      body: JSON.stringify({
        ticker,
        action,
        quantity,
        execution_price: executionPrice,
        user_thesis: typeof userThesis === "string" ? userThesis.slice(0, 4000) : "",
        ai_feedback: typeof aiFeedback === "string" ? aiFeedback.slice(0, 8000) : "",
        idempotency_key: idempotencyKey,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      // business rejections (insufficient balance / holdings) are the user's to fix, not server faults
      const status = res.status >= 400 && res.status < 500 ? res.status : 502;
      return NextResponse.json({ ok: false, error: upstreamMessage(data, "Trade could not be completed") }, { status });
    }

    return NextResponse.json({ ok: true, data });
  } catch (err: unknown) {
    if (err instanceof AuthRequiredError) return NextResponse.json({ ok: false, error: err.message }, { status: 401 });
    const message = err instanceof Error ? err.message : "Trade could not be completed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
