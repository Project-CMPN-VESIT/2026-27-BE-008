'use client';

import { useEffect, useRef, useState } from 'react';
import { RANGES, RangeKey } from '@/lib/tv/config';
import { Bar, clean, toBars } from '@/lib/chart/transform';

export interface Holding {
  symbol: string;
  qty?: number;
  trades?: { ts: number; qty: number }[];
  fx?: number;
}

interface Reply {
  bars: number[][];
  k: number;
  pending: string[];
  failed: string[];
  total: number;
  partial: boolean;
}

interface Done {
  t: number;
  bars: Bar[];
  k: number;
  failed: string[];
  total: number;
}

const mem = new Map<string, Done>();

const norm = (h: Holding[]) =>
  [...h]
    .map((x) => ({ ...x, symbol: x.symbol.toUpperCase() }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));

const keyOf = (hStr: string, r: RangeKey, cash = 0) => `${hStr}|${r}|${Math.round(cash)}`;

async function post(range: RangeKey, holdings: Holding[], cash = 0, signal?: AbortSignal): Promise<Reply> {
  const r = await fetch('/api/portfolio/chart', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ range, holdings, cash }),
    signal,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j;
}

const store = (key: string, j: Reply) =>
  mem.set(key, {
    t: Date.now(),
    bars: clean(toBars(j.bars)),
    k: j.k,
    failed: j.failed,
    total: j.total,
  });

/** Warm another range (call on timeframe hover). Only complete results are cached. */
export function prefetchPortfolio(holdings: Holding[], range: RangeKey, cash = 0) {
  if (!holdings || holdings.length === 0) return;
  const h = norm(holdings);
  const key = keyOf(JSON.stringify(h), range, cash);
  const hit = mem.get(key);
  if (hit && Date.now() - hit.t < RANGES[range].ttl) return;
  post(range, h, cash)
    .then((j) => {
      if (!j.partial) store(key, j);
    })
    .catch(() => {});
}

interface State {
  range: RangeKey;
  bars: Bar[];
  k: number;
  loading: boolean;
  pending: number;
  failed: string[];
  total: number;
  error?: string;
}

/**
 * One request per (portfolio, range, cash). Cold server => partial answer within ~2.5s, then re-polls every 1.2s until complete
 * (progress is exposed). Keeps the previous curve on screen meanwhile. `tick` = live last bar when refreshMs is set.
 */
export function usePortfolio(holdings: Holding[], range: RangeKey, refreshMs = 0, cash = 0) {
  const sigNow = JSON.stringify({ h: norm(holdings), cash: Math.round(cash) });
  const [sig, setSig] = useState(sigNow);

  // Debounce quantity / position edits
  useEffect(() => {
    const id = setTimeout(() => setSig(sigNow), 200);
    return () => clearTimeout(id);
  }, [sigNow]);

  const [s, set] = useState<State>({
    range,
    bars: [],
    k: 1,
    loading: holdings.length > 0,
    pending: 0,
    failed: [],
    total: holdings.length,
  });
  const [tick, setTick] = useState<Bar | null>(null);
  const done = useRef(false);

  useEffect(() => {
    let parsed: { h: Holding[]; cash: number };
    try {
      parsed = JSON.parse(sig);
    } catch {
      parsed = { h: norm(holdings), cash: Math.round(cash) };
    }
    const h = parsed.h || [];
    const currentCash = parsed.cash || 0;

    if (h.length === 0) {
      set({ range, bars: [], k: 1, loading: false, pending: 0, failed: [], total: 0 });
      done.current = true;
      return;
    }

    const key = keyOf(JSON.stringify(h), range, currentCash);
    const ctrl = new AbortController();
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    done.current = false;
    setTick(null);

    const hit = mem.get(key);
    if (hit && Date.now() - hit.t < RANGES[range].ttl) {
      set({
        range,
        bars: hit.bars,
        k: hit.k,
        loading: false,
        pending: 0,
        failed: hit.failed,
        total: hit.total,
      });
      done.current = true;
      return;
    }

    set((p) => ({ ...p, loading: true, error: undefined }));

    const run = async (attempt: number) => {
      try {
        const j = await post(range, h, currentCash, ctrl.signal);
        if (!alive) return;
        if (!j.partial) {
          store(key, j);
          done.current = true;
        }
        const bars = clean(toBars(j.bars));
        set((p) => ({
          range: bars.length || !j.partial ? range : p.range,
          bars: bars.length || !j.partial ? bars : p.bars,
          k: j.k,
          loading: j.partial,
          pending: j.pending?.length ?? 0,
          failed: j.failed ?? [],
          total: j.total ?? 0,
        }));
        if (j.partial && attempt < 12) {
          timer = setTimeout(() => run(attempt + 1), 1200);
        } else if (j.partial) {
          set((p) => ({ ...p, loading: false, error: 'Some stock prices are still synchronizing.' }));
        }
      } catch (e) {
        if (alive && (e as Error).name !== 'AbortError') {
          set((p) => ({ ...p, loading: false, error: (e as Error).message }));
        }
      }
    };

    run(0);
    return () => {
      alive = false;
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [sig, range]);

  // Live polling tick: update only the last bar via series.update()
  useEffect(() => {
    if (!refreshMs) return;
    let parsed: { h: Holding[]; cash: number };
    try {
      parsed = JSON.parse(sig);
    } catch {
      parsed = { h: norm(holdings), cash: Math.round(cash) };
    }
    const h = parsed.h || [];
    const currentCash = parsed.cash || 0;
    if (h.length === 0) return;

    let alive = true;
    const id = setInterval(async () => {
      if (document.hidden || !done.current) return;
      try {
        const j = await post(range, h, currentCash);
        const last = !j.partial && toBars(j.bars).pop();
        if (alive && last) setTick(last);
      } catch {
        /* keep last */
      }
    }, refreshMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [sig, range, refreshMs]);

  return { ...s, dataRange: s.range, tick };
}
