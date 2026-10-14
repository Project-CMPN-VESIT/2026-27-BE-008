import { NextRequest, NextResponse } from "next/server";
import { AuthRequiredError, requireAuth } from "@/lib/server-auth";
import { getServerPool } from "@/lib/server-db";

export const dynamic = "force-dynamic";
const allowedKeys = new Set(["theme", "sidebarCollapsed", "defaultResearchHorizon", "timezone"]);

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    const result = await getServerPool().query(
      "SELECT preferences FROM user_preferences WHERE firebase_uid = $1", [auth.uid],
    );
    return NextResponse.json({ preferences: result.rows[0]?.preferences ?? {} }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthRequiredError) return NextResponse.json({ error: error.message }, { status: 401 });
    console.error("[preferences] Could not load preferences", error);
    return NextResponse.json({ error: "Could not load preferences" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    const body = await request.json();
    const incoming = body?.preferences;
    if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
      return NextResponse.json({ error: "preferences must be an object" }, { status: 400 });
    }
    const clean: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(incoming)) {
      if (!allowedKeys.has(key)) continue;
      if (key === "theme" && !["light", "dark"].includes(String(value))) continue;
      if (key === "sidebarCollapsed" && typeof value !== "boolean") continue;
      if ((key === "defaultResearchHorizon" || key === "timezone") && (typeof value !== "string" || value.length > 80)) continue;
      clean[key] = value;
    }
    const result = await getServerPool().query(
      `INSERT INTO user_preferences (firebase_uid, preferences)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (firebase_uid) DO UPDATE SET
         preferences = user_preferences.preferences || EXCLUDED.preferences,
         updated_at = CURRENT_TIMESTAMP
       RETURNING preferences`,
      [auth.uid, JSON.stringify(clean)],
    );
    return NextResponse.json({ preferences: result.rows[0].preferences });
  } catch (error) {
    if (error instanceof AuthRequiredError) return NextResponse.json({ error: error.message }, { status: 401 });
    console.error("[preferences] Could not save preferences", error);
    return NextResponse.json({ error: "Could not save preferences" }, { status: 500 });
  }
}
