#!/usr/bin/env node
/**
 * FinPilot end-to-end smoke test.
 *
 * Runs against a live stack (default http://localhost:3000, override with BASE_URL) and checks that every page
 * serves, that public APIs return sensible data and reject bad input, and that protected APIs refuse anonymous
 * callers. It needs no credentials. Exit code is 1 when any check fails.
 *
 *   npm run test:smoke
 *   BASE_URL=http://localhost:3001 npm run test:smoke
 */
const BASE = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const TIMEOUT_MS = 45_000;

const results = [];
let currentGroup = "";

async function call(method, path, { body, headers, cookie } = {}) {
  const started = performance.now();
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: "manual",
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { res, text, json, ms: Math.round(performance.now() - started), setCookie: res.headers.get("set-cookie") || "" };
}

function group(name) {
  currentGroup = name;
  console.log(`\n${name}`);
}

async function check(name, fn, { maxMs } = {}) {
  const started = performance.now();
  try {
    const detail = await fn();
    const ms = Math.round(performance.now() - started);
    if (maxMs && ms > maxMs) throw new Error(`too slow: ${ms}ms (limit ${maxMs}ms)`);
    results.push({ group: currentGroup, name, ok: true, ms });
    console.log(`  PASS  ${name}${detail ? `  (${detail})` : ""}  ${ms}ms`);
  } catch (error) {
    results.push({ group: currentGroup, name, ok: false, error: error.message });
    console.log(`  FAIL  ${name}  -> ${error.message}`);
  }
}

const expect = (cond, message) => {
  if (!cond) throw new Error(message);
};
const status = (r, ...allowed) => expect(allowed.includes(r.res.status), `HTTP ${r.res.status}, expected ${allowed.join(" or ")}`);

// ── pages ────────────────────────────────────────────────────────────────────────────────────────
group("Pages serve (HTML shell, warm)");
const pages = ["/", "/home", "/sign-in", "/sign-up", "/forgot-password", "/cyro", "/screener", "/heatmap", "/baskets",
  "/invest-like", "/news-feed", "/nifty-shorts", "/shorts", "/paper-trading", "/portfolio", "/profile", "/regulatory",
  "/results-calendar", "/compare", "/chart", "/company/TCS", "/admin", "/admin/users"];
for (const page of pages) {
  await check(`GET ${page}`, async () => {
    const r = await call("GET", page);
    status(r, 200, 307, 308);
    if (r.res.status === 200) expect(r.text.includes("<html"), "no HTML document");
  }, { maxMs: 3000 });
}
await check("unknown route returns 404", async () => status(await call("GET", "/definitely-not-a-page"), 404));

// ── market data ───────────────────────────────────────────────────────────────────────────────────
group("Market data APIs");
await check("market-overview returns indices, sectors, breadth", async () => {
  const r = await call("GET", "/api/market-overview");
  status(r, 200);
  expect(r.json.indices.length >= 4, "fewer than 4 indices");
  expect(r.json.indices.every((i) => i.value > 0), "an index has no value");
  expect(r.json.sectors.length >= 3, "fewer than 3 sectors");
  expect(r.json.breadth.advances + r.json.breadth.declines + r.json.breadth.unchanged > 0, "empty breadth");
  return `${r.json.indices.length} indices`;
});
await check("live-quote returns a live positive price", async () => {
  const r = await call("GET", "/api/live-quote?symbol=NSE_TCS");
  status(r, 200);
  expect(r.json.data.source === "live" && r.json.data.ltp > 0, `source=${r.json.data.source} ltp=${r.json.data.ltp}`);
  return `TCS ${r.json.data.ltp}`;
}, { maxMs: 8000 });
await check("live-quote never invents a price for an unknown symbol", async () => {
  const r = await call("GET", "/api/live-quote?symbol=ZZZNOSUCHSTOCK");
  status(r, 200);
  expect(r.json.data.ltp === 0 && r.json.data.source === "unavailable", JSON.stringify(r.json.data));
});
await check("live-quote rejects missing / malformed symbol", async () => {
  status(await call("GET", "/api/live-quote"), 400);
  status(await call("GET", "/api/live-quote?symbol=" + encodeURIComponent("a b;drop")), 400);
});
await check("tv-search finds TCS with a live price (no fabricated fallback)", async () => {
  const r = await call("GET", "/api/tv-search?q=tcs");
  status(r, 200);
  expect(r.json.data.some((x) => x.symbol === "TCS"), "TCS not found");
  for (const item of r.json.data) if (item.price) expect(/^₹[\d,]+\.\d{2}$/.test(item.price), `odd price ${item.price}`);
});
await check("tv-search handles empty and hostile queries", async () => {
  status(await call("GET", "/api/tv-search?q="), 200);
  status(await call("GET", "/api/tv-search?q=" + encodeURIComponent("'; DROP TABLE x;--")), 200);
});
await check("tv-chart returns candles for TCS", async () => {
  const r = await call("GET", "/api/tv-chart?symbol=TCS&timeframe=D&range=30");
  status(r, 200);
  expect(r.json.data.candles.length > 10, `only ${r.json.data.candles.length} candles`);
}, { maxMs: 10000 });
await check("tv-chart tolerates bad timeframe/range and unknown symbol", async () => {
  status(await call("GET", "/api/tv-chart?symbol=TCS&timeframe=BAD&range=-4"), 200);
  status(await call("GET", "/api/tv-chart?symbol=ZZZNOSUCHSTOCK"), 404);
});
await check("candles validates symbol and range", async () => {
  status(await call("GET", "/api/candles?symbol=TCS&range=NOPE"), 400);
  status(await call("GET", "/api/candles?symbol=" + encodeURIComponent("../../etc")), 400);
});
await check("heatmap snapshot validates symbols", async () => {
  status(await call("GET", "/api/heatmap/snapshot"), 400);
  status(await call("GET", "/api/heatmap/snapshot?symbols=" + encodeURIComponent("not a symbol")), 400);
  status(await call("GET", "/api/heatmap/snapshot?symbols=" + Array.from({ length: 200 }, (_, i) => `NSE:S${i}`).join(",")), 400);
  const ok = await call("GET", "/api/heatmap/snapshot?symbols=NSE:TCS,NSE:INFY");
  status(ok, 200);
});
await check("heatmap stream validates symbols", async () => {
  status(await call("GET", "/api/heatmap"), 400);
  status(await call("GET", "/api/heatmap?symbols=bad"), 400);
});

