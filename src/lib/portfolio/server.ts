// SERVER ONLY. Fan-out to N symbols with a time budget, then aggregate. The client gets ONE small payload.
import { createHash } from 'crypto';
import { RANGES, RangeKey } from '../tv/config';
import { getRange } from '../tv/server';
import { aggregate, Row, Trade } from './aggregate';

export interface HoldingIn {
  symbol: string;
  qty?: number;
  trades?: Trade[];
  fx?: number;
}

export interface PortfolioResult {
  bars: Row[];
  k: number;
  pending: string[]; // still being fetched upstream: ask again in ~1s (they keep loading in the background)
  failed: string[]; // no price available: excluded from the curve
  total: number; // number of distinct symbols
  partial: boolean;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const g = globalThis as any;
const cache: Map<string, { t: number; v: PortfolioResult }> = (g.__pfCache ??= new Map());

export const portfolioKey = (range: RangeKey, h: HoldingIn[], cash = 0) =>
  createHash('sha1')
    .update(range + ':' + Math.round(cash) + ':' + JSON.stringify([...h].sort((a, b) => a.symbol.localeCompare(b.symbol))))
    .digest('hex');

export async function getPortfolio(
  range: RangeKey,
  holdings: HoldingIn[],
  cash = 0,
  budgetMs = 3000
): Promise<PortfolioResult> {
  const normHoldings = holdings.map((h) => {
    let sym = h.symbol.trim().toUpperCase();
    if (!sym.includes(':')) sym = `NSE:${sym}`;
    return { ...h, symbol: sym };
  });

  const key = portfolioKey(range, normHoldings, cash);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < RANGES[range].ttl) return hit.v;

  const symbols = [...new Set(normHoldings.map((h) => h.symbol))];
  const got = new Map<string, Row[] | null>();

  // getRange() promises are cached per symbol upstream, so work that outlives the budget is NOT wasted: the retry finds it ready.
  const jobs = symbols.map((s) =>
    getRange(s, range).then(
      (r) => void got.set(s, r),
      () => void got.set(s, null)
    )
  );

  let timer: ReturnType<typeof setTimeout>;
  await Promise.race([Promise.all(jobs), new Promise<void>((r) => (timer = setTimeout(r, budgetMs)))]);
  clearTimeout(timer!);

  const { rows, k } = aggregate(
    normHoldings.map((h) => ({ ...h, rows: got.get(h.symbol) ?? [] })),
    cash
  );

  const v: PortfolioResult = {
    bars: rows,
    k,
    pending: symbols.filter((s) => !got.has(s)),
    failed: symbols.filter((s) => got.get(s) === null),
    total: symbols.length,
    partial: symbols.some((s) => !got.has(s)),
  };

  if (!v.partial && rows.length > 0) {
    cache.set(key, { t: Date.now(), v });
    if (cache.size > 200) cache.delete(cache.keys().next().value as string);
  }

  return v;
}

