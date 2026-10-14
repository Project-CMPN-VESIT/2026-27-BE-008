import "server-only";

import { Pool } from "pg";

const globalForDb = globalThis as typeof globalThis & { finpilotPool?: Pool };

export function getServerPool(): Pool {
  if (globalForDb.finpilotPool) return globalForDb.finpilotPool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not configured");
  const ssl =
    connectionString.includes("sslmode=require") ||
    connectionString.includes("neon.tech") ||
    connectionString.includes("supabase.co") ||
    connectionString.includes("rds.amazonaws.com")
      ? { rejectUnauthorized: false }
      : undefined;
  const pool = new Pool({ connectionString, ssl, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000 });
  globalForDb.finpilotPool = pool;
  return pool;
}

export async function ensureAppUser(profile: { uid: string; email?: string; name?: string; picture?: string }) {
  await getServerPool().query(
    `INSERT INTO app_users (firebase_uid, email, display_name, photo_url)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (firebase_uid) DO UPDATE SET
       email = EXCLUDED.email,
       display_name = COALESCE(app_users.display_name, EXCLUDED.display_name),
       photo_url = COALESCE(app_users.photo_url, EXCLUDED.photo_url),
       updated_at = CURRENT_TIMESTAMP`,
    [profile.uid, profile.email ?? null, profile.name ?? null, profile.picture ?? null],
  );
}
