import "server-only";

import type { NextRequest } from "next/server";
import { firebaseAdminAuth } from "@/lib/firebase/admin";
import { ensureAppUser } from "@/lib/server-db";

export class AuthRequiredError extends Error {
  readonly status = 401;
}

// Syncing the user row costs a round trip to the remote database on every request. Do it once per few minutes per
// user, and never let a database outage turn a verified sign-in into a failure for routes that do not need the
// database (the screener, market intelligence, baskets...). Routes that do need it fail on their own query.
const SYNC_TTL_MS = 5 * 60_000;
const syncedAt = new Map<string, number>();
let lastSyncWarning = 0;

async function syncUser(user: { uid: string; email?: string; name?: string; picture?: string }) {
  const last = syncedAt.get(user.uid);
  if (last && Date.now() - last < SYNC_TTL_MS) return;
  try {
    await ensureAppUser(user);
    if (syncedAt.size > 5000) syncedAt.clear();
    syncedAt.set(user.uid, Date.now());
  } catch (error) {
    if (Date.now() - lastSyncWarning > 60_000) {
      lastSyncWarning = Date.now();
      console.warn("[auth] could not sync the user row (database unreachable?):", error instanceof Error ? error.message : error);
    }
  }
}

export async function requireAuth(request: NextRequest) {
  const header = request.headers.get("authorization");
  const token = header?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new AuthRequiredError("Sign in is required");
  const adminAuth = firebaseAdminAuth();
  let decoded;
  try {
    decoded = await adminAuth.verifyIdToken(token);
  } catch (error) {
    throw new AuthRequiredError("Your sign-in has expired. Please sign in again.");
  }
  const user = { uid: decoded.uid, email: decoded.email, name: decoded.name, picture: decoded.picture };
  await syncUser(user);
  return user;
}

export function authErrorResponse(error: unknown) {
  if (error instanceof AuthRequiredError) {
    return Response.json({ error: error.message }, { status: 401 });
  }
  throw error;
}
