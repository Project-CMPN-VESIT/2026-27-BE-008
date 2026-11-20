'use client';
import { useEffect, useMemo, useState } from 'react';
import { RANGES, RANGE_KEYS, RangeKey } from '@/lib/tv/config';
import { Bar, toBars } from '@/lib/chart/transform';
import { prefetch, useCandles } from '@/lib/chart/useCandles';
import PriceChart, { Mode, PriceLineSpec, TradeMarker } from './PriceChart';

export interface ExchangeOption {
  exchange: string;
  marketId: string;
}

export interface SymbolChartProps {
  symbol: string;                 // TradingView symbol, e.g. "NSE:RELIANCE"
  companyName?: string;
  exchangeOptions?: ExchangeOption[];
  onSelectMarketId?: (marketId: string) => void;
  defaultRange?: RangeKey;
  defaultMode?: Mode;
  height?: number;
  live?: boolean;                 // poll the last bar every 4s (paper trading)
  prefetchAll?: boolean;          // warm every range after first paint (use on ONE main chart, not in long lists)
  compact?: boolean;              // hides OHLC row + shrinks header (portfolio cards)
  dark?: boolean;
  priceLines?: PriceLineSpec[];
  markers?: TradeMarker[];
  onPrice?: (price: number) => void; // fires on load + every live tick
  onHoverCandle?: (bar: Bar | null) => void;
  className?: string;
  zoom?: number;
}

const fmt = (p: number) =>
  p.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const fmtTime = (t: number, intraday: boolean) =>
  new Date(t * 1000).toLocaleString('en-IN', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    ...(intraday
      ? { year: undefined, hour: '2-digit', minute: '2-digit', hour12: true }
      : { year: 'numeric' }),
  });

function useDelayed(v: boolean, ms: number) {
  const [d, set] = useState(false);
  useEffect(() => {
    if (!v) { set(false); return; }
    const id = setTimeout(() => set(true), ms);
    return () => clearTimeout(id);
  }, [v, ms]);
  return d;
}

