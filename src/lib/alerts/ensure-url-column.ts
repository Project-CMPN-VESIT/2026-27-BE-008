import type { Pool } from "pg";

let done: Promise<void> | null = null;

/** Adds the source-link column to user_alerts once per server process (safe to call on every request). */
export function ensureAlertUrlColumn(pool: Pool): Promise<void> {
  if (!done) {
    done = pool
      .query(`
        CREATE TABLE IF NOT EXISTS user_alerts (
          id TEXT PRIMARY KEY,
          firebase_uid TEXT NOT NULL,
          stock TEXT NOT NULL,
          type TEXT NOT NULL,
          headline TEXT NOT NULL,
          source TEXT,
          timestamp TIMESTAMPTZ NOT NULL,
          is_read BOOLEAN NOT NULL DEFAULT FALSE,
          url TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_user_alerts_uid_timestamp
          ON user_alerts(firebase_uid, timestamp DESC);
        ALTER TABLE user_alerts ADD COLUMN IF NOT EXISTS url TEXT;
      `)
      .then(() => undefined)
      .catch((err) => {
        done = null;
        throw err;
      });
  }
  return done;
}
