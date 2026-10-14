import { NextRequest, NextResponse } from "next/server";
import { AuthRequiredError, requireAuth } from "@/lib/server-auth";
import { getServerPool } from "@/lib/server-db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    const result = await getServerPool().query(
      "SELECT firebase_uid, email, display_name, photo_url, created_at, updated_at FROM app_users WHERE firebase_uid = $1",
      [auth.uid],
    );
    return NextResponse.json({ profile: result.rows[0] }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthRequiredError) return NextResponse.json({ error: error.message }, { status: 401 });
    console.error("[profile] Could not load profile", error);
    return NextResponse.json({ error: "Could not load profile" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    const body = await request.json();
    const displayName = typeof body?.displayName === "string" ? body.displayName.trim() : "";
    if (!displayName || displayName.length > 80) {
      return NextResponse.json({ error: "Display name must be between 1 and 80 characters" }, { status: 400 });
    }
    const result = await getServerPool().query(
      `UPDATE app_users SET display_name = $2, updated_at = CURRENT_TIMESTAMP
       WHERE firebase_uid = $1
       RETURNING firebase_uid, email, display_name, photo_url, created_at, updated_at`,
      [auth.uid, displayName],
    );
    return NextResponse.json({ profile: result.rows[0] });
  } catch (error) {
    if (error instanceof AuthRequiredError) return NextResponse.json({ error: error.message }, { status: 401 });
    console.error("[profile] Could not save profile", error);
    return NextResponse.json({ error: "Could not save profile" }, { status: 500 });
  }
}
