import { NextRequest, NextResponse } from "next/server";
import { AuthRequiredError, requireAuth } from "@/lib/server-auth";

/** Legacy streaming endpoint; CYRO conversations now use /api/cyro-agent/chat. */
export async function GET(request: NextRequest) {
  try {
    await requireAuth(request);
  } catch (error) {
    if (error instanceof AuthRequiredError) return NextResponse.json({ error: error.message }, { status: 401 });
    return NextResponse.json({ error: "Could not authenticate request" }, { status: 500 });
  }
  return NextResponse.json({ error: "This endpoint has moved to /api/cyro-agent/chat" }, { status: 410 });
}
