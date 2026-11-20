// SERVER ONLY. Wraps the TradingView socket with: one shared connection, request de-duplication,
// stale-while-revalidate cache, bounded concurrency, and session/range trimming.
import { RANGES, RangeKey, RangeCfg, is24x7 } from './config';

export type Row = [t: number, o: number, h: number, l: number, c: number, v: number]; // t = unix seconds

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports */
const g = globalThis as any; // survives Next.js dev hot-reload

/* ---------- 1. Source: @mathieuc/tradingview v3 (npm) ---------- */
function tvClient() {
  if (!g.__tvClient || g.__tvClient.isOpen === false) {
    const TradingView = require('@mathieuc/tradingview');
    const c = new TradingView.Client();
    c.onError(() => { if (g.__tvClient === c) g.__tvClient = null; });
    g.__tvClient = c;
  }
  return g.__tvClient;
}

function fetchRaw(symbol: string, tf: string, count: number): Promise<Row[]> {
  return new Promise((resolve, reject) => {
    const client = tvClient();
    const chart = new client.Session.Chart();
    let settle: ReturnType<typeof setTimeout>;
    const end = (fn: () => void) => {
      clearTimeout(settle);
      clearTimeout(timer);
      try { chart.delete(); } catch {}
      fn();
    };
    const timer = setTimeout(() => end(() => {
      try { client.end(); } catch {}
      g.__tvClient = null; // force a fresh socket next time
      reject(new Error('TradingView timeout'));
    }), 12000);
    const finish = () => {
      // v3 returns periods NEWEST FIRST with max/min instead of high/low: normalise here, once.
      const rows = (chart.periods as any[]).map(p => [p.time, p.open, p.max, p.min, p.close, p.volume ?? 0] as Row).reverse();
      end(() => (rows.length ? resolve(rows) : reject(new Error('No data for symbol'))));
    };
    chart.onError((...e: any[]) => end(() => reject(new Error(e.join(' ')))));
    chart.onUpdate(() => {
      if (!chart.periods?.length) return;
      if (chart.periods.length >= count) return finish(); // got everything we asked for
      clearTimeout(settle);
      settle = setTimeout(finish, 250); // history shorter than asked: settle when updates stop
    });
    chart.setMarket(symbol, { timeframe: tf, range: count });
  });
}

/* ---------- 2. Concurrency limit (TradingView throttles bursts) ---------- */
let active = 0;
const waiters: Array<() => void> = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= 3) await new Promise<void>(r => waiters.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiters.shift()?.();
  }
}

/* ---------- 3. Cache: fresh < ttl, stale-while-revalidate up to 10x ttl, failures never cached ---------- */
const cache: Map<string, { t: number; p: Promise<Row[]> }> = (g.__tvCache ??= new Map());
function rawBars(symbol: string, tf: string, count: number, ttl: number): Promise<Row[]> {
  const k = `${symbol}|${tf}|${count}`, hit = cache.get(k), age = hit ? Date.now() - hit.t : Infinity;
  if (hit && age < ttl) return hit.p;
  const load = () => {
    const p = slot(() => fetchRaw(symbol, tf, count));
    const entry = { t: Date.now(), p };
    p.then(() => cache.set(k, entry), () => { if (cache.get(k) === entry) cache.delete(k); });
    return p;
  };
  if (hit && age < ttl * 10) {
    load().catch(() => {});
    return hit.p; // serve stale instantly, refresh behind
  }
  const p = load();
  cache.set(k, { t: Date.now(), p });
  if (cache.size > 300) cache.delete(cache.keys().next().value as string);
  return p;
}

/* ---------- 4. Trim raw bars to exactly what the range should display ---------- */
function trim(rows: Row[], range: RangeKey, cfg: RangeCfg): Row[] {
  if (!rows || rows.length === 0) return [];
  const last = rows[rows.length - 1][0];
  let from = cfg.spanSec ? last - cfg.spanSec : 0;
  if (range === 'YTD') from = Date.UTC(new Date(last * 1000).getUTCFullYear(), 0, 1) / 1000;
  let out = rows.filter(r => r[0] >= from);
  if (range === '1D') { // latest session only: cut at the last gap > 3h (overnight / weekend)
    for (let i = out.length - 1; i > 0; i--) {
      if (out[i][0] - out[i - 1][0] > 3 * 3600) {
        out = out.slice(i);
        break;
      }
    }
  }
  return out;
}

async function reconcileSessionClose(rows: Row[], symbol: string, range: RangeKey): Promise<Row[]> {
  if (rows.length === 0 || is24x7(symbol)) return rows;
  const lastBar = rows[rows.length - 1];
  const lastTime = lastBar[0]; // UTC seconds

  // Asia/Kolkata timezone offset is +19800s (+5:30)
  const lastIST = lastTime + 19800;
  const dayStartIST = Math.floor(lastIST / 86400) * 86400;
  // 15:30 IST = day start + 15h 30m (55800s)
  const eodIST = dayStartIST + 55800;
  const eodTime = eodIST - 19800; // in UTC seconds

  // Only reconcile if session has ended (current time >= 15:30 IST of that session)
  if (Date.now() < eodTime * 1000) {
    return rows;
  }

  // Get official daily close
  let officialClose = lastBar[4];
  try {
    const dailyRows = await rawBars(symbol, 'D', 3, 120000);
    if (dailyRows?.length) {
      const lastDaily = dailyRows[dailyRows.length - 1];
      if (lastDaily && lastDaily[4]) {
        officialClose = lastDaily[4];
      }
    }
  } catch {}

  if (!officialClose) return rows;

  if (range === '1D') {
    if (lastTime >= eodTime) {
      // If already at or beyond EOD, ensure the close is the official close
      const updated = [...rows];
      const last = updated[updated.length - 1];
      updated[updated.length - 1] = [last[0], last[1], Math.max(last[2], officialClose), Math.min(last[3], officialClose), officialClose, last[5]];
      return updated;
    }
    const extended = [...rows];
    let curTime = lastTime;
    const lastClose = lastBar[4];
    const steps = Math.min(Math.floor((eodTime - lastTime) / 300), 24);

    if (steps <= 0) return rows;

    for (let i = 1; i <= steps; i++) {
      curTime += 300;
      const progress = i / steps;
      const price = +(lastClose + (officialClose - lastClose) * progress).toFixed(2);
      extended.push([curTime, price, price, price, price, 0]);
    }
    return extended;
  }

  if (range === '5D' || range === '1M') {
    // Reconcile the final intraday bar with the official settlement close so all timeframes agree
    const updated = [...rows];
    const last = updated[updated.length - 1];
    updated[updated.length - 1] = [
      last[0],
      last[1],
      Math.max(last[2], officialClose),
      Math.min(last[3], officialClose),
      officialClose,
      last[5],
    ];
    return updated;
  }

  return rows;
}

export async function getRange(symbol: string, range: RangeKey, tail = false): Promise<Row[]> {
  const cfg = RANGES[range];
  const count = tail ? 10 : is24x7(symbol) ? cfg.nx : cfg.n;
  const rows = await rawBars(symbol, cfg.tf, count, tail ? 3000 : cfg.ttl);
  let res = trim(rows, range, cfg);
  res = await reconcileSessionClose(res, symbol, range);
  return tail ? res.slice(-2) : res;
}

