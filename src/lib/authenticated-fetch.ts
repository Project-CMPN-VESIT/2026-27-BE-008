"use client";

import { firebaseAuth } from "@/lib/firebase/client";

export async function authenticatedFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const user = firebaseAuth.currentUser;
  if (!user) throw new Error("Sign in is required");
  const token = await user.getIdToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (!headers.has("Content-Type") && init.body) headers.set("Content-Type", "application/json");
  return fetch(input, { ...init, headers });
}
