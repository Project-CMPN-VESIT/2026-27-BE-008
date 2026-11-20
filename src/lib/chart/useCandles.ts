'use client';
import { useEffect, useState } from 'react';
import { RANGES, RangeKey } from '@/lib/tv/config';
import { Bar, clean, toBars } from './transform';

const mem = new Map<string, { t: number; bars: Bar[] }>();
const flight = new Map<string, Promise<Bar[]>>();
const key = (s: string, r: RangeKey) => `${s}|${r}`;

/** Cached + de-duplicated. Safe to call from many components at once. */
export function fetchBars(symbol: string, range: RangeKey): Promise<Bar[]> {
  const k = key(symbol, range), hit = mem.get(k);
  if (hit && Date.now() - hit.t < RANGES[range].ttl) return Promise.resolve(hit.bars);
  let p = flight.get(k);
  if (p) return p;
  p = fetch(`/api/candles?symbol=${encodeURIComponent(symbol)}&range=${range}`)
    .then(async r => {
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      return clean(toBars(j.bars || []));
    })
    .then(bars => {
      mem.set(k, { t: Date.now(), bars });
      if (mem.size > 200) mem.delete(mem.keys().next().value as string);
      return bars;
    })
    .finally(() => flight.delete(k));
  flight.set(k, p);
  return p;
}

export const prefetch = (s: string, r: RangeKey) => { fetchBars(s, r).catch(() => {}); };

interface State {
  symbol: string;
  range: RangeKey;
  bars: Bar[];
  loading: boolean;
  error?: string;
}

/**
 * Shows cached data instantly, keeps the previous chart on screen while the next range loads
 * (no blank flash), and tells you which range the bars belong to via `dataRange`.
 */
export function useCandles(symbol: string, range: RangeKey) {
  const [s, set] = useState<State>({ symbol, range, bars: [], loading: true });

  useEffect(() => {
    let alive = true;
    const hit = mem.get(key(symbol, range));
    set(prev => hit
      ? { symbol, range, bars: hit.bars, loading: false }
      : { symbol, range: prev.symbol === symbol ? prev.range : range, bars: prev.symbol === symbol ? prev.bars : [], loading: true });

    fetchBars(symbol, range)
      .then(bars => {
        if (alive) set({ symbol, range, bars, loading: false });
      })
      .catch(e => {
        if (alive) set(prev => ({ ...prev, loading: false, error: (e as Error).message }));
      });

    return () => {
      alive = false;
    };
  }, [symbol, range]);

  return { bars: s.symbol === symbol ? s.bars : [], dataRange: s.range, loading: s.loading, error: s.error };
}

