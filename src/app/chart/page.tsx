"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  CandlestickSeries,
  LineSeries,
  type MouseEventParams,
  createChart,
  type CandlestickData,
  type IChartApi,
  type LineData,
  type UTCTimestamp,
} from "lightweight-charts";
import { ArrowLeft, CandlestickChart, ChartLine, Clock3, RefreshCcw, Search, TrendingUp } from "lucide-react";

type Candle = {
  time: number;
  timeLabel: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type Quote = {
  ltp: number;
  change: number;
  pChange: number;
  dayHigh?: number;
  dayLow?: number;
  volume?: number;
};

type CandleHover = {
  timeLabel: string;
  open: number;
  high: number;
  low: number;
  close: number;
};

type TvChartResponse = {
  symbol: string;
  marketId: string;
  exchange: string;
  companyName: string;
  timeframe: string;
  quote: Quote;
  candles: Candle[];
  technicals: {
    sma20: number | null;
    sma50: number | null;
    rsi14: number | null;
  };
  fundamentals: {
    marketCap: number | null;
    peRatio: number | null;
    pbRatio: number | null;
    roe: number | null;
    eps: number | null;
    dividendYield: number | null;
    bookValue: number | null;
    faceValue: number | null;
    debtToEquity: number | null;
  };
  financials: {
    revenueTtm: number | null;
    netProfitTtm: number | null;
    operatingProfitTtm: number | null;
    totalAssets: number | null;
    totalLiabilities: number | null;
  };
  source: string;
  updatedAt: string;
};

type ChartMode = "candles" | "line";

type ExchangeOption = {
  exchange: string;
  marketId: string;
};

type SearchMatch = {
  marketId: string;
  exchange: string;
  symbol: string;
  companyName: string;
};

const exchangePriority: Record<string, number> = {
  NSE: 0,
  BSE: 1,
};

const dedupeSuggestions = (items: SearchMatch[]) => {
  const deduped = new Map<string, SearchMatch>();

  for (const item of items) {
    const key = item.symbol.toUpperCase();
    const existing = deduped.get(key);

    if (!existing) {
      deduped.set(key, item);
      continue;
    }

    const existingRank = exchangePriority[existing.exchange] ?? 99;
    const incomingRank = exchangePriority[item.exchange] ?? 99;

    if (incomingRank < existingRank) {
      deduped.set(key, item);
    }
  }

  return Array.from(deduped.values());
};

const timeframeOptions = [
  { value: "1", label: "1m" },
  { value: "5", label: "5m" },
  { value: "15", label: "15m" },
  { value: "60", label: "1H" },
  { value: "240", label: "4H" },
  { value: "D", label: "1D" },
  { value: "W", label: "1W" },
];

const formatNumber = (value: number | undefined | null) => {
  if (typeof value !== "number") return "--";
  return value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
};

const formatCompact = (value: number | undefined | null) => {
  if (typeof value !== "number") return "--";
  return new Intl.NumberFormat("en-IN", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
};

export default function AdvancedChartPage() {
  const searchParams = useSearchParams();
  const initialSymbol = searchParams.get("symbol") ?? "RELIANCE";
  const initialMarketId = searchParams.get("marketId") ?? "NSE:RELIANCE";

  const [symbolInput, setSymbolInput] = useState("");
  const [suggestions, setSuggestions] = useState<SearchMatch[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [symbol, setSymbol] = useState(initialSymbol.toUpperCase());
  const [marketId, setMarketId] = useState(initialMarketId.toUpperCase());
  const [timeframe, setTimeframe] = useState("D");
  const [chartMode, setChartMode] = useState<ChartMode>("candles");
  const [refreshTick, setRefreshTick] = useState(0);
  const [chartData, setChartData] = useState<TvChartResponse | null>(null);
  const [exchangeOptions, setExchangeOptions] = useState<ExchangeOption[]>([]);
  const [hoveredCandle, setHoveredCandle] = useState<CandleHover | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadExchangeOptions = async () => {
      try {
        const response = await fetch(`/api/tv-search?q=${encodeURIComponent(symbol)}`, { cache: "no-store" });
        const json = await response.json();

        if (cancelled || !response.ok || !json.ok) {
          return;
        }

        const rows = Array.isArray(json.data) ? (json.data as Array<{ exchange?: string; symbol?: string; marketId?: string }>) : [];

        const exactRows = rows.filter(
          (item) => item.symbol?.toUpperCase() === symbol.toUpperCase() && !!item.exchange && !!item.marketId
        );

        const byExchange = new Map<string, ExchangeOption>();
        for (const row of exactRows) {
          const exchange = row.exchange!.toUpperCase();
          if (!byExchange.has(exchange)) {
            byExchange.set(exchange, { exchange, marketId: row.marketId!.toUpperCase() });
          }
        }

        const preferredOrder = ["NSE", "BSE"];
        const sorted = Array.from(byExchange.values()).sort((a, b) => {
          const aRank = preferredOrder.indexOf(a.exchange);
          const bRank = preferredOrder.indexOf(b.exchange);
          return (aRank === -1 ? 99 : aRank) - (bRank === -1 ? 99 : bRank);
        });

        if (!cancelled) {
          setExchangeOptions(sorted);
        }
      } catch {
        if (!cancelled) {
          setExchangeOptions([]);
        }
      }
    };

    loadExchangeOptions();

    return () => {
      cancelled = true;
    };
  }, [symbol]);

  useEffect(() => {
    let cancelled = false;

    if (symbolInput.trim().length < 2) {
      setSuggestions([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/tv-search?q=${encodeURIComponent(symbolInput.trim())}`, {
          cache: "no-store",
        });
        const json = await response.json();

        if (cancelled) return;

        if (response.ok && json.ok) {
          const rows = Array.isArray(json.data) ? (json.data as SearchMatch[]) : [];
          setSuggestions(dedupeSuggestions(rows));
        } else {
          setSuggestions([]);
        }
      } catch {
        if (!cancelled) {
          setSuggestions([]);
        }
      }
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [symbolInput]);

  useEffect(() => {
    let cancelled = false;

    const fetchChart = async () => {
      setLoading(true);
      try {
        const response = await fetch(
          `/api/tv-chart?marketId=${encodeURIComponent(marketId)}&symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}&range=180`,
          { cache: "no-store" }
        );
        const json = await response.json();

        if (cancelled) return;

        if (!response.ok || !json.ok) {
          setError(json.error ?? "Unable to load chart data");
          setLoading(false);
          return;
        }

        setChartData(json.data as TvChartResponse);
        setError("");
      } catch {
        if (!cancelled) {
          setError("Unable to connect to chart service");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchChart();

    return () => {
      cancelled = true;
    };
  }, [marketId, symbol, timeframe, refreshTick]);

  useEffect(() => {
    let cancelled = false;

    const fetchQuote = async () => {
      try {
        const response = await fetch(
          `/api/tv-quote?marketId=${encodeURIComponent(marketId)}&symbol=${encodeURIComponent(symbol)}`,
          { cache: "no-store" }
        );
        const json = await response.json();

        if (cancelled || !response.ok || !json.ok) {
          return;
        }

        setChartData((prev) => {
          if (!prev) {
            return prev;
          }

          return {
            ...prev,
            exchange: json.data.exchange ?? prev.exchange,
            marketId: json.data.marketId ?? prev.marketId,
            quote: json.data.quote ?? prev.quote,
            updatedAt: json.data.updatedAt ?? prev.updatedAt,
          };
        });
      } catch {
        // Keep existing values if quote polling fails.
      }
    };

    fetchQuote();
    const timer = setInterval(fetchQuote, 3000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [marketId, symbol]);

  const candleSeries = chartData?.candles;

  useEffect(() => {
    if (!containerRef.current || !candleSeries?.length) {
      return;
    }

    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { color: "#ffffff" },
        textColor: "#475569",
      },
      grid: {
        vertLines: { color: "#e2e8f0" },
        horzLines: { color: "#e2e8f0" },
      },
      rightPriceScale: {
        borderColor: "#cbd5e1",
      },
      timeScale: {
        borderColor: "#cbd5e1",
      },
      crosshair: {
        mode: 1,
      },
    });

    if (chartMode === "candles") {
      const series = chart.addSeries(CandlestickSeries, {
        upColor: "#10b981",
        downColor: "#ef4444",
        wickUpColor: "#10b981",
        wickDownColor: "#ef4444",
        borderVisible: false,
      });

      const candlePoints: CandlestickData[] = candleSeries.map((candle) => ({
        time: candle.time as UTCTimestamp,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      }));

      series.setData(candlePoints);

      const handleCrosshairMove = (param: MouseEventParams) => {
        const seriesData = param.seriesData.get(series) as
          | { open?: number; high?: number; low?: number; close?: number }
          | undefined;

        if (
          !seriesData
          || typeof seriesData.open !== "number"
          || typeof seriesData.high !== "number"
          || typeof seriesData.low !== "number"
          || typeof seriesData.close !== "number"
        ) {
          const latest = candleSeries[candleSeries.length - 1];
          if (!latest) return;
          setHoveredCandle({
            timeLabel: latest.timeLabel,
            open: latest.open,
            high: latest.high,
            low: latest.low,
            close: latest.close,
          });
          return;
        }

        let timeLabel = "Latest";
        if (typeof param.time === "number") {
          const match = candleSeries.find((candle) => candle.time === param.time);
          if (match) {
            timeLabel = match.timeLabel;
          }
        }

        setHoveredCandle({
          timeLabel,
          open: seriesData.open,
          high: seriesData.high,
          low: seriesData.low,
          close: seriesData.close,
        });
      };

      chart.subscribeCrosshairMove(handleCrosshairMove);
      void series;

      const latest = candleSeries[candleSeries.length - 1];
      if (latest) {
        setHoveredCandle({
          timeLabel: latest.timeLabel,
          open: latest.open,
          high: latest.high,
          low: latest.low,
          close: latest.close,
        });
      }

      chart.timeScale().fitContent();
      chartRef.current = chart;

      return () => {
        chart.unsubscribeCrosshairMove(handleCrosshairMove);
        chart.remove();
        chartRef.current = null;
      };
    } else {
      const series = chart.addSeries(LineSeries, {
        color: "#0ea5e9",
        lineWidth: 2,
      });

      const linePoints: LineData[] = candleSeries.map((candle) => ({
        time: candle.time as UTCTimestamp,
        value: candle.close,
      }));

      series.setData(linePoints);
      void series;

      const latest = candleSeries[candleSeries.length - 1];
      if (latest) {
        setHoveredCandle({
          timeLabel: latest.timeLabel,
          open: latest.open,
          high: latest.high,
          low: latest.low,
          close: latest.close,
        });
      }

      chart.timeScale().fitContent();
      chartRef.current = chart;

      return () => {
        chart.remove();
        chartRef.current = null;
      };
    }
  }, [candleSeries, chartMode]);

  const isUp = (chartData?.quote?.pChange ?? 0) >= 0;

  const technicalRows = useMemo(() => {
    return [
      { label: "SMA 20", value: formatNumber(chartData?.technicals?.sma20) },
      { label: "SMA 50", value: formatNumber(chartData?.technicals?.sma50) },
      { label: "RSI 14", value: formatNumber(chartData?.technicals?.rsi14) },
    ];
  }, [chartData]);

  const fundamentalRows = useMemo(() => {
    return [
      { label: "Market Cap", value: formatCompact(chartData?.fundamentals?.marketCap) },
      { label: "P/E Ratio", value: formatNumber(chartData?.fundamentals?.peRatio) },
      { label: "P/B Ratio", value: formatNumber(chartData?.fundamentals?.pbRatio) },
      { label: "ROE %", value: formatNumber(chartData?.fundamentals?.roe) },
      { label: "EPS", value: formatNumber(chartData?.fundamentals?.eps) },
      { label: "Dividend Yield %", value: formatNumber(chartData?.fundamentals?.dividendYield) },
      { label: "Book Value", value: formatNumber(chartData?.fundamentals?.bookValue) },
      { label: "Face Value", value: formatNumber(chartData?.fundamentals?.faceValue) },
      { label: "Debt/Equity", value: formatNumber(chartData?.fundamentals?.debtToEquity) },
    ];
  }, [chartData]);

  const financialRows = useMemo(() => {
    return [
      { label: "Revenue (TTM)", value: formatCompact(chartData?.financials?.revenueTtm) },
      { label: "Net Profit (TTM)", value: formatCompact(chartData?.financials?.netProfitTtm) },
      { label: "Operating Profit", value: formatCompact(chartData?.financials?.operatingProfitTtm) },
      { label: "Total Assets", value: formatCompact(chartData?.financials?.totalAssets) },
      { label: "Total Liabilities", value: formatCompact(chartData?.financials?.totalLiabilities) },
    ];
  }, [chartData]);

  const hasFundamentalData = fundamentalRows.some((row) => row.value !== "--");
  const hasFinancialData = financialRows.some((row) => row.value !== "--");

  const applySymbol = async () => {
    const normalized = symbolInput.trim().toUpperCase();
    if (!normalized) return;

    setError("");
    setShowSuggestions(false);

    if (normalized.includes(":")) {
      const [exchange, parsedSymbol] = normalized.split(":");
      const cleanSymbol = parsedSymbol?.trim().toUpperCase();
      if (!cleanSymbol) return;
      setSymbol(cleanSymbol);
      setSymbolInput("");
      setSuggestions([]);
      setMarketId(`${exchange.toUpperCase()}:${cleanSymbol}`);
      return;
    }

    try {
      const response = await fetch(`/api/tv-search?q=${encodeURIComponent(normalized)}`, { cache: "no-store" });
      const json = await response.json();

      const rows = response.ok && json.ok && Array.isArray(json.data) ? (json.data as SearchMatch[]) : [];

      const exact = rows.find((item) => item.symbol.toUpperCase() === normalized);
      const byName = rows.find((item) => item.companyName.toUpperCase().includes(normalized));
      const selected = exact ?? byName ?? rows[0];

      if (selected) {
        const cleanSymbol = selected.symbol.toUpperCase();
        setSymbol(cleanSymbol);
        setSymbolInput("");
        setSuggestions([]);
        setMarketId(selected.marketId.toUpperCase());
        return;
      }

      const currentExchange = marketId.split(":")[0]?.toUpperCase() || "NSE";
      setSymbol(normalized);
      setSymbolInput("");
      setSuggestions([]);
      setMarketId(`${currentExchange}:${normalized}`);
    } catch {
      const currentExchange = marketId.split(":")[0]?.toUpperCase() || "NSE";
      setSymbol(normalized);
      setSymbolInput("");
      setSuggestions([]);
      setMarketId(`${currentExchange}:${normalized}`);
    }
  };

  const applySuggestion = (item: SearchMatch) => {
    const cleanSymbol = item.symbol.toUpperCase();
    setError("");
    setSymbol(cleanSymbol);
    setSymbolInput("");
    setSuggestions([]);
    setShowSuggestions(false);
    setMarketId(item.marketId.toUpperCase());
  };

  return (
    <div className="min-h-screen bg-[linear-gradient(to_bottom,#f8fafc,#eef2ff_45%,#f8fafc)] p-3 dark:bg-[linear-gradient(to_bottom,#020617,#0f172a_45%,#020617)] md:p-4">
      <div className="mx-auto max-w-7xl space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to Dashboard
            </Link>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300">
              <TrendingUp className="h-3.5 w-3.5" />
              Advanced Chart Terminal
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <div className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
                <Search className="h-4 w-4 text-slate-400" />
                <input
                  value={symbolInput}
                  onChange={(e) => {
                    const nextValue = e.target.value;
                    setSymbolInput(nextValue);
                    if (nextValue.trim().length < 2) {
                      setSuggestions([]);
                    }
                    setShowSuggestions(true);
                  }}
                  onFocus={() => setShowSuggestions(true)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void applySymbol();
                    }
                  }}
                  placeholder="Search stock symbol or name"
                  className="w-64 bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-200"
                />
              </div>
              {showSuggestions && suggestions.length > 0 && (
                <div className="absolute left-0 top-[calc(100%+4px)] z-30 w-full rounded-lg border border-slate-300 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
                  {suggestions.map((item) => (
                    <button
                      key={item.marketId}
                      type="button"
                      onClick={() => applySuggestion(item)}
                      className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      <div>
                        <div className="text-sm font-medium text-slate-800 dark:text-slate-200">{item.symbol}</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">{item.companyName}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={() => {
                void applySymbol();
              }}
              className="h-9 rounded-lg bg-blue-600 px-3.5 text-xs font-semibold text-white hover:bg-blue-700"
            >
              Load Symbol
            </button>
            <button
              onClick={() => setRefreshTick((prev) => prev + 1)}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <RefreshCcw className="h-3.5 w-3.5" />
              Refresh
            </button>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 py-1 text-[11px] text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
              <Clock3 className="h-3.5 w-3.5" />
              {chartData ? `Updated ${new Date(chartData.updatedAt).toLocaleTimeString()}` : "Waiting for feed"}
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-950 md:p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100 md:text-xl">{chartData?.companyName ?? symbol}</h1>
              {exchangeOptions.length > 1 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {exchangeOptions.map((option) => {
                    const active = marketId.toUpperCase() === option.marketId.toUpperCase();

                    return (
                      <button
                        key={option.marketId}
                        onClick={() => setMarketId(option.marketId)}
                        className={`h-8 rounded-md px-3 text-xs font-semibold transition-colors ${
                          active
                            ? "bg-blue-600 text-white"
                            : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                        }`}
                      >
                        {option.exchange}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            <div className="lg:col-span-9">
              <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-2 dark:border-slate-800 dark:bg-slate-950">
                <div className="relative h-[430px] min-w-0">
                  {hoveredCandle && (
                    <div className="pointer-events-none absolute left-2 top-2 z-10 flex flex-wrap items-center gap-3 rounded-md border border-slate-200 bg-white/90 px-2 py-1.5 text-xs backdrop-blur-sm dark:border-slate-700 dark:bg-slate-900/90">
                      <span className="font-medium text-slate-600 dark:text-slate-300">{hoveredCandle.timeLabel}</span>
                      <span className="text-slate-500 dark:text-slate-400">O <span className="font-semibold text-slate-700 dark:text-slate-200">{formatNumber(hoveredCandle.open)}</span></span>
                      <span className="text-slate-500 dark:text-slate-400">H <span className="font-semibold text-emerald-600">{formatNumber(hoveredCandle.high)}</span></span>
                      <span className="text-slate-500 dark:text-slate-400">L <span className="font-semibold text-rose-600">{formatNumber(hoveredCandle.low)}</span></span>
                      <span className="text-slate-500 dark:text-slate-400">C <span className="font-semibold text-slate-700 dark:text-slate-200">{formatNumber(hoveredCandle.close)}</span></span>
                    </div>
                  )}
                  <div ref={containerRef} className="h-full w-full min-w-0" />
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-1 pt-2 dark:border-slate-800">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {timeframeOptions.map((option) => (
                      <button
                        key={option.value}
                        onClick={() => setTimeframe(option.value)}
                        className={`h-8 rounded-md px-2.5 text-xs font-semibold transition-colors ${
                          timeframe === option.value
                            ? "bg-blue-600 text-white"
                            : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setChartMode("line")}
                      className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold ${
                        chartMode === "line"
                          ? "bg-sky-600 text-white"
                          : "border border-slate-300 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                      }`}
                    >
                      <ChartLine className="h-3.5 w-3.5" />
                      Line
                    </button>
                    <button
                      onClick={() => setChartMode("candles")}
                      className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold ${
                        chartMode === "candles"
                          ? "bg-sky-600 text-white"
                          : "border border-slate-300 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                      }`}
                    >
                      <CandlestickChart className="h-3.5 w-3.5" />
                      Candles
                    </button>
                  </div>
                </div>
                <div className="mt-1 px-1 text-[11px] text-slate-500 dark:text-slate-400">Use 1D for day trend and 1W for weekly trend</div>
              </div>
              {loading && <p className="mt-2 text-xs text-slate-500">Loading TradingView chart...</p>}
              {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}
            </div>
            <aside className="space-y-3 lg:col-span-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Technical Snapshot</h3>
                <div className="space-y-1.5">
                  {technicalRows.map((item) => (
                    <div key={item.label} className="flex items-center justify-between text-xs">
                      <span className="text-slate-500 dark:text-slate-400">{item.label}</span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200">{item.value}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Market Micro Data</h3>
                <div className="space-y-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 dark:text-slate-400">Exchange</span>
                    <span className="font-medium text-slate-800 dark:text-slate-200">{chartData?.exchange ?? "--"}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 dark:text-slate-400">Volume</span>
                    <span className="font-medium text-slate-800 dark:text-slate-200">{formatNumber(chartData?.quote?.volume)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 dark:text-slate-400">Candles Loaded</span>
                    <span className="font-medium text-slate-800 dark:text-slate-200">{chartData?.candles?.length ?? 0}</span>
                  </div>
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Fundamentals</h3>
                {hasFundamentalData ? (
                  <div className="space-y-1.5 text-xs">
                    {fundamentalRows.map((item) => (
                      <div key={item.label} className="flex items-center justify-between">
                        <span className="text-slate-500 dark:text-slate-400">{item.label}</span>
                        <span className="font-medium text-slate-800 dark:text-slate-200">{item.value}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 dark:text-slate-400">Fundamental data is not available for this instrument from current market feed.</p>
                )}
              </div>
            </aside>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
              <div className="text-[11px] text-slate-500">Last Price</div>
              <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">{formatNumber(chartData?.quote?.ltp)}</div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
              <div className="text-[11px] text-slate-500">Day Change</div>
              <div className={`text-lg font-semibold ${isUp ? "text-emerald-600" : "text-rose-600"}`}>{formatNumber(chartData?.quote?.change)}</div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
              <div className="text-[11px] text-slate-500">Day %</div>
              <div className={`text-lg font-semibold ${isUp ? "text-emerald-600" : "text-rose-600"}`}>{formatNumber(chartData?.quote?.pChange)}%</div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
              <div className="text-[11px] text-slate-500">Day High</div>
              <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">{formatNumber(chartData?.quote?.dayHigh)}</div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
              <div className="text-[11px] text-slate-500">Day Low</div>
              <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">{formatNumber(chartData?.quote?.dayLow)}</div>
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Financials</h3>
            {hasFinancialData ? (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
                {financialRows.map((item) => (
                  <div key={item.label} className="rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950">
                    <div className="text-[11px] text-slate-500">{item.label}</div>
                    <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">{item.value}</div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500 dark:text-slate-400">Financial metrics are not available for this instrument from current market feed.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
