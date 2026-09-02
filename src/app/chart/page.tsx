"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
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
  xPosition: number | null;
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
  patternIntelligence: {
    patterns: Array<{
      id: string;
      name: string;
      category: "breakout" | "reversal" | "support-resistance" | "divergence";
      direction: "bullish" | "bearish" | "neutral";
      detectedAt: number;
      detectedAtLabel: string;
      confidence: number;
      entry: number;
      target: number | null;
      stop: number | null;
      description: string;
      successRate: number | null;
      sampleSize: number;
      avgMovePct: number | null;
    }>;
    supportLevels: number[];
    resistanceLevels: number[];
    trendBias: "bullish" | "bearish" | "sideways";
    note: string;
  };
  source: string;
  updatedAt: string;
};

type CompanyProfile = {
  companyName: string;
  summary: string | null;
  founded: string | null;
  founder: string | null;
  ceoMd: string | null;
  headquarters: string | null;
  industry: string | null;
  website: string | null;
  wikipediaUrl: string | null;
  source: string;
  updatedAt: string;
};

type StockDocArtifact = {
  name: string;
  key: string;
  url: string | null;
  size: number;
  lastModified: string | null;
};

type StockDocData = {
  symbol: string;
  available: boolean;
  source: string;
  pipelineRunAt: string | null;
  summaryText: string | null;
  industry: string | null;
  sector: string | null;
  website: string | null;
  headquarters: string | null;
  employees: string | null;
  strengths: string[];
  concerns: string[];
  annualReportLinks: Array<{ year?: string; label?: string; url?: string }>;
  metrics: {
    currentPrice: number | null;
    marketCapCr: number | null;
    peRatio: number | null;
    pbRatio: number | null;
    roePct: number | null;
    revenueGrowthPct: number | null;
    debtToEquity: number | null;
  };
  counts: {
    announcements: number;
    corporateActions: number;
    insiderTrades: number;
    quarterlyRows: number;
    shareholdingRows: number;
    historicalPriceRows: number;
  };
  artifacts: StockDocArtifact[];
  raw: Record<string, unknown> | null;
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

const chartDataCache = new Map<string, TvChartResponse>();

const stockRangeOptions = [
  { value: "1D", label: "1D", timeframe: "5", days: 1 },
  { value: "1W", label: "1W", timeframe: "30", days: 7 },
  { value: "1M", label: "1M", timeframe: "D", days: 30 },
  { value: "3M", label: "3M", timeframe: "D", days: 90 },
  { value: "6M", label: "6M", timeframe: "D", days: 180 },
  { value: "1Y", label: "1Y", timeframe: "D", days: 365 },
  { value: "3Y", label: "3Y", timeframe: "W", days: 1095 },
  { value: "5Y", label: "5Y", timeframe: "W", days: 1825 },
];

const candleTimeframeOptions = [
  { value: "AUTO", label: "Auto" },
  { value: "1", label: "1m" },
  { value: "3", label: "3m" },
  { value: "5", label: "5m" },
  { value: "15", label: "15m" },
  { value: "30", label: "30m" },
  { value: "60", label: "1H" },
  { value: "120", label: "2H" },
  { value: "240", label: "4H" },
  { value: "D", label: "1D" },
  { value: "W", label: "1W" },
  { value: "M", label: "1M" },
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

const formatHoverTimeLabel = (unix: number, timeframe: string) => {
  const start = new Date(unix * 1000);
  const dateTimeZone = "Asia/Kolkata";

  const intradayMinutes = Number(timeframe);
  if (Number.isFinite(intradayMinutes) && intradayMinutes > 0) {
    const end = new Date(start.getTime() + intradayMinutes * 60 * 1000);
    const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", timeZone: dateTimeZone });
    const timeFmt = new Intl.DateTimeFormat("en-IN", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: dateTimeZone,
    });
    return `${dateFmt.format(start)} ${timeFmt.format(start)} - ${timeFmt.format(end)}`;
  }

  if (timeframe === "W") {
    const end = new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000);
    const rangeFmt = new Intl.DateTimeFormat("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: dateTimeZone,
    });
    return `${rangeFmt.format(start)} - ${rangeFmt.format(end)}`;
  }

  if (timeframe === "M") {
    return new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: dateTimeZone }).format(start);
  }

  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: dateTimeZone,
  }).format(start);
};

