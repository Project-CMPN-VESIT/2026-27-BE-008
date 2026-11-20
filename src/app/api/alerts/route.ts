import { NextRequest, NextResponse } from "next/server";
import { AuthRequiredError, requireAuth } from "@/lib/server-auth";
import { getServerPool } from "@/lib/server-db";
import { ensureAlertUrlColumn } from "@/lib/alerts/ensure-url-column";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  let user: { uid: string };
  try {
    user = await requireAuth(request);
  } catch (err) {
    if (err instanceof AuthRequiredError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: "Could not authenticate" }, { status: 401 });
  }

  try {
    const pool = getServerPool();
    await ensureAlertUrlColumn(pool);
    const res = await pool.query(
      `SELECT id, stock, type, headline, source, timestamp, is_read AS read, url
       FROM user_alerts
       WHERE firebase_uid = $1
       ORDER BY timestamp DESC
       LIMIT 50`,
      [user.uid]
    );

    const alerts = res.rows.map((r) => ({
      id: r.id,
      userId: user.uid,
      stock: r.stock,
      type: r.type,
      headline: r.headline,
      source: r.source || "NSE",
      timestamp: r.timestamp ? new Date(r.timestamp).toISOString() : new Date().toISOString(),
      read: Boolean(r.read),
      url: r.url || `https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(r.stock)}`,
    }));

    return NextResponse.json({ ok: true, alerts });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  let user: { uid: string };
  try {
    user = await requireAuth(request);
  } catch (err) {
    if (err instanceof AuthRequiredError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: "Could not authenticate" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const pool = getServerPool();

    if (body.all) {
      await pool.query(
        "UPDATE user_alerts SET is_read = TRUE WHERE firebase_uid = $1",
        [user.uid]
      );
      return NextResponse.json({ ok: true, message: "All alerts marked as read" });
    }

    if (body.alertId) {
      await pool.query(
        "UPDATE user_alerts SET is_read = TRUE WHERE firebase_uid = $1 AND id = $2",
        [user.uid, body.alertId]
      );
      return NextResponse.json({ ok: true, message: "Alert marked as read" });
    }

    return NextResponse.json({ ok: false, error: "Missing alertId or all parameter" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

