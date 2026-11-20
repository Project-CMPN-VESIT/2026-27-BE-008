"use client";

/**
 * Fetch JSON from an admin API with one quick retry for transient failures (a dropped request while the server is
 * busy used to leave the page empty until the next manual reload). A 401 is returned as-is so the caller can end the
 * admin session instead of showing an empty page.
 */
export async function adminFetchJson<T>(url: string): Promise<{ status: number; data: T | null }> {
  let last: { status: number; data: T | null } = { status: 0, data: null };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (res.status === 401) return { status: 401, data: null };
      if (res.ok) return { status: res.status, data: (await res.json()) as T };
      last = { status: res.status, data: null };
    } catch {
      last = { status: 0, data: null };
    }
    if (attempt === 0) await new Promise((r) => setTimeout(r, 500));
  }
  return last;
}
