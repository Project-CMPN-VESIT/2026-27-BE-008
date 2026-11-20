'use client';
import { memo, useEffect, useMemo, useRef } from 'react';
import {
  createChart,
  createSeriesMarkers,
  AreaSeries,
  CandlestickSeries,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type IPriceLine,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { RANGES, RangeKey, zoneFor } from '@/lib/tv/config';
import { Bar, makeZoneShift } from '@/lib/chart/transform';

export type Mode = 'line' | 'candle';
export interface PriceLineSpec { price: number; title: string; color: string }   // entry / stop / target
export interface TradeMarker { time: number; side: 'buy' | 'sell'; text?: string } // time = unix seconds

export interface PriceChartProps {
  bars: Bar[];                 // oldest -> newest, already cleaned
  range: RangeKey;             // the range these bars belong to (controls axis format + baseline)
  mode: Mode;
  symbol: string;              // used for exchange time zone
  tick?: Bar | null;           // live bar: applied with series.update()
  priceLines?: PriceLineSpec[];
  markers?: TradeMarker[];
  height?: number;
  dark?: boolean;
  dim?: boolean;               // dim while the next range loads
  onHover?: (bar: Bar | null) => void; // hovered bar (time is exchange-local, treat as UTC)
}

const THEME = {
  light: { text: '#5f6368', grid: '#eceff1', up: '#137333', down: '#c5221f' },
  dark:  { text: '#9aa0a6', grid: '#262a2e', up: '#81c995', down: '#f28b82' },
};
const CUP = '#26a69a', CDOWN = '#ef5350';
const utc = (t: number, o: Intl.DateTimeFormatOptions) => new Date(t * 1000).toLocaleString(undefined, { timeZone: 'UTC', ...o });

interface Handles {
  chart: IChartApi;
  area: ISeriesApi<'Area'>;
  candle: ISeriesApi<'Candlestick'>;
  am: ISeriesMarkersPluginApi<Time>;
  cm: ISeriesMarkersPluginApi<Time>;
  lines: { s: ISeriesApi<'Area'> | ISeriesApi<'Candlestick'>; l: IPriceLine }[];
  lastT: number;
}

function PriceChartImpl({
  bars,
  range,
  mode,
  symbol,
  tick,
  priceLines = [],
  markers = [],
  height = 360,
  dark = false,
  dim = false,
  onHover,
}: PriceChartProps) {
  const el = useRef<HTMLDivElement>(null);
  const h = useRef<Handles | null>(null);
  const hover = useRef(onHover), modeRef = useRef(mode), intraday = useRef(RANGES[range]?.intraday ?? false);
  useEffect(() => { hover.current = onHover; modeRef.current = mode; });
  const shift = useMemo(() => makeZoneShift(zoneFor(symbol)), [symbol]);

  /* ---- 1. create the chart ONCE; both series live for the chart's whole life ---- */
  useEffect(() => {
    if (!el.current) return;
    const t = THEME[dark ? 'dark' : 'light'];
    const chart = createChart(el.current, {
      autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: t.text, fontSize: 12, attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { color: t.grid } },
      rightPriceScale: { borderVisible: false, minimumWidth: 64, scaleMargins: { top: 0.14, bottom: 0.10 } }, // fixed width => stable fitContent
      timeScale: {
        borderVisible: false, fixLeftEdge: true, fixRightEdge: true, rightOffset: 0, secondsVisible: false,
        tickMarkFormatter: (time: Time, type: number) => {
          const s = time as number;
          if (type >= 3) return utc(s, { hour: '2-digit', minute: '2-digit', hour12: false });
          if (type === 2) return utc(s, { day: 'numeric', month: 'short' });
          return type === 1 ? utc(s, { month: 'short' }) : utc(s, { year: 'numeric' });
        },
      },
      localization: {
        timeFormatter: (time: Time) => utc(time as number, intraday.current
          ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }
          : { day: 'numeric', month: 'short', year: 'numeric' }),
      },
      crosshair: { mode: CrosshairMode.Magnet, vertLine: { labelVisible: false, color: t.text }, horzLine: { visible: false, labelVisible: false } },
      handleScale: { mouseWheel: false, axisPressedMouseMove: false },
      kineticScroll: { touch: true, mouse: false },
    });
    const area = chart.addSeries(AreaSeries, { lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerRadius: 4 });
    const candle = chart.addSeries(CandlestickSeries, {
      visible: false, upColor: CUP, downColor: CDOWN, borderVisible: false, wickUpColor: CUP, wickDownColor: CDOWN, priceLineVisible: false,
    });
    h.current = { chart, area, candle, am: createSeriesMarkers(area, []), cm: createSeriesMarkers(candle, []), lines: [], lastT: 0 };

    chart.subscribeCrosshairMove(p => {
      const cb = hover.current; if (!cb) return;
      const d = p.time !== undefined ? p.seriesData.get(modeRef.current === 'line' ? area : candle) as any : undefined;
      if (!d) return cb(null);
      const c = 'value' in d ? d.value : d.close;
      cb({ time: p.time as number, open: d.open ?? c, high: d.high ?? c, low: d.low ?? c, close: c, volume: 0 });
    });
    const scrub = () => {
      el.current?.querySelectorAll('#tv-attr-logo, a[href*="tradingview"], a[title*="TradingView"]').forEach((n) => n.remove());
    };
    scrub();
    const mo = new MutationObserver(scrub);
    mo.observe(el.current, { childList: true, subtree: true });

    return () => {
      mo.disconnect();
      chart.remove();
      h.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- 2. theme ---- */
  useEffect(() => {
    const t = THEME[dark ? 'dark' : 'light'];
    h.current?.chart.applyOptions({ layout: { textColor: t.text }, grid: { horzLines: { color: t.grid } }, crosshair: { vertLine: { color: t.text } } });
  }, [dark]);

  /* ---- 3. data: one setData on the ACTIVE series, then fit ---- */
  useEffect(() => {
    const x = h.current; if (!x) return;
    const line = mode === 'line', act = line ? x.area : x.candle, other = line ? x.candle : x.area;
    intraday.current = RANGES[range]?.intraday ?? false;
    x.chart.applyOptions({ timeScale: { timeVisible: intraday.current } });
    x.area.applyOptions({ visible: line }); x.candle.applyOptions({ visible: !line });
    other.setData([]);
    if (!bars.length) { act.setData([]); return; }
    const d = bars.map(b => ({ ...b, time: shift(b.time) as UTCTimestamp }));
    const base = range === '1D' ? d[0].open : d[0].close; // Google Finance: green/red vs. start of period
    const c = d[d.length - 1].close >= base ? THEME[dark ? 'dark' : 'light'].up : THEME[dark ? 'dark' : 'light'].down;
    if (line) {
      x.area.applyOptions({ lineColor: c, topColor: c + '40', bottomColor: c + '00' });
      x.area.setData(d.map(b => ({ time: b.time, value: b.close })));
    } else {
      x.candle.setData(d.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
    }
    x.lastT = d[d.length - 1].time;
    x.chart.timeScale().fitContent();
    requestAnimationFrame(() => x.chart.timeScale().fitContent()); // second pass once layout has settled
  }, [bars, range, mode, dark, shift]);

  /* ---- 4. live tick: update() touches only the last bar, never setData per tick ---- */
  useEffect(() => {
    const x = h.current; if (!x || !tick || !bars.length) return;
    const t = shift(tick.time) as UTCTimestamp;
    if (t < x.lastT) return; // update() throws on older times
    x.lastT = t;
    if (mode === 'line') x.area.update({ time: t, value: tick.close });
    else x.candle.update({ time: t, open: tick.open, high: tick.high, low: tick.low, close: tick.close });
  }, [tick]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- 5. paper-trading overlays: entry / SL / target lines ---- */
  const plKey = JSON.stringify(priceLines);
  useEffect(() => {
    const x = h.current; if (!x) return;
    x.lines.forEach(({ s, l }) => s.removePriceLine(l)); x.lines = [];
    const s = mode === 'line' ? x.area : x.candle;
    priceLines.forEach(p => x.lines.push({ s, l: s.createPriceLine({ price: p.price, color: p.color, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: p.title }) }));
  }, [plKey, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- 6. buy / sell arrows ---- */
  const mkKey = JSON.stringify(markers);
  useEffect(() => {
    const x = h.current; if (!x) return;
    const first = bars[0]?.time ?? Infinity;
    const ms = markers.filter(m => m.time >= first).sort((a, b) => a.time - b.time).map(m => ({
      time: shift(m.time) as UTCTimestamp,
      position: m.side === 'buy' ? 'belowBar' as const : 'aboveBar' as const,
      color: m.side === 'buy' ? CUP : CDOWN,
      shape: m.side === 'buy' ? 'arrowUp' as const : 'arrowDown' as const,
      text: m.text,
    }));
    (mode === 'line' ? x.am : x.cm).setMarkers(ms);
    (mode === 'line' ? x.cm : x.am).setMarkers([]);
  }, [mkKey, mode, shift, bars]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      ref={el}
      className="[&_#tv-attr-logo]:!hidden [&_a[href*='tradingview']]:!hidden"
      style={{ height, width: '100%', opacity: dim ? 0.55 : 1, transition: 'opacity .15s' }}
    />
  );
}

export default memo(PriceChartImpl);