export default function SymbolChart({
  symbol,
  companyName,
  exchangeOptions,
  onSelectMarketId,
  defaultRange = '1D',
  defaultMode = 'line',
  height = 420,
  live = false,
  prefetchAll = true,
  compact = false,
  dark,
  priceLines,
  markers,
  onPrice,
  onHoverCandle,
  className = '',
  zoom,
}: SymbolChartProps) {
  const [range, setRange] = useState<RangeKey>(defaultRange);
  const [mode, setMode] = useState<Mode>(defaultMode);
  const [hover, setHover] = useState<Bar | null>(null);
  const [tick, setTick] = useState<Bar | null>(null);

  // Auto theme detection if dark prop not explicitly specified
  const [isDark, setIsDark] = useState<boolean>(() => {
    if (typeof dark === 'boolean') return dark;
    if (typeof document !== 'undefined') {
      return document.documentElement.classList.contains('dark');
    }
    return false;
  });

  useEffect(() => {
    if (typeof dark === 'boolean') {
      setIsDark(dark);
      return;
    }
    const root = document.documentElement;
    const sync = () => setIsDark(root.classList.contains('dark'));
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, [dark]);

  const { bars, dataRange, loading, error } = useCandles(symbol, range);
  const slow = useDelayed(loading, 150);

  useEffect(() => {
    setTick(null);
    setHover(null);
    onHoverCandle?.(null);
  }, [symbol, dataRange]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (bars.length) {
      onPrice?.(bars[bars.length - 1].close);
    }
  }, [bars]); // eslint-disable-line react-hooks/exhaustive-deps

  // Idle prefetch of every range
  useEffect(() => {
    if (!prefetchAll || !bars.length) return;
    const id = setTimeout(() => {
      RANGE_KEYS.forEach((k) => prefetch(symbol, k));
    }, 600);
    return () => clearTimeout(id);
  }, [prefetchAll, symbol, bars.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live polling tail: every 4s
  useEffect(() => {
    if (!live || !bars.length) return;
    let alive = true;
    const id = setInterval(async () => {
      if (document.hidden) return;
      try {
        const r = await fetch(`/api/candles?symbol=${encodeURIComponent(symbol)}&range=${dataRange}&tail=1`);
        const rows = (await r.json()).bars as number[][];
        const last = rows && toBars(rows).pop();
        if (alive && last) {
          setTick(last);
          onPrice?.(last.close);
        }
      } catch {
        // keep last good state
      }
    }, 4000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [live, symbol, dataRange, bars.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const intraday = RANGES[dataRange]?.intraday ?? false;
  const last = tick ?? bars[bars.length - 1];
  const first = useMemo(() => {
    if (!bars.length) return 0;
    return dataRange === '1D' ? bars[0].open : bars[0].close;
  }, [bars, dataRange]);

  const shown = hover ?? last;
  const diff = shown && first ? shown.close - first : 0;
  const pct = first ? (diff / first) * 100 : 0;
  const isUp = diff >= 0;

  const handleHover = (bar: Bar | null) => {
    setHover(bar);
    onHoverCandle?.(bar);
  };

  const currentExchange = useMemo(() => {
    return symbol.includes(':') ? symbol.split(':')[0].toUpperCase() : 'NSE';
  }, [symbol]);

  const displaySymbol = useMemo(() => {
    if (symbol.includes(':')) return symbol.toUpperCase();
    return `${currentExchange}:${symbol.toUpperCase()}`;
  }, [symbol, currentExchange]);

  const rawTicker = useMemo(() => {
    return symbol.includes(':') ? symbol.split(':')[1].toUpperCase() : symbol.toUpperCase();
  }, [symbol]);

  const options: ExchangeOption[] = useMemo(() => {
    if (exchangeOptions && exchangeOptions.length > 0) return exchangeOptions;
    return [
      { exchange: 'NSE', marketId: `NSE:${rawTicker}` },
      { exchange: 'BSE', marketId: `BSE:${rawTicker}` },
    ];
  }, [exchangeOptions, rawTicker]);

  const upColor = isDark ? '#81c995' : '#137333';
  const downColor = isDark ? '#f28b82' : '#c5221f';
  const activeColor = isUp ? upColor : downColor;

  return (
    <div
      className={`flex flex-col font-sans w-full ${className}`}
      style={{
        fontFamily: "Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      {/* ─── 0. Stock Symbol & Exchange Selector (e.g. NSE:RELIANCE [NSE] [BSE]) ─── */}
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <h1 className="text-[13.5px] sm:text-[14px] font-semibold text-slate-500 dark:text-slate-400 tracking-tight m-0">
          {displaySymbol}
        </h1>
        {options.length > 1 && (
          <div className="inline-flex items-center rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800 ml-0.5">
            {options.map((opt) => {
              const active =
                opt.marketId.toUpperCase() === symbol.toUpperCase() ||
                opt.exchange.toUpperCase() === currentExchange.toUpperCase();
              return (
                <button
                  key={opt.marketId}
                  type="button"
                  onClick={() => onSelectMarketId?.(opt.marketId)}
                  className={`h-5 rounded-md px-2 text-[10.5px] font-semibold transition-all cursor-pointer ${
                    active
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                  }`}
                >
                  {opt.exchange}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ─── 1. Header: Price, Diff, Time & OHLC ─── */}
      <div className="mb-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            {shown ? (
              <div className="flex flex-wrap items-baseline gap-2.5">
                <span className="text-[28px] sm:text-[32px] font-semibold tabular-nums tracking-[-0.02em] text-slate-900 dark:text-white leading-none">
                  ₹{fmt(shown.close)}
                </span>
                <span
                  className="text-[14px] sm:text-[15px] font-semibold tabular-nums"
                  style={{ color: activeColor }}
                >
                  {isUp ? '+' : ''}₹{fmt(diff)} ({isUp ? '+' : ''}{pct.toFixed(2)}%)
                </span>
              </div>
            ) : (
              <div className="h-8 flex items-center">
                <span className="text-xl font-bold text-slate-400 tabular-nums">--</span>
              </div>
            )}

            <div className="text-[12px] text-slate-500 dark:text-slate-400 min-h-[18px] tabular-nums mt-0.5 font-normal">
              {hover
                ? fmtTime(hover.time, intraday)
                : dataRange === '1D'
                ? 'Latest session (09:15 - 15:30 IST)'
                : `Past ${dataRange}`}
            </div>
          </div>

          {/* OHLC Bar on Right Hand Side */}
          {!compact && (hover || mode === 'candle') && shown && (
            <div className="flex items-center gap-2.5 sm:gap-3 text-xs font-medium tabular-nums text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-900 px-3 py-1.5 rounded-xl border border-slate-200/80 dark:border-slate-800 self-center">
              <span>
                <span className="text-slate-400 mr-1 font-semibold">O</span>₹{fmt(shown.open)}
              </span>
              <span>
                <span className="text-slate-400 mr-1 font-semibold">H</span>
                <span style={{ color: upColor }}>₹{fmt(shown.high)}</span>
              </span>
              <span>
                <span className="text-slate-400 mr-1 font-semibold">L</span>
                <span style={{ color: downColor }}>₹{fmt(shown.low)}</span>
              </span>
              <span>
                <span className="text-slate-400 mr-1 font-semibold">C</span>₹{fmt(shown.close)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ─── 2. Controls Bar: Timeframes (Left) + Switch View (Right) ─── */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        {/* Timeframe pill buttons matching reference sample */}
        <div role="group" aria-label="Timeframe" className="flex items-center gap-1 overflow-x-auto py-0.5">
          {RANGE_KEYS.map((k) => {
            const active = k === range;
            return (
              <button
                key={k}
                type="button"
                aria-pressed={active}
                onPointerEnter={() => prefetch(symbol, k)}
                onFocus={() => prefetch(symbol, k)}
                onClick={() => setRange(k)}
                className={`px-3 py-1 rounded-full text-[12.5px] transition-all cursor-pointer whitespace-nowrap ${
                  active
                    ? 'bg-[#e8f0fe] text-[#1a56c4] dark:bg-[#263248] dark:text-[#8ab4f8] font-semibold'
                    : 'bg-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white font-normal'
                }`}
              >
                {k}
              </button>
            );
          })}
        </div>

        {/* Chart type switch: Line | Candles matching reference pill style */}
        <div role="group" aria-label="Chart type" className="flex items-center gap-1">
          <button
            type="button"
            aria-pressed={mode === 'line'}
            onClick={() => setMode('line')}
            className={`px-3 py-1 rounded-full text-[12.5px] transition-all cursor-pointer ${
              mode === 'line'
                ? 'bg-[#e8f0fe] text-[#1a56c4] dark:bg-[#263248] dark:text-[#8ab4f8] font-semibold'
                : 'bg-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white font-normal'
            }`}
          >
            Line
          </button>
          <button
            type="button"
            aria-pressed={mode === 'candle'}
            onClick={() => setMode('candle')}
            className={`px-3 py-1 rounded-full text-[12.5px] transition-all cursor-pointer ${
              mode === 'candle'
                ? 'bg-[#e8f0fe] text-[#1a56c4] dark:bg-[#263248] dark:text-[#8ab4f8] font-semibold'
                : 'bg-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white font-normal'
            }`}
          >
            Candles
          </button>
        </div>
      </div>

      {/* ─── 3. Canvas Container ─── */}
      <div className="relative w-full min-w-0">
        <PriceChart
          bars={bars}
          range={dataRange}
          mode={mode}
          symbol={symbol}
          tick={tick}
          height={height}
          dark={isDark}
          dim={slow}
          priceLines={priceLines}
          markers={markers}
          onHover={handleHover}
        />
      </div>

      {/* ─── 4. Inline Error fallback ─── */}
      {error && !loading && (
        <div role="status" className="mt-2 text-xs font-medium text-rose-600 dark:text-rose-400">
          Could not load data for {symbol} ({range}): {error}
        </div>
      )}
    </div>
  );
}
