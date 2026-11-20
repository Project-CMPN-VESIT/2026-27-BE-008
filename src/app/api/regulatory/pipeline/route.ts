import { NextRequest, NextResponse } from "next/server";
import { adminOnly } from "@/lib/admin-session";

export const dynamic = "force-dynamic";

const SHIELD_API = process.env.SHIELD_API_URL ?? "http://127.0.0.1:8000";

/** Admin-only: start a scrape and extraction run (the service allows one at a time and enforces a time limit). */
export async function POST(request: NextRequest) {
  const denied = adminOnly(request);
  if (denied) return denied;
  try {
    const res = await fetch(`${SHIELD_API}/v1/pipeline/run`, { method: "POST", cache: "no-store", signal: AbortSignal.timeout(31 * 60_000) });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "The SEBI Shield service is not reachable or the run timed out." }, { status: 503 });
  }
}
