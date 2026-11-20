import { NextRequest, NextResponse } from "next/server";
import { AuthRequiredError, requireAuth } from "@/lib/server-auth";
import { getServerPool } from "@/lib/server-db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  let user: { uid: string };
  try {
    user = await requireAuth(request);
  } catch (err: any) {
    if (err instanceof AuthRequiredError) return NextResponse.json({ ok: false, error: err.message }, { status: 401 });
    return NextResponse.json({ ok: false, error: "Could not authenticate" }, { status: 401 });
  }

  // Direct high-speed PostgreSQL pool query (< 60ms)
  try {
    const pool = getServerPool();
    const [accRes, posRes, journalRes] = await Promise.all([
      pool.query(
        "INSERT INTO paper_accounts (firebase_uid) VALUES ($1) ON CONFLICT (firebase_uid) DO UPDATE SET updated_at = CURRENT_TIMESTAMP RETURNING virtual_balance",
        [user.uid]
      ),
      pool.query(
        "SELECT ticker, quantity, average_buy_price, updated_at FROM paper_positions WHERE firebase_uid = $1 AND quantity > 0 ORDER BY ticker",
        [user.uid]
      ),
      pool.query(
        "SELECT id, ticker, action, execution_price, quantity, user_thesis, ai_feedback, created_at AS timestamp FROM paper_trades WHERE firebase_uid = $1 ORDER BY created_at DESC LIMIT 50",
        [user.uid]
      ),
    ]);

    const balance = accRes.rows[0]?.virtual_balance ? Number(accRes.rows[0].virtual_balance) : 1000000;
    const positions = posRes.rows.map((r, idx) => ({
      id: idx + 1,
      ticker: r.ticker,
      quantity: Number(r.quantity),
      average_buy_price: Number(r.average_buy_price),
      updated_at: r.updated_at ? new Date(r.updated_at).toISOString() : new Date().toISOString(),
    }));
    const journal = journalRes.rows.map((r) => ({
      id: r.id,
      ticker: r.ticker,
      action: r.action,
      execution_price: Number(r.execution_price),
      quantity: Number(r.quantity),
      user_thesis: r.user_thesis || "",
      ai_feedback: r.ai_feedback || "",
      timestamp: r.timestamp ? new Date(r.timestamp).toISOString() : new Date().toISOString(),
    }));

    return NextResponse.json({
      ok: true,
      data: {
        balance,
        positions,
        journal,
      },
    });
  } catch (dbErr: any) {
    console.error("[api/paper-trading/portfolio direct DB error]", dbErr);
    return NextResponse.json({ ok: false, error: dbErr.message || "Failed to fetch portfolio" }, { status: 500 });
  }
}
