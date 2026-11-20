"use client";

import { firebaseAuth } from "@/lib/firebase/client";

export async function authenticatedFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  let user = firebaseAuth.currentUser;

  // If Firebase client is still restoring session from indexedDB/localStorage, wait for authStateReady
  if (!user) {
    if (typeof (firebaseAuth as any).authStateReady === "function") {
      try {
        await (firebaseAuth as any).authStateReady();
        user = firebaseAuth.currentUser;
      } catch {}
    }

    if (!user) {
      // Fallback: poll briefly for currentUser (up to 1.5s)
      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 100));
        user = firebaseAuth.currentUser;
        if (user) break;
      }
    }
  }

  if (!user) throw new Error("Sign in is required");
  const token = await user.getIdToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (!headers.has("Content-Type") && init.body) headers.set("Content-Type", "application/json");
  return fetch(input, { ...init, headers });
}
