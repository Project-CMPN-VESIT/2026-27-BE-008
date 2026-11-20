import { NextRequest, NextResponse } from "next/server";
import {
  ADMIN_COOKIE,
  adminCookieOptions,
  checkAdminCredentials,
  clearLoginFailures,
  createAdminToken,
  isAdminRequest,
  loginThrottled,
  recordLoginFailure,
} from "@/lib/admin-session";

export const dynamic = "force-dynamic";

const clientKey = (request: NextRequest) =>
  request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";

/** GET: is the current browser holding a valid admin session? */
export async function GET(request: NextRequest) {
  return NextResponse.json({ ok: isAdminRequest(request) }, { headers: { "Cache-Control": "no-store" } });
}

/** POST: verify admin credentials on the server and start a signed session. */
export async function POST(request: NextRequest) {
  const key = clientKey(request);
  if (loginThrottled(key)) {
    return NextResponse.json({ ok: false, error: "Too many attempts. Try again in a minute." }, { status: 429 });
  }

  let body: { username?: unknown; password?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Send JSON with a username and password." }, { status: 400 });
  }
  const username = typeof body.username === "string" ? body.username : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!username || !password || username.length > 100 || password.length > 200) {
    return NextResponse.json({ ok: false, error: "Username and password are required." }, { status: 400 });
  }

  if (!checkAdminCredentials(username, password)) {
    recordLoginFailure(key);
    return NextResponse.json(
      { ok: false, error: "Invalid admin credentials. Please verify your username and password." },
      { status: 401 }
    );
  }

  clearLoginFailures(key);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ADMIN_COOKIE, createAdminToken("admin"), adminCookieOptions);
  return response;
}

/** DELETE: end the admin session. */
export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ADMIN_COOKIE, "", { ...adminCookieOptions, maxAge: 0 });
  return response;
}
