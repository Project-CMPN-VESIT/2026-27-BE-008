'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { RANGES, RANGE_KEYS, RangeKey } from '@/lib/tv/config';
import { Bar } from '@/lib/chart/transform';
import { Holding, prefetchPortfolio, usePortfolio } from '@/lib/portfolio/usePortfolio';
import PriceChart, { Mode } from './PriceChart';
import { RefreshCw, AlertCircle } from 'lucide-react';

export interface PortfolioChartProps {
  holdings: Holding[]; // [{ symbol: 'NSE:TCS', qty: 10 }, ...]
  cash?: number; // optional cash balance
  metric?: 'total' | 'holdings';
  onMetricChange?: (m: 'total' | 'holdings') => void;
  exchange?: string; // 'NSE' (default)
  currency?: string; // '₹'
  defaultRange?: RangeKey;
  defaultMode?: Mode;
  height?: number;
  live?: boolean; // refresh every 30s
  dark?: boolean;
  title?: string;
  badgeExchange?: string;
  badgeLabel?: string;
}

const fmt = (v: number) =>
  v.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

function fmtTime(t: number, intraday: boolean) {
  const d = new Date(t * 1000);
  if (intraday) {
    return (
      d.toLocaleDateString('en-GB', {
        timeZone: 'UTC',
        day: 'numeric',
        month: 'short',
      }) +
      ', ' +
      d
        .toLocaleTimeString('en-US', {
          timeZone: 'UTC',
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
        })
        .toLowerCase()
    );
  }
  return d.toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export default function PortfolioChart({
  holdings,
  cash = 0,
  metric = 'holdings',
  onMetricChange,
  exchange = 'NSE',
  currency = '₹',
  defaultRange = '1D',
  defaultMode = 'line',
  height = 340,
  live = true,
  dark,
  title,
  badgeExchange,
  badgeLabel,
}: PortfolioChartProps) {
  const [range, setRange] = useState<RangeKey>(defaultRange);
  const [mode, setMode] = useState<Mode>(defaultMode);
  const [hover, setHover] = useState<Bar | null>(null);

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

  const activeCash = metric === 'total' ? cash : 0;
  const { bars, dataRange, loading, pending, failed, total, k, error, tick } = usePortfolio(
    holdings,
    range,
    live ? 30000 : 0,
    activeCash
  );

  const last = tick ?? bars[bars.length - 1];
  const first = useMemo(
    () => (bars.length ? (dataRange === '1D' ? bars[0].open : bars[0].close) : 0),
    [bars, dataRange]
  );

  const shown = hover ?? last;
  const diff = shown && first ? shown.close - first : 0;
  const pct = first ? (diff / first) * 100 : 0;
  const isUp = diff >= 0;

  const upColor = isDark ? '#81c995' : '#137333';
  const downColor = isDark ? '#f28b82' : '#c5221f';
  const activeColor = isUp ? upColor : downColor;
  const intraday = RANGES[dataRange]?.intraday ?? false;

  return (
    <div
      className="flex flex-col font-sans w-full"
      style={{
        fontFamily: "Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      {/* ─── 0. Portfolio Title Header ─── */}
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <h1 className="text-[14px] sm:text-[15px] font-bold text-slate-900 dark:text-white tracking-tight m-0">
          {title ?? badgeLabel ?? "Portfolio Valuation"}
        </h1>

        {badgeExchange && (
          <div className="inline-flex items-center rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800 ml-0.5">
            <span className="h-5 rounded-md px-2 text-[10.5px] font-semibold bg-blue-600 text-white shadow-xs inline-flex items-center">
              {badgeExchange}
            </span>
          </div>
        )}

        {badgeLabel && !title && (
          <div className="inline-flex items-center rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800 ml-0.5">
            <span className="h-5 rounded-md px-2 text-[10.5px] font-semibold text-slate-600 dark:text-slate-400 inline-flex items-center">
              {badgeLabel}
            </span>
          </div>
        )}

        {onMetricChange && cash > 0 && (
          <div className="inline-flex items-center rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800 ml-auto text-[11px] font-semibold">
            <button
              type="button"
              onClick={() => onMetricChange('holdings')}
              className={`h-5 px-2.5 rounded-md transition-all cursor-pointer ${
                metric === 'holdings'
                  ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-300 shadow-2xs font-bold'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              Holdings Value
            </button>
            <button
              type="button"
              onClick={() => onMetricChange('total')}
              className={`h-5 px-2.5 rounded-md transition-all cursor-pointer ${
                metric === 'total'
                  ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-300 shadow-2xs font-bold'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              Total Net (+Cash)
            </button>
          </div>
        )}
      </div>

      {/* ─── 1. Header: Price, Diff, Time (Strictly NO OHLC for portfolio) ─── */}
      <div className="mb-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            {shown ? (
              <div className="flex flex-wrap items-baseline gap-2.5">
                <span className="text-[28px] sm:text-[32px] font-semibold tabular-nums tracking-[-0.02em] text-slate-900 dark:text-white leading-none">
                  {currency}{fmt(shown.close)}
                </span>
                <span
                  className="text-[14px] sm:text-[15px] font-semibold tabular-nums"
                  style={{ color: activeColor }}
                >
                  {isUp ? '+' : ''}{currency}{fmt(diff)} ({isUp ? '+' : ''}{pct.toFixed(2)}%)
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
        </div>
      </div>

      {/* ─── 2. Controls Bar: Timeframes (Left) + Line / Candles (Right) Matching SymbolChart ─── */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        {/* Timeframe pill buttons matching reference SymbolChart */}
        <div role="group" aria-label="Timeframe" className="flex items-center gap-1 overflow-x-auto py-0.5">
          {RANGE_KEYS.map((k) => {
            const active = k === range;
            return (
              <button
                key={k}
                type="button"
                aria-pressed={active}
                onPointerEnter={() => prefetchPortfolio(holdings, k, activeCash)}
                onFocus={() => prefetchPortfolio(holdings, k, activeCash)}
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

        {/* Chart type switch: Line | Candles matching SymbolChart */}
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

      {/* ─── 3. Canvas Container (With NO TradingView logo) ─── */}
      <div className="relative w-full rounded-2xl overflow-hidden bg-transparent [&_#tv-attr-logo]:!hidden [&_a[href*='tradingview']]:!hidden">
        <PriceChart
          bars={bars}
          range={dataRange}
          mode={mode}
          symbol={`${exchange}:PORTFOLIO`}
          tick={tick}
          height={height}
          dark={isDark}
          dim={loading && pending > 0}
          onHover={setHover}
        />

        {loading && bars.length === 0 && (
          <div className="absolute inset-0 bg-white/60 dark:bg-slate-950/60 backdrop-blur-xs flex items-center justify-center rounded-xl z-10 transition-all">
            <div className="flex items-center gap-2 bg-white dark:bg-slate-900 px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm text-xs font-semibold text-slate-700 dark:text-slate-300">
              <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-500" />
              <span>Pricing portfolio ({holdings.length} stocks)...</span>
            </div>
          </div>
        )}
      </div>

      {/* ─── 4. Status Footnote ─── */}
      <div
        role="status"
        className="text-[11px] text-slate-500 dark:text-slate-400 min-h-[18px] mt-1.5 font-medium flex items-center flex-wrap gap-x-2"
      >
        {pending > 0 && (
          <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400">
            <RefreshCw className="w-3 h-3 animate-spin" />
            Pricing holdings… {total - pending}/{total} stocks ready
          </span>
        )}

        {failed.length > 0 && (
          <span className="text-amber-600 dark:text-amber-400 flex items-center gap-1">
            <AlertCircle className="w-3 h-3" />
            No live bars for {failed.slice(0, 3).join(', ')}
            {failed.length > 3 ? ` +${failed.length - 3}` : ''}: excluded from the curve
          </span>
        )}

        {pending === 0 && failed.length === 0 && mode === 'candle' && bars.length > 0 && (
          <span className="text-slate-400 dark:text-slate-500">
            Open and close are exact. High and low are estimated from each holding’s wicks (diversification factor {k}).
          </span>
        )}

        {error && <span className="text-rose-600 dark:text-rose-400 font-semibold">{error}</span>}
      </div>
    </div>
  );
}
