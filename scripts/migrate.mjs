import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const { Client } = pg;

// Read .env if DATABASE_URL is not already present in environment
function loadEnv() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, "utf-8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}

loadEnv();

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("❌ Error: DATABASE_URL is not set in your environment or .env file.");
  process.exit(1);
}

const migrationArg = process.argv[2];
const migrationFile = migrationArg
  ? path.resolve(process.cwd(), migrationArg)
  : path.resolve(process.cwd(), "migrations/001_user_data.sql");

if (!fs.existsSync(migrationFile)) {
  console.error(`❌ Migration file not found: ${migrationFile}`);
  process.exit(1);
}

console.log(`Running migration: ${path.basename(migrationFile)}`);

const client = new Client({
  connectionString: dbUrl,
  ssl:
    dbUrl.includes("sslmode=require") ||
    dbUrl.includes("neon.tech") ||
    dbUrl.includes("supabase.co") ||
    dbUrl.includes("rds.amazonaws.com")
      ? { rejectUnauthorized: false }
      : undefined,
});

try {
  const sql = fs.readFileSync(migrationFile, "utf-8");
  await client.connect();
  console.log("Connected to PostgreSQL successfully.");
  await client.query(sql);
  console.log(`✅ Successfully applied: ${path.basename(migrationFile)}`);
} catch (err) {
  console.error("❌ Migration failed:", err.message);
  process.exit(1);
} finally {
  await client.end();
}