const toIstDateKey = (unix: number) => {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(unix * 1000));
};

export function AdvancedChartContent() {
  const searchParams = useSearchParams();
  const initialSymbol = searchParams.get("symbol") ?? "RELIANCE";
  const initialMarketId = searchParams.get("marketId") ?? "NSE:RELIANCE";

  const [symbolInput, setSymbolInput] = useState("");
  const [suggestions, setSuggestions] = useState<SearchMatch[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [symbol, setSymbol] = useState(initialSymbol.toUpperCase());
  const [marketId, setMarketId] = useState(initialMarketId.toUpperCase());
  const [selectedRange, setSelectedRange] = useState("1M");
  const [chartMode, setChartMode] = useState<ChartMode>("line");
  const [selectedCandleTimeframe, setSelectedCandleTimeframe] = useState("AUTO");
  const activeInstrumentSymbol = useMemo(() => {
    const fromMarket = marketId.split(":")[1]?.trim().toUpperCase();
    return fromMarket || symbol;
  }, [marketId, symbol]);
  const activeRange = useMemo(
    () => stockRangeOptions.find((option) => option.value === selectedRange) ?? stockRangeOptions[2],
    [selectedRange]
  );
  const chartRequestTimeframe = chartMode === "candles" && selectedCandleTimeframe !== "AUTO"
    ? selectedCandleTimeframe
    : activeRange.timeframe;

  const [refreshTick, setRefreshTick] = useState(0);
  const [chartData, setChartData] = useState<TvChartResponse | null>(() => {
    const key = `${initialMarketId.toUpperCase()}|${initialSymbol.toUpperCase()}|D`;
    return chartDataCache.get(key) ?? null;
  });
  const [exchangeOptions, setExchangeOptions] = useState<ExchangeOption[]>([]);
  const [hoveredCandle, setHoveredCandle] = useState<CandleHover | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [companyProfile, setCompanyProfile] = useState<CompanyProfile | null>(null);
  const [companyProfileLoading, setCompanyProfileLoading] = useState(false);
  const [stockDocData, setStockDocData] = useState<StockDocData | null>(null);
  const [stockDocLoading, setStockDocLoading] = useState(false);
  const [stockDocError, setStockDocError] = useState("");

  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const userAdjustedZoomRef = useRef(false);
  const preservedLogicalRangeRef = useRef<{ from: number; to: number } | null>(null);
  const lastRenderContextRef = useRef("");
  const suppressVisibleRangeEventRef = useRef(false);
  const userZoomIntentUntilRef = useRef(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const markZoomIntent = () => {
      userZoomIntentUntilRef.current = Date.now() + 1500;
    };

    container.addEventListener("wheel", markZoomIntent, { passive: true });
    container.addEventListener("pointerdown", markZoomIntent, { passive: true });

    return () => {
      container.removeEventListener("wheel", markZoomIntent);
      container.removeEventListener("pointerdown", markZoomIntent);
    };
  }, []);

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
    const cacheKey = `${marketId}|${symbol}|${chartRequestTimeframe}`;
    const cached = chartDataCache.get(cacheKey);

    if (cached) {
      setChartData(cached);
      setError("");
      setLoading(false);
    } else {
      setLoading(true);
    }

    const fetchChart = async () => {
      try {
        const response = await fetch(
          `/api/tv-chart?marketId=${encodeURIComponent(marketId)}&symbol=${encodeURIComponent(symbol)}&timeframe=${chartRequestTimeframe}&range=10000`,
          { cache: "no-store" }
        );
        const json = await response.json();

        if (cancelled) return;

        if (!response.ok || !json.ok) {
          if (!cached) {
            setError(json.error ?? "Unable to load chart data");
          }
          return;
        }

        const data = json.data as TvChartResponse;
        chartDataCache.set(cacheKey, data);
        setChartData(data);
        setError("");

        // Preload other common timeframes in background for instant 0ms switching
        const preloadTimeframes = ["5", "30", "D", "W"].filter((tf) => tf !== chartRequestTimeframe);
        for (const tf of preloadTimeframes) {
          const preKey = `${marketId}|${symbol}|${tf}`;
          if (!chartDataCache.has(preKey)) {
            fetch(`/api/tv-chart?marketId=${encodeURIComponent(marketId)}&symbol=${encodeURIComponent(symbol)}&timeframe=${tf}&range=10000`, { cache: "no-store" })
              .then((r) => r.json())
              .then((j) => {
                if (j?.ok && j.data) {
                  chartDataCache.set(preKey, j.data as TvChartResponse);
                }
              })
              .catch(() => {});
          }
        }
      } catch {
        if (!cancelled && !cached) {
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
  }, [marketId, symbol, chartRequestTimeframe, refreshTick]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const fetchCompanyProfile = async () => {
      if (!activeInstrumentSymbol) {
        return;
      }

      setCompanyProfileLoading(true);

      try {
        const normalizedCompanyName =
          chartData?.companyName && !chartData.companyName.includes(":")
            ? chartData.companyName
            : activeInstrumentSymbol;

        const response = await fetch(
          `/api/company-profile?symbol=${encodeURIComponent(activeInstrumentSymbol)}&companyName=${encodeURIComponent(normalizedCompanyName)}`,
          { cache: "no-store", signal: controller.signal }
        );
        const json = await response.json();

        if (cancelled) {
          return;
        }

        if (response.ok && json.ok) {
          setCompanyProfile(json.data as CompanyProfile);
        } else {
          setCompanyProfile(null);
        }
      } catch {
        if (!cancelled) {
          setCompanyProfile(null);
        }
      } finally {
        if (!cancelled) {
          setCompanyProfileLoading(false);
        }
      }
    };

    setCompanyProfile(null);
    fetchCompanyProfile();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [activeInstrumentSymbol, chartData?.companyName]);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;

    const fetchQuote = async () => {
      if (inFlight) {
        return;
      }

      inFlight = true;

      try {
        const response = await fetch(
          `/api/tv-quote?marketId=${encodeURIComponent(marketId)}&symbol=${encodeURIComponent(symbol)}&_ts=${Date.now()}`,
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

          const liveQuote = json.data.quote ?? prev.quote;

          return {
            ...prev,
            exchange: json.data.exchange ?? prev.exchange,
            marketId: json.data.marketId ?? prev.marketId,
            quote: liveQuote,
            candles: prev.candles,
            updatedAt: json.data.updatedAt ?? prev.updatedAt,
          };
        });
      } catch {
        // Keep existing values if quote polling fails.
      } finally {
        inFlight = false;
      }
    };

    fetchQuote();
    const timer = setInterval(fetchQuote, 1500);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [marketId, symbol]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const fetchStockDocs = async () => {
      if (!activeInstrumentSymbol) {
        return;
      }

      setStockDocLoading(true);
      setStockDocError("");

      try {
        const response = await fetch(
          `/api/stock-docs?symbol=${encodeURIComponent(activeInstrumentSymbol)}&includeRaw=true`,
          { cache: "no-store", signal: controller.signal }
        );
        const json = await response.json();

        if (cancelled) {
          return;
        }

        if (response.ok && json.ok) {
          setStockDocData((json.data ?? null) as StockDocData | null);
          return;
        }

        setStockDocData(null);
        setStockDocError(json.error ?? "Unable to load doc pipeline data");
      } catch {
        if (!cancelled) {
          setStockDocData(null);
          setStockDocError("Unable to connect to stock docs service");
        }
      } finally {
        if (!cancelled) {
          setStockDocLoading(false);
        }
      }
    };

    setStockDocData(null);
    fetchStockDocs();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [activeInstrumentSymbol, refreshTick]);

  const candleSeries = useMemo(() => {
    if (!chartData?.candles?.length) {
      return [];
    }
    // Prevent timeframe mismatch (e.g. rendering daily candles when 1D 5m timeframe is requested)
    if (chartData.timeframe && chartData.timeframe !== chartRequestTimeframe) {
      return [];
    }

    return [...chartData.candles]
      .sort((a, b) => a.time - b.time)
      .filter((candle, index, arr) => index === 0 || candle.time !== arr[index - 1].time);
  }, [chartData?.candles, chartData?.timeframe, chartRequestTimeframe]);

  const displayTimeframe = chartData?.timeframe ?? activeRange.timeframe;
  const renderContextKey = `${marketId}|${symbol}|${chartMode}|${chartRequestTimeframe}|${selectedRange}`;

  useEffect(() => {
    if (!containerRef.current || !candleSeries.length) {
      return;
    }

    if (chartRef.current) {
      if (userAdjustedZoomRef.current) {
        const existingRange = chartRef.current.timeScale().getVisibleLogicalRange();
        if (existingRange) {
          preservedLogicalRangeRef.current = {
            from: existingRange.from,
            to: existingRange.to,
          };
        }
      }
      chartRef.current.remove();
      chartRef.current = null;
    }

    const isContextSwitch = lastRenderContextRef.current !== renderContextKey;
    if (isContextSwitch) {
      userAdjustedZoomRef.current = false;
      preservedLogicalRangeRef.current = null;
    }

    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { color: "#ffffff" },
        textColor: "#475569",
      },
      grid: {
        vertLines: { color: "transparent" },
        horzLines: { color: "transparent" },
      },
      rightPriceScale: {
        borderColor: "#cbd5e1",
      },
      timeScale: {
        borderColor: "#cbd5e1",
        visible: false,
      },
      crosshair: {
        mode: 1,
        vertLine: {
          labelVisible: false,
        },
      },
    });

    const handleVisibleRangeChange = () => {
      if (suppressVisibleRangeEventRef.current) {
        return;
      }
      if (Date.now() > userZoomIntentUntilRef.current) {
        return;
      }
      const range = chart.timeScale().getVisibleLogicalRange();
      if (!range) {
        return;
      }
      userAdjustedZoomRef.current = true;
      preservedLogicalRangeRef.current = {
        from: range.from,
        to: range.to,
      };
    };

    chart.timeScale().subscribeVisibleLogicalRangeChange(handleVisibleRangeChange);

    const applyDefaultVisibleWindow = () => {
      const totalBars = candleSeries.length;
      if (totalBars === 0) return;

      const latestBar = candleSeries[totalBars - 1];
      const latestTime = latestBar.time;

      // 1D range: show only latest trading day candles
      if (selectedRange === "1D") {
        const latestDayKey = toIstDateKey(latestTime);
        const fromIndex = candleSeries.findIndex((bar) => toIstDateKey(bar.time) === latestDayKey);
        if (fromIndex >= 0) {
          chart.timeScale().setVisibleLogicalRange({
            from: fromIndex,
            to: totalBars - 1,
          });
          return;
        }
      }

      // Exact time window for other ranges (1W=7d, 1M=30d, 3M=90d, 6M=180d, 1Y=365d, 3Y=1095d, 5Y=1825d)
      const rangeConfig = stockRangeOptions.find((o) => o.value === selectedRange) ?? stockRangeOptions[2];
      const targetStartTime = latestTime - rangeConfig.days * 86400;

      let fromIndex = candleSeries.findIndex((bar) => bar.time >= targetStartTime);
      if (fromIndex === -1) {
        fromIndex = 0;
      }
      fromIndex = Math.min(fromIndex, Math.max(0, totalBars - 5));

      chart.timeScale().setVisibleLogicalRange({
        from: fromIndex,
        to: totalBars - 1,
      });
    };

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
        const pointX = typeof param.point?.x === "number"
          ? Math.max(60, Math.min((containerRef.current?.clientWidth ?? 0) - 60, param.point.x))
          : null;

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
            timeLabel: formatHoverTimeLabel(latest.time, displayTimeframe),
            open: latest.open,
            high: latest.high,
            low: latest.low,
            close: latest.close,
            xPosition: null,
          });
          return;
        }

        let timeLabel = "Latest";
        if (typeof param.time === "number") {
          const match = candleSeries.find((candle) => candle.time === param.time);
          if (match) {
            timeLabel = formatHoverTimeLabel(match.time, displayTimeframe);
          }
        }

        setHoveredCandle({
          timeLabel,
          open: seriesData.open,
          high: seriesData.high,
          low: seriesData.low,
          close: seriesData.close,
          xPosition: pointX,
        });
      };

      chart.subscribeCrosshairMove(handleCrosshairMove);

      const latest = candleSeries[candleSeries.length - 1];
      if (latest) {
        setHoveredCandle({
          timeLabel: formatHoverTimeLabel(latest.time, displayTimeframe),
          open: latest.open,
          high: latest.high,
          low: latest.low,
          close: latest.close,
          xPosition: null,
        });
      }

      suppressVisibleRangeEventRef.current = true;
      if (!isContextSwitch && userAdjustedZoomRef.current && preservedLogicalRangeRef.current) {
        chart.timeScale().setVisibleLogicalRange(preservedLogicalRangeRef.current);
      } else {
        applyDefaultVisibleWindow();
      }
      suppressVisibleRangeEventRef.current = false;
      lastRenderContextRef.current = renderContextKey;
      chartRef.current = chart;

      return () => {
        chart.unsubscribeCrosshairMove(handleCrosshairMove);
        chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleVisibleRangeChange);
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

      const handleCrosshairMove = (param: MouseEventParams) => {
        const pointX = typeof param.point?.x === "number"
          ? Math.max(60, Math.min((containerRef.current?.clientWidth ?? 0) - 60, param.point.x))
          : null;

        const seriesData = param.seriesData.get(series) as number | { value?: number } | undefined;
        const lineValue = typeof seriesData === "number"
          ? seriesData
          : typeof seriesData?.value === "number"
            ? seriesData.value
            : undefined;

        const latest = candleSeries[candleSeries.length - 1];
        if (!latest) {
          return;
        }

        let matchedCandle: Candle | undefined;
        if (typeof param.time === "number") {
          matchedCandle = candleSeries.find((candle) => candle.time === param.time);
        }

        const displayCandle = matchedCandle ?? latest;

        if (typeof lineValue !== "number") {
          setHoveredCandle({
            timeLabel: formatHoverTimeLabel(latest.time, displayTimeframe),
            open: latest.open,
            high: latest.high,
            low: latest.low,
            close: latest.close,
            xPosition: null,
          });
          return;
        }

        setHoveredCandle({
          timeLabel: formatHoverTimeLabel(displayCandle.time, displayTimeframe),
          open: displayCandle.open,
          high: displayCandle.high,
          low: displayCandle.low,
          close: lineValue,
          xPosition: pointX,
        });
      };

      chart.subscribeCrosshairMove(handleCrosshairMove);

      const latest = candleSeries[candleSeries.length - 1];
      if (latest) {
        setHoveredCandle({
          timeLabel: formatHoverTimeLabel(latest.time, displayTimeframe),
          open: latest.open,
          high: latest.high,
          low: latest.low,
          close: latest.close,
          xPosition: null,
        });
      }

      suppressVisibleRangeEventRef.current = true;
      if (!isContextSwitch && userAdjustedZoomRef.current && preservedLogicalRangeRef.current) {
        chart.timeScale().setVisibleLogicalRange(preservedLogicalRangeRef.current);
      } else {
        applyDefaultVisibleWindow();
      }
      suppressVisibleRangeEventRef.current = false;
      lastRenderContextRef.current = renderContextKey;
      chartRef.current = chart;

      return () => {
        chart.unsubscribeCrosshairMove(handleCrosshairMove);
        chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleVisibleRangeChange);
        chart.remove();
        chartRef.current = null;
      };
    }
  }, [candleSeries, chartMode, displayTimeframe, renderContextKey, selectedRange]);

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
                  {loading && (!chartData || chartData.timeframe !== chartRequestTimeframe) && (
                    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-white/80 backdrop-blur-[1px] dark:bg-slate-950/80">
                      <div className="flex flex-col items-center gap-2">
                        <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent"></div>
                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Loading chart data...</span>
                      </div>
                    </div>
                  )}
                  {hoveredCandle && (
                    <div className="pointer-events-none absolute inset-x-0 top-2 z-10 text-xs">
                      {typeof hoveredCandle.xPosition === "number" && (
                        <div
                          className="absolute top-6 -translate-x-1/2 rounded bg-slate-900 px-2 py-1 font-medium text-white dark:bg-slate-100 dark:text-slate-900"
                          style={{ left: `${hoveredCandle.xPosition}px` }}
                        >
                          {hoveredCandle.timeLabel}
                        </div>
                      )}
                      <div className="ml-auto mr-28 flex w-fit items-center gap-1 text-slate-500 dark:text-slate-400">
                        <span className="font-medium">OHLC</span>
                        <span className="inline-flex w-[74px] items-center">
                          <span>O</span>
                          <span className="ml-1.5 font-semibold tabular-nums text-slate-700 dark:text-slate-200">{formatNumber(hoveredCandle.open)}</span>
                        </span>
                        <span className="inline-flex w-[74px] items-center">
                          <span>H</span>
                          <span className="ml-1.5 font-semibold tabular-nums text-emerald-600">{formatNumber(hoveredCandle.high)}</span>
                        </span>
                        <span className="inline-flex w-[74px] items-center">
                          <span>L</span>
                          <span className="ml-1.5 font-semibold tabular-nums text-rose-600">{formatNumber(hoveredCandle.low)}</span>
                        </span>
                        <span className="inline-flex w-[74px] items-center">
                          <span>C</span>
                          <span className="ml-1.5 font-semibold tabular-nums text-slate-700 dark:text-slate-200">{formatNumber(hoveredCandle.close)}</span>
                        </span>
                      </div>
                    </div>
                  )}
                  <div ref={containerRef} className="h-full w-full min-w-0" />
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-1 pt-2 dark:border-slate-800">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {stockRangeOptions.map((option) => (
                      <button
                        key={option.value}
                        onClick={() => {
                          userAdjustedZoomRef.current = false;
                          preservedLogicalRangeRef.current = null;
                          const targetTf = chartMode === "candles" && selectedCandleTimeframe !== "AUTO"
                            ? selectedCandleTimeframe
                            : option.timeframe;
                          const cacheKey = `${marketId}|${symbol}|${targetTf}`;
                          const cached = chartDataCache.get(cacheKey);
                          if (cached) {
                            setChartData(cached);
                            setLoading(false);
                          }
                          setSelectedRange(option.value);
                        }}
                        className={`h-8 rounded-md px-2.5 text-xs font-semibold transition-colors ${
                          selectedRange === option.value
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
                    {chartMode === "candles" && (
                      <select
                        value={selectedCandleTimeframe}
                        onChange={(e) => {
                          userAdjustedZoomRef.current = false;
                          preservedLogicalRangeRef.current = null;
                          setSelectedCandleTimeframe(e.target.value);
                        }}
                        className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs font-medium text-slate-700 outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                      >
                        {candleTimeframeOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>
                <div className="mt-1 px-1 text-[11px] text-slate-500 dark:text-slate-400">Stock range view: 1D, 1W, 1M and long-term trend windows</div>
              </div>
              {loading && <p className="mt-2 text-xs text-slate-500">Loading TradingView chart...</p>}
              {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}

              <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-800 dark:bg-slate-900">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Company Snapshot</h3>
                  {companyProfile?.wikipediaUrl && (
                    <a
                      href={companyProfile.wikipediaUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[10px] font-medium text-blue-600 hover:underline dark:text-blue-400"
                    >
                      Source
                    </a>
                  )}
                </div>

                {companyProfileLoading ? (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">Loading company profile...</p>
                ) : companyProfile ? (
                  <div className="space-y-2">
                    <p className="line-clamp-3 text-xs leading-5 text-slate-700 dark:text-slate-300">
                      {companyProfile.summary || stockDocData?.summaryText || "Company overview is currently unavailable from public profile sources."}
                    </p>

                    <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                      <div className="rounded-md border border-slate-200 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-950">
                        <div className="text-slate-500">Founded</div>
                        <div className="mt-0.5 font-semibold text-slate-900 dark:text-slate-100 truncate">{companyProfile.founded ?? "--"}</div>
                      </div>
                      <div className="rounded-md border border-slate-200 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-950">
                        <div className="text-slate-500">Founder</div>
                        <div className="mt-0.5 font-semibold text-slate-900 dark:text-slate-100 truncate">{companyProfile.founder ?? "--"}</div>
                      </div>
                      <div className="rounded-md border border-slate-200 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-950">
                        <div className="text-slate-500">CEO / MD</div>
                        <div className="mt-0.5 font-semibold text-slate-900 dark:text-slate-100 truncate">{companyProfile.ceoMd ?? "--"}</div>
                      </div>
                      <div className="rounded-md border border-slate-200 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-950">
                        <div className="text-slate-500">HQ</div>
                        <div className="mt-0.5 font-semibold text-slate-900 dark:text-slate-100 truncate">{companyProfile.headquarters || stockDocData?.headquarters || "--"}</div>
                      </div>
                      <div className="rounded-md border border-slate-200 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-950">
                        <div className="text-slate-500">Industry</div>
                        <div className="mt-0.5 font-semibold text-slate-900 dark:text-slate-100 truncate">{companyProfile.industry || stockDocData?.industry || "--"}</div>
                      </div>
                      <div className="rounded-md border border-slate-200 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-950">
                        <div className="text-slate-500">Website</div>
                        <div className="mt-0.5 font-semibold text-slate-900 dark:text-slate-100 truncate">
                          {(companyProfile.website || stockDocData?.website) ? (
                            <a href={companyProfile.website || stockDocData?.website!} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline dark:text-blue-400">
                              {companyProfile.website || stockDocData?.website}
                            </a>
                          ) : (
                            "--"
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">Company profile is unavailable for this symbol right now.</p>
                )}
              </div>

              <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-800 dark:bg-slate-900">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Doc Pipeline Data (S3)</h3>
                  {stockDocData?.pipelineRunAt && (
                    <span className="text-[10px] text-slate-500 dark:text-slate-400">
                      {new Date(stockDocData.pipelineRunAt).toLocaleString()}
                    </span>
                  )}
                </div>

                {stockDocLoading ? (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">Loading S3 stock data...</p>
                ) : stockDocError ? (
                  <p className="text-[11px] text-rose-600">{stockDocError}</p>
                ) : stockDocData?.available ? (
                  <div className="space-y-2">
                    <p className="line-clamp-3 text-xs leading-5 text-slate-700 dark:text-slate-300">
                      {stockDocData.summaryText ?? "No summary text found in uploaded doc pipeline payload."}
                    </p>

                    <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                      <div className="rounded-md border border-slate-200 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-950">
                        <div className="text-slate-500">Current Price</div>
                        <div className="mt-0.5 font-semibold text-slate-900 dark:text-slate-100">{formatNumber(stockDocData.metrics.currentPrice)}</div>
                      </div>
                      <div className="rounded-md border border-slate-200 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-950">
                        <div className="text-slate-500">Market Cap (Cr)</div>
                        <div className="mt-0.5 font-semibold text-slate-900 dark:text-slate-100">{formatNumber(stockDocData.metrics.marketCapCr)}</div>
                      </div>
                      <div className="rounded-md border border-slate-200 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-950">
                        <div className="text-slate-500">P/E</div>
                        <div className="mt-0.5 font-semibold text-slate-900 dark:text-slate-100">{formatNumber(stockDocData.metrics.peRatio)}</div>
                      </div>
                      <div className="rounded-md border border-slate-200 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-950">
                        <div className="text-slate-500">P/B</div>
                        <div className="mt-0.5 font-semibold text-slate-900 dark:text-slate-100">{formatNumber(stockDocData.metrics.pbRatio)}</div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                      <div className="rounded-md border border-slate-200 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-950">
                        <div className="text-slate-500">Announcements</div>
                        <div className="mt-0.5 font-semibold text-slate-900 dark:text-slate-100">{stockDocData.counts.announcements}</div>
                      </div>
                      <div className="rounded-md border border-slate-200 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-950">
                        <div className="text-slate-500">Corporate Actions</div>
                        <div className="mt-0.5 font-semibold text-slate-900 dark:text-slate-100">{stockDocData.counts.corporateActions}</div>
                      </div>
                      <div className="rounded-md border border-slate-200 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-950">
                        <div className="text-slate-500">Quarterly Rows</div>
                        <div className="mt-0.5 font-semibold text-slate-900 dark:text-slate-100">{stockDocData.counts.quarterlyRows}</div>
                      </div>
                      <div className="rounded-md border border-slate-200 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-950">
                        <div className="text-slate-500">Annual Report Links</div>
                        <div className="mt-0.5 font-semibold text-slate-900 dark:text-slate-100">{stockDocData.annualReportLinks.length}</div>
                      </div>
                    </div>

                    {(stockDocData.strengths.length > 0 || stockDocData.concerns.length > 0) && (
                      <div className="space-y-1 text-[11px]">
                        {stockDocData.strengths.slice(0, 2).map((item, idx) => (
                          <p key={`st-${idx}`} className="text-emerald-700 dark:text-emerald-300">+ {item}</p>
                        ))}
                        {stockDocData.concerns.slice(0, 2).map((item, idx) => (
                          <p key={`cn-${idx}`} className="text-rose-700 dark:text-rose-300">- {item}</p>
                        ))}
                      </div>
                    )}

                    {stockDocData.artifacts.length > 0 && (
                      <div>
                        <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Uploaded Files</h4>
                        <div className="max-h-28 overflow-auto rounded-md border border-slate-200 bg-white p-1.5 text-[11px] dark:border-slate-700 dark:bg-slate-950">
                          {stockDocData.artifacts.slice(0, 8).map((item) => (
                            <div key={item.key || item.name} className="flex items-center justify-between py-1 border-b border-slate-100 last:border-0 dark:border-slate-800">
                              {item.url ? (
                                <a 
                                  href={item.url} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="truncate pr-2 text-blue-600 hover:text-blue-700 hover:underline dark:text-blue-400 dark:hover:text-blue-300 font-medium"
                                  title={`Download ${item.name}`}
                                >
                                  {item.name}
                                </a>
                              ) : (
                                <span className="truncate pr-2 text-slate-700 dark:text-slate-300">{item.name}</span>
                              )}
                              <span className="shrink-0 text-[10px] text-slate-500 dark:text-slate-400 tabular-nums">{formatCompact(item.size)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {stockDocData.raw && (
                      <details className="rounded-md border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-950">
                        <summary className="cursor-pointer text-[11px] font-medium text-slate-700 dark:text-slate-300">Show Full JSON Payload</summary>
                        <pre className="mt-2 max-h-64 overflow-auto text-[10px] leading-4 text-slate-700 dark:text-slate-300">
                          {JSON.stringify(stockDocData.raw, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">No S3 doc pipeline payload exists for this symbol yet.</p>
                )}
              </div>
            </div>
            <aside className="space-y-3 lg:col-span-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Chart Pattern Intelligence</h3>
                <div className="mb-2 text-xs">
                  <span className="text-slate-500 dark:text-slate-400">Trend Bias</span>
                  <span
                    className={`ml-2 inline-flex rounded px-1.5 py-0.5 font-semibold ${
                      chartData?.patternIntelligence?.trendBias === "bullish"
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                        : chartData?.patternIntelligence?.trendBias === "bearish"
                          ? "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
                          : "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300"
                    }`}
                  >
                    {(chartData?.patternIntelligence?.trendBias ?? "sideways").toUpperCase()}
                  </span>
                </div>

                <div className="space-y-2">
                  {(chartData?.patternIntelligence?.patterns ?? []).length > 0 ? (
                    (chartData?.patternIntelligence?.patterns ?? []).map((pattern) => (
                      <div key={pattern.id} className="rounded-lg border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-950">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">{pattern.name}</p>
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                              pattern.direction === "bullish"
                                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                                : pattern.direction === "bearish"
                                  ? "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
                                  : "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300"
                            }`}
                          >
                            {pattern.direction.toUpperCase()}
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{pattern.description}</p>
                        <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-1 text-[11px]">
                          <span className="text-slate-500 dark:text-slate-400">Confidence</span>
                          <span className="font-medium text-slate-800 dark:text-slate-200">{formatNumber(pattern.confidence)}%</span>
                          <span className="text-slate-500 dark:text-slate-400">Hit Rate</span>
                          <span className="font-medium text-slate-800 dark:text-slate-200">
                            {pattern.successRate != null ? `${formatNumber(pattern.successRate)}% (${pattern.sampleSize})` : "--"}
                          </span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-slate-500 dark:text-slate-400">No active high-confidence pattern signal right now.</p>
                  )}
                </div>

                <div className="mt-2 space-y-1 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 dark:text-slate-400">Nearest Support</span>
                    <span className="font-medium text-slate-800 dark:text-slate-200">
                      {chartData?.patternIntelligence?.supportLevels?.length
                        ? formatNumber(chartData.patternIntelligence.supportLevels[0])
                        : "--"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 dark:text-slate-400">Nearest Resistance</span>
                    <span className="font-medium text-slate-800 dark:text-slate-200">
                      {chartData?.patternIntelligence?.resistanceLevels?.length
                        ? formatNumber(chartData.patternIntelligence.resistanceLevels[0])
                        : "--"}
                    </span>
                  </div>
                </div>
              </div>

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

export default function AdvancedChartPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950">
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent"></div>
            <p className="text-sm text-slate-500 dark:text-slate-400">Loading chart terminal...</p>
          </div>
        </div>
      }
    >
      <AdvancedChartContent />
    </Suspense>
  );
}
