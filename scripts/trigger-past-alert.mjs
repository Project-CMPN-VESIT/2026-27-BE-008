import { Pool } from "pg";
import fs from "node:fs";
import path from "node:path";

// Load .env
const envPath = path.join(process.cwd(), ".env");
let dbUrl = "";
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("DATABASE_URL=")) {
      dbUrl = trimmed.slice("DATABASE_URL=".length).trim();
    }
  }
}

if (!dbUrl) {
  console.error("Missing DATABASE_URL in .env");
  process.exit(1);
}

const pool = new Pool({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false },
});

const isRemove = process.argv.includes("--remove");

async function main() {
  const usersRes = await pool.query("SELECT firebase_uid, email, display_name FROM app_users");
  if (!usersRes.rows.length) {
    console.error("No users found in app_users table.");
    process.exit(1);
  }

  // Target all users or specific user
  const targetUsers = usersRes.rows;
  console.log(`Found ${targetUsers.length} user(s) in database:`, targetUsers.map((u) => u.email).filter(Boolean));

  if (isRemove) {
    console.log("Removing test past event alerts...");
    const res = await pool.query("DELETE FROM user_alerts WHERE id LIKE 'test_past_event_%'");
    console.log(`Successfully removed ${res.rowCount || 0} test past event alert(s).`);
    return;
  }

  console.log("Triggering 3 past event alerts for your portfolio stocks...");

  const now = Date.now();
  const pastAlerts = [
    {
      idSuffix: "bhartiartl",
      stock: "BHARTIARTL",
      type: "regulatory",
      headline: "SEBI Compliance Order: Bharti Airtel Ltd cleared under Regulation 30 disclosure framework",
      source: "SEBI / NSE",
      timestamp: new Date(now - 14 * 60 * 1000).toISOString(), // 14 mins ago
    },
    {
      idSuffix: "axisbank",
      stock: "AXISBANK",
      type: "news",
      headline: "Axis Bank Q2 Institutional Earnings Update: Operating profit up +11.4% YoY",
      source: "NSE Filings",
      timestamp: new Date(now - 52 * 60 * 1000).toISOString(), // 52 mins ago
    },
    {
      idSuffix: "icicibank",
      stock: "ICICIBANK",
      type: "news",
      headline: "ICICI Bank General Update: Credit rating affirmed AAA with Stable outlook by CRISIL",
      source: "NSE Corporate",
      timestamp: new Date(now - 3 * 3600 * 1000).toISOString(), // 3 hours ago
    },
  ];

  let totalInserted = 0;

  for (const user of targetUsers) {
    for (const a of pastAlerts) {
      const alertId = `test_past_event_${a.idSuffix}_${user.firebase_uid}`;
      await pool.query(
        `INSERT INTO user_alerts (id, firebase_uid, stock, type, headline, source, timestamp, is_read)
         VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE)
         ON CONFLICT (id) DO UPDATE SET
           is_read = FALSE,
           timestamp = EXCLUDED.timestamp,
           headline = EXCLUDED.headline`,
        [alertId, user.firebase_uid, a.stock, a.type, a.headline, a.source, a.timestamp]
      );
      totalInserted++;
    }
  }

  console.log(`\n SUCCESS: Triggered ${totalInserted} test alerts across ${targetUsers.length} user(s)!`);
  console.log("Open your browser at http://localhost:3000 to see:");
  console.log(" 1. The dynamic badge counter '3' on the notification bell.");
  console.log(" 2. The dropdown showing 14m ago, 52m ago, and 3h ago.");
  console.log("\nTo remove these test events later, run:");
  console.log(" node scripts/trigger-past-alert.mjs --remove\n");
}

main().catch(console.error).finally(() => pool.end());
