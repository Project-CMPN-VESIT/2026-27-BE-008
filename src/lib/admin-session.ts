import "server-only";

import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Server-side admin session.
 *
 * The admin console used to rely on a client-side flag only, so /api/admin/* answered anyone. Login is now checked
 * on the server and, when it succeeds, a signed HttpOnly cookie is issued. Every admin API verifies that cookie.
 *
 * ADMIN_USERNAME / ADMIN_PASSWORD override the defaults; ADMIN_SESSION_SECRET signs the cookie (falls back to a
 * random per-process secret, which only means admins sign in again after a server restart).
 */
export const ADMIN_COOKIE = "finpilot_admin_session";
const SESSION_SECONDS = 60 * 60 * 24;

// The signing secret must be the SAME in every route bundle and across restarts. The old fallback (a random value
// generated at module load) was created again in each route's own bundle, so a cookie issued by the login route
// failed verification in /api/admin/users or the session check: admins were randomly logged out and the user list
// sometimes came back 401. Derive it from a stable server-side secret instead; if none exists at all, keep one random
// value on globalThis, which every bundle in the process shares.
const globalForSecret = globalThis as typeof globalThis & { finpilotAdminSecret?: string };

function secret() {
  const configured = process.env.ADMIN_SESSION_SECRET || process.env.FIREBASE_PRIVATE_KEY || process.env.DATABASE_URL;
  if (configured) return createHash("sha256").update(`finpilot-admin-session:${configured}`).digest("hex");
  globalForSecret.finpilotAdminSecret ??= randomBytes(32).toString("hex");
  return globalForSecret.finpilotAdminSecret;
}

function sign(payload: string) {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function checkAdminCredentials(username: string, password: string) {
  const expectedUser = (process.env.ADMIN_USERNAME || "admin").toLowerCase();
  const expectedPass = process.env.ADMIN_PASSWORD || "password123";
  // evaluate both comparisons so the response time does not reveal which one failed
  const userOk = safeEqual(username.trim().toLowerCase(), expectedUser);
  const passOk = safeEqual(password.trim(), expectedPass);
  return userOk && passOk;
}

export function createAdminToken(username: string) {
  const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const payload = `${username}.${expires}`;
  return `${payload}.${sign(payload)}`;
}

export function verifyAdminToken(token: string | undefined | null) {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [username, expires, signature] = parts;
  if (!safeEqual(signature, sign(`${username}.${expires}`))) return false;
  return Number(expires) > Math.floor(Date.now() / 1000);
}

export function isAdminRequest(request: NextRequest) {
  return verifyAdminToken(request.cookies.get(ADMIN_COOKIE)?.value);
}

/** Guard for admin-only API routes: returns a 401 response to send back, or null when the caller holds an admin session. */
export function adminOnly(request: NextRequest): NextResponse | null {
  return isAdminRequest(request) ? null : NextResponse.json({ error: "Admin sign-in required" }, { status: 401 });
}

export const adminCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production" && process.env.ADMIN_COOKIE_INSECURE !== "1",
  path: "/",
  maxAge: SESSION_SECONDS,
};

// ── tiny in-memory throttle for login attempts (per client address) ──
const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 8;

export function loginThrottled(key: string) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now) return false;
  return entry.count >= MAX_ATTEMPTS;
}

export function recordLoginFailure(key: string) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now) attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
  else entry.count += 1;
  if (attempts.size > 500) for (const [k, v] of attempts) if (v.resetAt < now) attempts.delete(k);
}

export function clearLoginFailures(key: string) {
  attempts.delete(key);
}