// ── content APIs ─────────────────────────────────────────────────────────────────────────────────
group("Content APIs");
await check("news supports limit and rejects a bad source", async () => {
  const r = await call("GET", "/api/news?limit=5");
  status(r, 200);
  expect(r.json.results.length <= 5, "limit ignored");
  status(await call("GET", "/api/news?source=XYZ"), 400);
});
await check("news full list is bounded", async () => {
  const r = await call("GET", "/api/news");
  status(r, 200);
  expect(r.json.results.length <= 5000, `${r.json.results.length} rows`);
});
await check("results-calendar returns real rows or an honest 503 (never invented data)", async () => {
  const r = await call("GET", "/api/results-calendar");
  status(r, 200, 503);
  if (r.res.status === 200) expect(!/Seed/i.test(r.json.source), `source ${r.json.source}`);
  status(await call("GET", "/api/results-calendar?fromdate=bad"), 400);
});
await check("company-profile requires a symbol", async () => status(await call("GET", "/api/company-profile"), 400));
await check("stock-docs degrades gracefully and hides provider errors", async () => {
  const r = await call("GET", "/api/stock-docs?symbol=TCS");
  status(r, 200);
  expect(!/AWS|Access Key/i.test(r.text), "cloud error leaked to the browser");
  status(await call("GET", "/api/stock-docs"), 400);
});
await check("shorts blocks path traversal", async () => {
  status(await call("GET", "/api/shorts?date=" + encodeURIComponent("../../..")), 400);
  status(await call("GET", "/api/shorts?symbol=" + encodeURIComponent("../x")), 400);
  status(await call("GET", "/api/shorts"), 200);
});
await check("baskets list and detail", async () => {
  const list = await call("GET", "/api/baskets");
  status(list, 200);
  expect(list.json.baskets.length > 0, "no baskets");
  status(await call("GET", "/api/baskets/does-not-exist"), 404);
  status(await call("GET", "/api/baskets/stocks/NOPE/scores"), 404);
});

// ── security ─────────────────────────────────────────────────────────────────────────────────────
group("Protected endpoints refuse anonymous callers");
for (const [method, path, body] of [
  ["GET", "/api/admin/users"], ["GET", "/api/admin/health"], ["GET", "/api/paper-trading/portfolio"],
  ["POST", "/api/paper-trading/execute", {}], ["POST", "/api/paper-trading/mentor", {}], ["GET", "/api/user/profile"],
  ["GET", "/api/user/preferences"], ["GET", "/api/alerts"], ["GET", "/api/cyro-market?endpoint=alerts&ticker=TCS"],
  ["GET", "/api/screener/meta"], ["POST", "/api/screener/run", {}], ["POST", "/api/baskets/refresh"],
  ["GET", "/api/cyro-agent/sessions"], ["GET", "/api/cyro-agent/memory"],
  // admin-only consoles: video generation and the SEBI Shield scraper
  ["GET", "/api/nifty-shorts"], ["GET", "/api/nifty-shorts/batch"], ["POST", "/api/nifty-shorts/generate", {}],
  ["POST", "/api/nifty-shorts/video", {}], ["GET", "/api/nifty-shorts/video/batch"], ["DELETE", "/api/nifty-shorts/batch"],
  ["GET", "/api/regulatory/entities"], ["POST", "/api/regulatory/pipeline", {}],
]) {
  await check(`${method} ${path} -> 401`, async () => status(await call(method, path, { body }), 401));
}
await check("forged admin cookies are rejected", async () => {
  status(await call("GET", "/api/admin/users", { cookie: "finpilot_admin_session=admin.9999999999.deadbeef" }), 401);
  status(await call("GET", "/api/admin/users", { cookie: "finpilot_admin_auth=true" }), 401);
});
await check("admin login validates input and rejects bad credentials", async () => {
  status(await call("POST", "/api/admin/session", { body: "not json" }), 400);
  status(await call("POST", "/api/admin/session", { body: { username: "admin" } }), 400);
  status(await call("POST", "/api/admin/session", { body: { username: "admin", password: "wrong-" + Date.now() } }), 401);
});

// ── report ───────────────────────────────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed against ${BASE}`);
if (failed.length) {
  console.log("\nFailures:");
  for (const f of failed) console.log(`  [${f.group}] ${f.name}: ${f.error}`);
  process.exit(1);
}
