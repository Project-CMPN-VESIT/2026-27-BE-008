import { NextRequest, NextResponse } from 'next/server';
import { RANGES, RangeKey } from '@/lib/tv/config';
import { getRange } from '@/lib/tv/server';

export const runtime = 'nodejs'; // the TradingView socket needs Node, not the edge runtime
export const dynamic = 'force-dynamic';

const SYMBOL = /^[A-Z0-9_]{1,15}:[A-Z0-9!_.&-]{1,30}$/;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  let symbol = (sp.get('symbol') ?? '').toUpperCase().trim();
  if (symbol && !symbol.includes(':')) {
    symbol = `NSE:${symbol}`;
  }
  const range = (sp.get('range') ?? '1D') as RangeKey;
  const tail = sp.has('tail');

  if (!SYMBOL.test(symbol) || !(range in RANGES)) {
    return NextResponse.json({ error: 'Use symbol=EXCHANGE:TICKER and a valid range' }, { status: 400 });
  }

  try {
    const bars = await getRange(symbol, range, tail); // compact [t,o,h,l,c,v] rows: ~60% smaller JSON
    const ttl = RANGES[range].ttl / 1000;
    return NextResponse.json({ bars }, {
      headers: { 'Cache-Control': tail ? 'no-store' : `public, max-age=0, s-maxage=${ttl}, stale-while-revalidate=${ttl * 5}` },
    });
  } catch (e) {
    console.error(`[api/candles] Error for ${symbol} (${range}):`, e);
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

