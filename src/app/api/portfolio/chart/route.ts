import { NextRequest, NextResponse } from 'next/server';
import { RANGES, RangeKey } from '@/lib/tv/config';
import { getPortfolio, HoldingIn } from '@/lib/portfolio/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SYMBOL = /^[A-Z0-9_]{1,15}:[A-Z0-9!_.&-]{1,30}$/;
const num = (x: unknown, lim = 1e9) => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= lim;

function parse(raw: unknown): HoldingIn[] | null {
  if (!Array.isArray(raw)) return null;
  if (raw.length === 0) return [];
  if (raw.length > 200) return null;

  let trades = 0;
  const out: HoldingIn[] = [];
  for (const h of raw) {
    let symbol = String(h?.symbol ?? '').toUpperCase().trim();
    if (symbol && !symbol.includes(':')) symbol = `NSE:${symbol}`;
    if (!SYMBOL.test(symbol)) continue;
    if (h.fx !== undefined && !(num(h.fx, 1e6) && h.fx > 0)) continue;
    if (h.qty !== undefined && !num(h.qty)) continue;
    if (h.trades !== undefined) {
      if (!Array.isArray(h.trades) || (trades += h.trades.length) > 20000) continue;
      if (!h.trades.every((t: any) => num(t?.ts, 4e9) && num(t?.qty))) continue;
    }
    if (h.qty === undefined && h.trades === undefined) continue;
    out.push({ symbol, qty: h.qty, trades: h.trades, fx: h.fx });
  }
  return out;
}

// POST (not GET): a portfolio with a trade ledger or multiple holdings fits cleanly in JSON body.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const range = (body?.range ?? '1D') as RangeKey;
  const holdings = parse(body?.holdings);
  const cash = typeof body?.cash === 'number' && Number.isFinite(body.cash) ? body.cash : 0;

  if (!(range in RANGES) || holdings === null) {
    return NextResponse.json({ error: 'Bad range or holdings' }, { status: 400 });
  }

  try {
    const result = await getPortfolio(range, holdings, cash);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('[API /portfolio/chart error]:', e);
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

