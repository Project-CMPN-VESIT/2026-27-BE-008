export interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export const toBars = (rows: number[][]): Bar[] =>
  rows.map(([time, open, high, low, close, volume]) => ({ time, open, high, low, close, volume }));

/** lightweight-charts THROWS on unsorted/duplicate times or NaN. Always pass data through this. */
export function clean(bars: Bar[]): Bar[] {
  const ok = bars
    .filter(b => [b.time, b.open, b.high, b.low, b.close].every(Number.isFinite))
    .sort((a, b) => a.time - b.time);
  return ok.filter((b, i) => i === 0 || b.time !== ok[i - 1].time);
}

/**
 * lightweight-charts draws timestamps as UTC. Shifting them by the exchange's UTC offset makes the axis
 * show exchange-local time (without this, NSE 09:15 IST shows as 03:45).
 */
export function makeZoneShift(timeZone: string) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  });
  const memo = new Map<number, number>();
  return (t: number) => {
    const k = Math.floor(t / 21600); // offsets only change at DST edges: cache per 6h
    let off = memo.get(k);
    if (off === undefined) {
      const p = Object.fromEntries(f.formatToParts(new Date(t * 1000)).map(x => [x.type, x.value]));
      off = Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) / 1000 - t) / 900) * 900;
      memo.set(k, off);
    }
    return t + off;
  };
}

/** Portfolio value over time = sum(qty x close) across holdings, forward-filled. Starts when every holding has data. */
export function portfolioCurve(parts: { qty: number; bars: Bar[] }[]): Bar[] {
  const times = [...new Set(parts.flatMap(p => p.bars.map(b => b.time)))].sort((a, b) => a - b);
  const idx = parts.map(() => 0), last = parts.map(() => NaN), out: Bar[] = [];
  for (const t of times) {
    let v = 0, ready = true;
    parts.forEach((p, i) => {
      while (idx[i] < p.bars.length && p.bars[idx[i]].time <= t) last[i] = p.bars[idx[i]++].close;
      if (Number.isNaN(last[i])) ready = false; else v += last[i] * p.qty;
    });
    if (ready) out.push({ time: t, open: v, high: v, low: v, close: v, volume: 0 });
  }
  return out;
}

