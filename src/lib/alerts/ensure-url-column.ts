import type { Pool } from "pg";

let done: Promise<void> | null = null;

/** Adds the source-link column to user_alerts once per server process (safe to call on every request). */
export function ensureAlertUrlColumn(pool: Pool): Promise<void> {
  if (!done) {
    done = pool
      .query("ALTER TABLE user_alerts ADD COLUMN IF NOT EXISTS url TEXT")
      .then(() => undefined)
      .catch((err) => {
        done = null;
        throw err;
      });
  }
  return done;
}
