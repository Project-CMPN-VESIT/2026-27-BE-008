import { NextRequest, NextResponse } from "next/server";
import { adminOnly } from "@/lib/admin-session";

export const dynamic = "force-dynamic";

const SHIELD_API = process.env.SHIELD_API_URL ?? "http://127.0.0.1:8000";

/** Admin-only proxy to the SEBI Shield entity list (the browser no longer talks to the scraper service directly). */
export async function GET(request: NextRequest) {
  const denied = adminOnly(request);
  if (denied) return denied;
  const size = Math.min(Math.max(Number(request.nextUrl.searchParams.get("page_size")) || 5000, 1), 20000);
  try {
    const res = await fetch(`${SHIELD_API}/v1/entities?page_size=${size}`, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "The SEBI Shield service is not reachable. Start it with `python run.py serve` in scrapper." }, { status: 503 });
  }
}
