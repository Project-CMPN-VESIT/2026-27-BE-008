import { NextRequest, NextResponse } from "next/server";
import { AuthRequiredError, requireAuth } from "@/lib/server-auth";
import { getServerPool } from "@/lib/server-db";
import path from "node:path";
import fs from "node:fs";

export const dynamic = "force-dynamic";

// ─── Helper: Parse timestamps to ISO string ──────────────────────────────────

function parseTimestamp(raw?: string | null): string {
  if (!raw) return new Date().toISOString();
  const value = raw.trim();
  const nseMatch = value.match(/^(\d{1,2})[-/]([A-Za-z]{3,9})[-/](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (nseMatch) {
    const [, day, monthName, year, hour = "0", minute = "0", second = "0"] = nseMatch;
    const month = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"]
      .indexOf(monthName.toLowerCase().slice(0, 3));
    if (month >= 0) {
      return new Date(
        Number(year),
        month,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second)
      ).toISOString();
    }
  }
  const parsed = Date.parse(value);
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  return new Date().toISOString();
}

// ─── User holdings lookup from PostgreSQL ─────────────────────────────────────

async function getUserPortfolioTickers(pool: any, uid: string): Promise<string[]> {
  try {
    const res = await pool.query(
      "SELECT DISTINCT symbol FROM user_portfolio_holdings WHERE firebase_uid = $1",
      [uid]
    );
    return res.rows.map((r: { symbol: string }) => {
      const s: string = r.symbol || "";
      const clean = s.includes(":") ? s.split(":")[1] : s;
      return clean.toUpperCase().trim();
    }).filter(Boolean);
  } catch {
    return [];
  }
}

async function getUserPaperTickers(pool: any, uid: string): Promise<string[]> {
  try {
    const res = await pool.query(
      "SELECT DISTINCT ticker FROM paper_positions WHERE firebase_uid = $1 AND quantity > 0",
      [uid]
    );
    return res.rows.map((r: { ticker: string }) => (r.ticker || "").toUpperCase().trim()).filter(Boolean);
  } catch {
    return [];
  }
}

import { ensureAlertUrlColumn } from "@/lib/alerts/ensure-url-column";

// ─── Stock news and filings lookup ───────────────────────────────────────────

interface RawAlertCandidate {
  docId: string;
  stock: string;
  type: "news" | "filing" | "regulatory";
  headline: string;
  source: string;
  timestamp: string;
  url: string;
}

function safeSourceUrl(raw: unknown, symbol: string): string {
  if (typeof raw === "string") {
    const value = raw.trim();
    if (/^https?:\/\//i.test(value)) {
      if (/nseindia\.com\/get-quotes\/equity/i.test(value)) return "";
      if (/bseindia\.com\/corporates\/ann/i.test(value)) return "";
      return value;
    }
  }
  return "";
}

function getAlertsFromSqlite(tickers: string[]): RawAlertCandidate[] {
  const results: RawAlertCandidate[] = [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sqlite = require("node:sqlite");
    if (!sqlite?.DatabaseSync) return results;

    const dbPath = path.join(process.cwd(), "news-feed", "news.db");
    if (!fs.existsSync(dbPath)) return results;

    const db = new sqlite.DatabaseSync(dbPath, { readOnly: true });
    const stmt = db.prepare(`
      SELECT id, symbol, company, subject, category, announced_at, source, pdf_url
      FROM announcements
      WHERE symbol = ? OR symbol = ? OR company LIKE ?
      ORDER BY id DESC
      LIMIT 100
    `);

    for (const ticker of tickers) {
      try {
        const rows = stmt.all(ticker, ticker.toUpperCase(), `%${ticker}%`) as Array<{
          id: number;
          symbol: string;
          company: string;
          subject: string;
          category?: string;
          announced_at?: string;
          source?: string;
          pdf_url?: string;
        }>;

        for (const r of rows) {
          const subject = r.subject || `${r.company || ticker} corporate announcement`;
          const isReg =
            (r.category && r.category.toLowerCase().includes("sebi")) ||
            subject.toLowerCase().includes("regulation") ||
            subject.toLowerCase().includes("action(s)") ||
            subject.toLowerCase().includes("sanction") ||
            subject.toLowerCase().includes("order");

          results.push({
            docId: `${ticker}_ann_${r.id}`,
            stock: ticker,
            type: isReg ? "regulatory" : "news",
            headline: subject,
            source: r.source || "NSE",
            timestamp: parseTimestamp(r.announced_at),
            url: safeSourceUrl(r.pdf_url, ticker),
          });
        }
      } catch {
        // continue with next ticker
      }
    }
  } catch {
    // ignore
  }

  return results;
}

function getAlertsFromShorts(tickers: string[]): RawAlertCandidate[] {
  const results: RawAlertCandidate[] = [];
  try {
    const runtimePath = path.join(process.cwd(), ".runtime", "nifty_shorts_cache.json");
    const legacyPath = path.join(process.cwd(), "src", "data", "nifty_shorts_cache.json");
    const shortsPath = fs.existsSync(runtimePath) ? runtimePath : legacyPath;
    if (!fs.existsSync(shortsPath)) return results;

    const shortsData = JSON.parse(fs.readFileSync(shortsPath, "utf8")) as Record<
      string,
      {
        symbol: string;
        headlines?: string[];
        script?: { hook?: string; why_moving?: string };
        trading_date?: string;
        generated_at?: string;
      }
    >;

    for (const ticker of tickers) {
      const item = shortsData[ticker] || shortsData[ticker.toUpperCase()];
      if (item) {
        const hook = item.script?.hook || item.headlines?.[0] || `${ticker} price action breakdown`;
        const dt = item.trading_date || item.generated_at || "2026-10-30";
        results.push({
          docId: `${ticker}_shorts_${dt.replace(/[^a-zA-Z0-9]/g, "_")}`,
          stock: ticker,
          type: "news",
          headline: hook,
          source: "CYRO Market AI",
          timestamp: parseTimestamp(item.generated_at || item.trading_date),
          url: `/shorts?symbol=${encodeURIComponent(ticker)}`,
        });
      }
    }
  } catch {
    // ignore
  }

  return results;
}

// ─── Main route handler ──────────────────────────────────────────────────────

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

  const uid = user.uid;
  const pool = getServerPool();

  // 1. Discover tickers to monitor for this user
  const [portfolioTickers, paperTickers] = await Promise.all([
    getUserPortfolioTickers(pool, uid),
    getUserPaperTickers(pool, uid),
  ]);

  let allTickers = Array.from(new Set([...portfolioTickers, ...paperTickers]));
  allTickers = allTickers
    .map((ticker) => ticker.split(":").pop()?.trim().toUpperCase())
    .filter((ticker): ticker is string => Boolean(ticker));

  // 2. Collect alert candidates
  const sqliteCandidates = getAlertsFromSqlite(allTickers);
  const shortsCandidates = getAlertsFromShorts(allTickers);
  const deduplicated = new Map<string, RawAlertCandidate>();
  const freshnessCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  for (const candidate of [...sqliteCandidates, ...shortsCandidates]) {
    const timestamp = Date.parse(candidate.timestamp);
    if (Number.isNaN(timestamp)) continue;
    if (timestamp < freshnessCutoff) continue;
    const headlineKey = candidate.headline
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
    const key = `${candidate.stock}|${candidate.type}|${headlineKey}`;
    const existing = deduplicated.get(key);
    if (!existing || timestamp > Date.parse(existing.timestamp)) {
      deduplicated.set(key, candidate);
    }
  }
  const allCandidates = Array.from(deduplicated.values())
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, 20);

  await ensureAlertUrlColumn(pool);
  await pool.query(
    `DELETE FROM user_alerts
     WHERE firebase_uid = $1
       AND (
         id LIKE '%_ann_%'
         OR id LIKE '%_shorts_%'
         OR id LIKE 'test_%'
       )`,
    [uid]
  );
  let newAlertCount = 0;

  for (const c of allCandidates) {
    try {
      const res = await pool.query(
        `INSERT INTO user_alerts (id, firebase_uid, stock, type, headline, source, timestamp, is_read, url)
         VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE, $8)
        ON CONFLICT (id) DO UPDATE SET
          headline = EXCLUDED.headline,
          source = EXCLUDED.source,
          timestamp = EXCLUDED.timestamp,
          url = CASE
            WHEN EXCLUDED.url NOT LIKE '%/get-quotes/equity%' THEN EXCLUDED.url
            WHEN user_alerts.url IS NULL
              OR user_alerts.url LIKE '%/get-quotes/equity%' THEN EXCLUDED.url
            ELSE user_alerts.url
          END
        RETURNING id, (xmax = 0) AS inserted`,
        [c.docId, uid, c.stock, c.type, c.headline, c.source, c.timestamp, c.url]
      );
      if (res.rows[0]?.inserted) {
        newAlertCount++;
      }
    } catch {
      // ignore
    }
  }

  return NextResponse.json({
    ok: true,
    newAlerts: newAlertCount,
    monitored: allTickers,
    candidatesFound: allCandidates.length,
  });
}
