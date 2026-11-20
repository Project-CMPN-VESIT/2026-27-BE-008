// Pure maths, no dependencies: runs on server or client, easy to unit test.
// Combines N holdings' bars into ONE portfolio series (line AND candles) in O(N x bars).
export type Row = [t: number, o: number, h: number, l: number, c: number, v: number]; // t = unix seconds
export interface Trade { ts: number; qty: number } // unix SECONDS; +buy / -sell
export interface Part {
  rows: Row[];      // one holding's bars for the range (any order; sorted + de-duplicated here)
  qty?: number;     // constant quantity ("what if I held this the whole time") ...
  trades?: Trade[]; // ... OR a ledger: quantity changes over time (takes priority over qty)
  fx?: number;      // price multiplier into the portfolio currency (e.g. USD->INR). Default 1
}

const r2 = (x: number) => Math.round(x * 100) / 100;
const std = (x: ArrayLike<number>) => {
  let m = 0, v = 0; const n = x.length; if (n < 2) return 0;
  for (let i = 0; i < n; i++) m += x[i]; m /= n;
  for (let i = 0; i < n; i++) v += (x[i] - m) ** 2;
  return Math.sqrt(v / (n - 1));
};

/**
 * Portfolio bar at time t:
 *   open  = sum(qty x open_i) + cash    EXACT      close = sum(qty x close_i) + cash   EXACT
 *   high / low need the *intra-bar* path of every holding, which bars don't contain, so they are ESTIMATED:
 *   high = max(open, close) + k x sum(qty x upperWick_i)     low = min(open, close) - k x sum(qty x lowerWick_i)
 *   k in [0,1] is a diversification factor = stdev(portfolio bar-to-bar change) / sum(stdev of each holding's change).
 *   k = 1 for one holding (exact) or perfectly correlated ones; ~1/sqrt(N) for N independent ones.
 *   Always inside the hard bounds [sum(qty x low_i) + cash, sum(qty x high_i) + cash].
 * Missing bars (illiquid stock, other exchange closed) are forward-filled with the last close.
 */
export function aggregate(parts: Part[], cash = 0): { rows: Row[]; k: number } {
  const ps = parts.filter(p => p.rows && p.rows.length).map(p => {
    const seen = new Set<number>();
    const rows = [...p.rows].sort((a, b) => a[0] - b[0]).filter(r => !seen.has(r[0]) && seen.add(r[0]));
    return { ...p, rows };
  });
  if (!ps.length) return { rows: [], k: 1 };

  const times = new Set<number>(); for (const p of ps) for (const r of p.rows) times.add(r[0]);
  const T = [...times].sort((a, b) => a - b), n = T.length;
  const diffs = T.slice(1).map((t, i) => t - T[i]).sort((a, b) => a - b);
  const step = diffs.length ? diffs[diffs.length >> 1] : 0;

  const O = new Float64Array(n), C = new Float64Array(n), U = new Float64Array(n), W = new Float64Array(n), P = new Float64Array(n);
  let sumSigma = 0;

  for (const p of ps) {
    const mult = p.fx ?? 1, ledger = p.trades ? [...p.trades].sort((a, b) => a.ts - b.ts) : null;
    let q = ledger ? 0 : p.qty ?? 0, ti = 0, ri = 0;
    const rows = p.rows;
    // late-listed holding (first bar well after window start): contributes nothing before it exists; otherwise back-fill flat
    let lc = rows[0][0] - T[0] <= 3 * step ? rows[0][1] : NaN, prevC = NaN;
    const dl = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const t = T[i];
      if (ledger) while (ti < ledger.length && ledger[ti].ts <= t) q += ledger[ti++].qty; // trade during a bar counts from the next bar
      let o: number, h: number, l: number, c: number;
      if (ri < rows.length && rows[ri][0] === t) { [, o, h, l, c] = rows[ri++]; lc = c; }
      else if (Number.isNaN(lc)) continue;
      else o = h = l = c = lc;
      if (!Number.isNaN(prevC)) dl[i] = c - prevC;
      prevC = c;
      const w = q * mult; if (!w) continue;
      const top = Math.max(o, c), bot = Math.min(o, c), up = Math.max(0, h - top), dn = Math.max(0, bot - l);
      O[i] += w * o; C[i] += w * c;
      if (w > 0) { U[i] += w * up; W[i] += w * dn; } else { U[i] += -w * dn; W[i] += -w * up; } // short: price low = value high
    }
    const wEnd = q * mult; // volatility weights use the final quantity
    if (wEnd) { sumSigma += Math.abs(wEnd) * std(dl); for (let i = 0; i < n; i++) P[i] += wEnd * dl[i]; }
  }

  const k = sumSigma > 0 ? Math.min(1, std(P) / sumSigma) : 1;
  const rows: Row[] = []; let started = false;
  for (let i = 0; i < n; i++) {
    if (!started) { if (O[i] === 0 && C[i] === 0) continue; started = true; } // skip bars before the first purchase
    const top = Math.max(O[i], C[i]), bot = Math.min(O[i], C[i]);
    rows.push([
      T[i],
      r2(O[i] + cash),
      r2(top + k * U[i] + cash),
      r2(bot - k * W[i] + cash),
      r2(C[i] + cash),
      0,
    ]);
  }
  return { rows, k: r2(k * 1000) / 1000 };
}

