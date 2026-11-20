import { NextRequest, NextResponse } from "next/server";
import { AuthRequiredError, requireAuth } from "@/lib/server-auth";
import { getServerPool } from "@/lib/server-db";
import { ensureAlertUrlColumn } from "@/lib/alerts/ensure-url-column";
import path from "node:path";
import fs from "node:fs";

export const dynamic = "force-dynamic";

function resolveExactDocumentUrl(stock: string, headline: string, currentUrl: unknown): string | null {
  const existing = typeof currentUrl === "string" ? currentUrl.trim() : "";
  if (
    existing &&
    /^https?:\/\//i.test(existing) &&
    !/nseindia\.com\/get-quotes\/equity/i.test(existing) &&
    !/bseindia\.com\/corporates\/ann/i.test(existing)
  ) {
    return existing;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sqlite = require("node:sqlite");
    if (!sqlite?.DatabaseSync) return null;
    const dbPath = path.join(process.cwd(), "news-feed", "news.db");
    if (!fs.existsSync(dbPath)) return null;
    const db = new sqlite.DatabaseSync(dbPath, { readOnly: true });
    const normalizedStock = stock.trim().toUpperCase();
    const row = db.prepare(`
      SELECT pdf_url
      FROM announcements
      WHERE (symbol = ? OR symbol = ? OR company LIKE ?)
        AND subject = ?
        AND pdf_url IS NOT NULL
        AND TRIM(pdf_url) <> ''
      ORDER BY id DESC
      LIMIT 1
    `).get(normalizedStock, normalizedStock, `%${normalizedStock}%`, headline) as
      | { pdf_url: string }
      | undefined;
    db.close();
    return row?.pdf_url || null;
  } catch {
    return null;
  }
}

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

    const alerts = res.rows.map((r) => {
      const exactUrl = resolveExactDocumentUrl(r.stock, r.headline, r.url);
      return {
        id: r.id,
        userId: user.uid,
        stock: r.stock,
        type: r.type,
        headline: r.headline,
        source: r.source || "NSE",
        timestamp: r.timestamp ? new Date(r.timestamp).toISOString() : new Date().toISOString(),
        read: Boolean(r.read),
        url: exactUrl,
      };
    });

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
