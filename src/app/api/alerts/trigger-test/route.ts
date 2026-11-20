import { NextRequest, NextResponse } from "next/server";
import { AuthRequiredError, requireAuth } from "@/lib/server-auth";
import { getServerPool } from "@/lib/server-db";

export const dynamic = "force-dynamic";

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

  const body = await request.json().catch(() => ({}));
  const action = body.action || "trigger";
  const pool = getServerPool();

  if (action === "remove") {
    await pool.query(
      "DELETE FROM user_alerts WHERE firebase_uid = $1 AND id LIKE 'test_past_event_%'",
      [user.uid]
    );
    return NextResponse.json({ ok: true, message: "Test past event alerts removed successfully" });
  }

  // Trigger past events
  const now = Date.now();
  const pastAlerts = [
    {
      id: "test_past_event_bhartiartl",
      stock: "BHARTIARTL",
      type: "regulatory",
      headline: "SEBI Compliance Order: Bharti Airtel Ltd cleared under Regulation 30 disclosure framework",
      source: "SEBI / NSE",
      timestamp: new Date(now - 12 * 60 * 1000).toISOString(), // 12 mins ago
    },
    {
      id: "test_past_event_axisbank",
      stock: "AXISBANK",
      type: "news",
      headline: "Axis Bank Q2 Institutional Earnings Update: Operating profit up +11.4% YoY",
      source: "NSE Filings",
      timestamp: new Date(now - 48 * 60 * 1000).toISOString(), // 48 mins ago
    },
    {
      id: "test_past_event_icicibank",
      stock: "ICICIBANK",
      type: "news",
      headline: "ICICI Bank General Update: Credit rating affirmed AAA with Stable outlook by CRISIL",
      source: "NSE Corporate",
      timestamp: new Date(now - 3 * 3600 * 1000).toISOString(), // 3 hours ago
    },
  ];

  for (const a of pastAlerts) {
    await pool.query(
      `INSERT INTO user_alerts (id, firebase_uid, stock, type, headline, source, timestamp, is_read)
       VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE)
       ON CONFLICT (id) DO UPDATE SET
         is_read = FALSE,
         timestamp = EXCLUDED.timestamp,
         headline = EXCLUDED.headline`,
      [a.id, user.uid, a.stock, a.type, a.headline, a.source, a.timestamp]
    );
  }

  return NextResponse.json({
    ok: true,
    message: "Triggered 3 past event alerts successfully! Check your navbar bell icon.",
    alerts: pastAlerts,
  });
}

