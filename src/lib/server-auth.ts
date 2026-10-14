import "server-only";

import type { NextRequest } from "next/server";
import { firebaseAdminAuth } from "@/lib/firebase/admin";
import { ensureAppUser } from "@/lib/server-db";

export class AuthRequiredError extends Error {
  readonly status = 401;
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
  await ensureAppUser(user);
  return user;
}

export function authErrorResponse(error: unknown) {
  if (error instanceof AuthRequiredError) {
    return Response.json({ error: error.message }, { status: 401 });
  }
  throw error;
}
