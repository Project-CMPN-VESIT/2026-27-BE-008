"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { IChartApi, UTCTimestamp } from "lightweight-charts";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart2,
  BookOpen,
  Brain,
  Briefcase,
  CandlestickChart,
  History,
  Layers,
  LineChart,
  RefreshCw,
  Search,
  Sparkles,
  TrendingUp,
  Wallet,
  Zap,
} from "lucide-react";
import TradingModal from "@/components/TradingModal";
import MentorMarkdown from "@/components/MentorMarkdown";
import Link from "next/link";

type SearchSuggestion = {
  marketId: string;
  exchange: string;
  symbol: string;
  companyName: string;
};

type Position = {
  id: number;
  ticker: string;
  quantity: number;
  average_buy_price: number;
  updated_at: string;
};

type JournalEntry = {
  id: number;
  ticker: string;
  action: string;
  execution_price: number;
  quantity: number;
  user_thesis: string;
  ai_feedback: string;
  timestamp: string;
};

type PortfolioData = {
  balance: number;
  positions: Position[];
  journal: JournalEntry[];
};

type PositionView = {
  id: number;
  ticker: string;
  quantity: number;
  averageBuy: number;
  ltp: number;
  invested: number;
  marketValue: number;
  unrealizedPnl: number;
  returnPct: number;
  updated_at: string;
};

type PortfolioMetrics = {
  totalValue: number;
  cash: number;
  holdingsValue: number;
  investedValue: number;
  unrealizedPnl: number;
  unrealizedReturnPct: number;
  realizedPnl: number;
  realizedReturnPct: number;
  totalPnl: number;
  totalReturnPct: number;
  totalBuyValue: number;
  totalSellValue: number;
  deployedPct: number;
  tradeCount: number;
  winRate: number;
};

const INITIAL_CAPITAL = 1_000_000;
const PORTFOLIO_POLL_MS = 6_000;

const currency = (value: number) =>
  value.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const percent = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;

const clampPositiveInteger = (value: number, min = 1) => {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.floor(value));
};

type ChartViewMode = "area" | "candles" | "bars";

export default function PaperTradingPage() {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const tickerInputWrapRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const chartResizeHandlerRef = useRef<(() => void) | null>(null);
  const [isDarkMode, setIsDarkMode] = useState(false);

  const [data, setData] = useState<PortfolioData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});
  const [activeTab, setActiveTab] = useState<"positions" | "journal" | "history">("positions");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [chartViewMode, setChartViewMode] = useState<ChartViewMode>("area");
  const [hoveredPoint, setHoveredPoint] = useState<{ time: string; value: number } | null>(null);

  // Real-time tick history cache
  const [liveHistoryTicks, setLiveHistoryTicks] = useState<Array<{ time: number; value: number; invested: number }>>([]);

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedStockForModal, setSelectedStockForModal] = useState<string>("RELIANCE");
  const [modalAction, setModalAction] = useState<"BUY" | "SELL">("BUY");
  const [modalQuantity, setModalQuantity] = useState<number>(10);
  const rangeDataCache = useRef<Record<string, any>>({});

  const [isClient, setIsClient] = useState(false);
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [chartRange, setChartRange] = useState("1D");
  const [chartMetric, setChartMetric] = useState<"total" | "holdings">("holdings");
  const [isChartLoading, setIsChartLoading] = useState(false);
  const [portfolioChartData, setPortfolioChartData] = useState<{
    areaSeriesData: Array<{ time: UTCTimestamp; value: number }>;
    candleSeriesData: Array<{ time: UTCTimestamp; open: number; high: number; low: number; close: number }>;
    barSeriesData: Array<{ time: UTCTimestamp; value: number; color: string }>;
    investedBaseline: number;
    capitalBaseline: number;
  }>({
    areaSeriesData: [],
    candleSeriesData: [],
    barSeriesData: [],
    investedBaseline: 0,
    capitalBaseline: INITIAL_CAPITAL,
  });

  const areaSeriesRef = useRef<any>(null);
  const candleSeriesRef = useRef<any>(null);
  const barSeriesRef = useRef<any>(null);

  const chartMetricRef = useRef(chartMetric);
  chartMetricRef.current = chartMetric;

  const chartRangeRef = useRef(chartRange);
  chartRangeRef.current = chartRange;

  const portfolioChartDataRef = useRef(portfolioChartData);
  portfolioChartDataRef.current = portfolioChartData;

  useEffect(() => {
    let isMounted = true;
    if (searchTerm.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/tv-search?q=${encodeURIComponent(searchTerm.trim())}`);
        const json = await response.json();
        if (!isMounted) return;
        if (response.ok && json.ok) {
          const items = json.data as SearchSuggestion[];
          const deduped = Array.from(new Map(items.map((i) => [i.symbol, i])).values());
          setSuggestions(deduped);
        }
      } catch {}
    }, 120);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [searchTerm]);

  useEffect(() => {
    if (!showSuggestions) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (!tickerInputWrapRef.current?.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showSuggestions]);

  useEffect(() => {
    const root = document.documentElement;
    const syncTheme = () => setIsDarkMode(root.classList.contains("dark"));
    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  const fetchLivePrices = useCallback(async (positions: Position[]) => {
    if (!positions.length) {
      setLivePrices({});
      return;
    }

    const settled = await Promise.allSettled(
      positions.map(async (position) => {
        const res = await fetch(`/api/live-quote?symbol=NSE_${position.ticker}`);
        const json = await res.json();
        const ltpVal = json?.ok && json?.data?.ltp ? Number(json.data.ltp) : undefined;
        return {
          ticker: position.ticker,
          ltp: ltpVal,
          source: json?.ok ? String(json?.data?.source || "") : "",
        };
      })
    );

    const currentTickers = new Set(positions.map((position) => position.ticker));
    const newPrices: Record<string, number> = {};
    for (const item of settled) {
      if (item.status !== "fulfilled") continue;
      if (item.value.source === "live" && typeof item.value.ltp === "number" && item.value.ltp > 0) {
        newPrices[item.value.ticker] = item.value.ltp;
      }
    }

    setLivePrices((prev) => {
      const sanitized: Record<string, number> = {};
      for (const ticker of currentTickers) {
        const existing = prev[ticker];
        if (typeof existing === "number" && existing > 0) {
          sanitized[ticker] = existing;
        }
      }
      return { ...sanitized, ...newPrices };
    });
  }, []);

  const loadPortfolio = useCallback(
    async (isBackground = false) => {
      if (isBackground) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }

      try {
        const res = await fetch("/api/paper-trading/portfolio?userId=test_user");
        const json = await res.json();
        if (json.ok) {
          setData(json.data);
          setLoadError(null);
          setLastSyncedAt(new Date().toISOString());
          fetchLivePrices(json.data.positions);
        } else {
          throw new Error(json.error || "Failed to fetch portfolio");
        }
      } catch (e) {
        console.error(e);
        setLoadError(e instanceof Error ? e.message : "Failed to fetch portfolio data");
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [fetchLivePrices]
  );

  useEffect(() => {
    setIsClient(true);
    loadPortfolio(false);
    const interval = setInterval(() => loadPortfolio(true), PORTFOLIO_POLL_MS);
    return () => clearInterval(interval);
  }, [loadPortfolio]);

  const journalAscending = useMemo(() => {
    if (!data?.journal) return [];
    return [...data.journal].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  }, [data?.journal]);

  const positionRows = useMemo<PositionView[]>(() => {
    if (!data) return [];

    return data.positions.map((position) => {
      const ltp = livePrices[position.ticker] ?? position.average_buy_price;
      const invested = position.quantity * position.average_buy_price;
      const marketValue = position.quantity * ltp;
      const unrealizedPnl = marketValue - invested;
      const returnPct = invested > 0 ? (unrealizedPnl / invested) * 100 : 0;

      return {
        id: position.id,
        ticker: position.ticker,
        quantity: position.quantity,
        averageBuy: position.average_buy_price,
        ltp,
        invested,
        marketValue,
        unrealizedPnl,
        returnPct,
        updated_at: position.updated_at,
      };
    });
  }, [data, livePrices]);

  const metrics = useMemo<PortfolioMetrics>(() => {
    if (!data) {
      return {
        totalValue: INITIAL_CAPITAL,
        cash: INITIAL_CAPITAL,
        holdingsValue: 0,
        investedValue: 0,
        unrealizedPnl: 0,
        unrealizedReturnPct: 0,
        realizedPnl: 0,
        realizedReturnPct: 0,
        totalPnl: 0,
        totalReturnPct: 0,
        totalBuyValue: 0,
        totalSellValue: 0,
        deployedPct: 0,
        tradeCount: 0,
        winRate: 0,
      };
    }

    const investedValue = positionRows.reduce((acc, row) => acc + row.invested, 0);
    const holdingsValue = positionRows.reduce((acc, row) => acc + row.marketValue, 0);
    const unrealizedPnl = holdingsValue - investedValue;
    const totalValue = data.balance + holdingsValue;

    let totalBuyValue = 0;
    let totalSellValue = 0;
    let realizedPnl = 0;
    let realizedCostBasis = 0;
    let closedTradeWins = 0;
    let closedTradeLosses = 0;

    const virtualBook = new Map<string, { qty: number; avg: number }>();

    for (const trade of journalAscending) {
      const action = String(trade.action || "").toUpperCase();
      const qty = clampPositiveInteger(Number(trade.quantity), 0);
      const price = Number(trade.execution_price) || 0;

      if (qty <= 0 || price <= 0) continue;

      const value = qty * price;
      const current = virtualBook.get(trade.ticker) ?? { qty: 0, avg: 0 };

      if (action === "BUY") {
        totalBuyValue += value;
        const newQty = current.qty + qty;
        const newAvg = newQty > 0 ? (current.qty * current.avg + value) / newQty : current.avg;
        virtualBook.set(trade.ticker, { qty: newQty, avg: newAvg });
        continue;
      }

      if (action === "SELL") {
        totalSellValue += value;
        const executableQty = Math.min(current.qty, qty);
        if (executableQty > 0) {
          realizedCostBasis += executableQty * current.avg;
          const pnl = (price - current.avg) * executableQty;
          realizedPnl += pnl;
          if (pnl >= 0) closedTradeWins += 1;
          else closedTradeLosses += 1;

          const remainingQty = current.qty - executableQty;
          virtualBook.set(trade.ticker, {
            qty: remainingQty,
            avg: remainingQty > 0 ? current.avg : 0,
          });
        }
      }
    }

    const totalPnl = totalValue - INITIAL_CAPITAL;
    const totalReturnPct = (totalPnl / INITIAL_CAPITAL) * 100;
    const unrealizedReturnPct = investedValue > 0 ? (unrealizedPnl / investedValue) * 100 : 0;
    const realizedReturnPct = realizedCostBasis > 0 ? (realizedPnl / realizedCostBasis) * 100 : 0;
    const deployedPct = ((INITIAL_CAPITAL - data.balance) / INITIAL_CAPITAL) * 100;

    const closedTrades = closedTradeWins + closedTradeLosses;
    const winRate = closedTrades > 0 ? (closedTradeWins / closedTrades) * 100 : 0;

    return {
      totalValue,
      cash: data.balance,
      holdingsValue,
      investedValue,
      unrealizedPnl,
      unrealizedReturnPct,
      realizedPnl,
      realizedReturnPct,
      totalPnl,
      totalReturnPct,
      totalBuyValue,
      totalSellValue,
      deployedPct,
      tradeCount: data.journal.length,
      winRate,
    };
  }, [data, positionRows, journalAscending]);

  // Record real-time tick streaming
  useEffect(() => {
    if (!data || metrics.holdingsValue === 0) return;
    const nowSec = Math.floor(Date.now() / 1000);
    setLiveHistoryTicks((prev) => {
      const last = prev[prev.length - 1];
      if (last && nowSec - last.time < 5) return prev; // throttle 5s
      const updated = [...prev, { time: nowSec, value: metrics.holdingsValue, invested: metrics.investedValue }];
      return updated.slice(-100);
    });
  }, [data, metrics.holdingsValue, metrics.investedValue]);

  // Fetch real portfolio chart data from TradingView-backed portfolio API
  const fetchPortfolioChart = useCallback(async (range: string, metric: "total" | "holdings", forceRefresh = false) => {
    const cacheKey = `${range}:${metric}`;
    if (!forceRefresh && rangeDataCache.current[cacheKey]) {
      setPortfolioChartData(rangeDataCache.current[cacheKey]);
      setIsChartLoading(false);
      return;
    }

    setIsChartLoading(true);

    try {
      const res = await fetch(`/api/paper-trading/portfolio-chart?userId=test_user&range=${range}&metric=${metric}`);
      const json = await res.json();
      if (json.ok && json.data) {
        const parsed = {
          areaSeriesData: (json.data.areaSeriesData || []).map((d: any) => ({ time: d.time as UTCTimestamp, value: d.value })),
          candleSeriesData: (json.data.candleSeriesData || []).map((d: any) => ({
            time: d.time as UTCTimestamp,
            open: d.open,
            high: d.high,
            low: d.low,
            close: d.close,
          })),
          barSeriesData: (json.data.barSeriesData || []).map((d: any) => ({
            time: d.time as UTCTimestamp,
            value: d.value,
            color: d.color,
          })),
          investedBaseline: json.data.investedBaseline ?? 0,
          capitalBaseline: json.data.capitalBaseline ?? INITIAL_CAPITAL,
        };
        rangeDataCache.current[cacheKey] = parsed;
        setPortfolioChartData(parsed);
      }
    } catch (err) {
      console.error("Failed to fetch portfolio chart:", err);
    } finally {
      setIsChartLoading(false);
    }
  }, []);

  const prevPositionsLenRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (prevPositionsLenRef.current !== undefined && prevPositionsLenRef.current !== data?.positions?.length) {
      rangeDataCache.current = {};
    }
    prevPositionsLenRef.current = data?.positions?.length;
    fetchPortfolioChart(chartRange, chartMetric);
  }, [fetchPortfolioChart, chartRange, chartMetric, data?.positions?.length]);

  // Pre-warm other chart ranges in background so timeframe clicks render in 0ms
  useEffect(() => {
    if (!data || data.positions.length === 0) return;
    const idleTimer = setTimeout(() => {
      const metric = chartMetricRef.current;
      ["1D", "1W", "1M", "3M", "1Y", "ALL"].forEach((r) => {
        const cacheKey = `${r}:${metric}`;
        if (rangeDataCache.current[cacheKey]) return;
        fetch(`/api/paper-trading/portfolio-chart?userId=test_user&range=${r}&metric=${metric}`)
          .then((res) => res.json())
          .then((json) => {
            if (json.ok && json.data) {
              rangeDataCache.current[cacheKey] = {
                areaSeriesData: (json.data.areaSeriesData || []).map((d: any) => ({ time: d.time as UTCTimestamp, value: d.value })),
                candleSeriesData: (json.data.candleSeriesData || []).map((d: any) => ({
                  time: d.time as UTCTimestamp,
                  open: d.open,
                  high: d.high,
                  low: d.low,
                  close: d.close,
                })),
                barSeriesData: (json.data.barSeriesData || []).map((d: any) => ({
                  time: d.time as UTCTimestamp,
                  value: d.value,
                  color: d.color,
                })),
                investedBaseline: json.data.investedBaseline ?? 0,
                capitalBaseline: json.data.capitalBaseline ?? INITIAL_CAPITAL,
              };
            }
          })
          .catch(() => {});
      });
    }, 200);

    return () => clearTimeout(idleTimer);
  }, [data]);

  // Live real-time tick injection directly to active chart series (safe update)
  useEffect(() => {
    if (!data || !areaSeriesRef.current) return;
    const currentChart = portfolioChartDataRef.current;
    if (currentChart.areaSeriesData.length === 0) return;

    const currentVal = chartMetric === "total" ? metrics.totalValue : metrics.holdingsValue;
    if (currentVal <= 0) return;

    const lastPoint = currentChart.areaSeriesData[currentChart.areaSeriesData.length - 1];
    const diffRatio = Math.abs(currentVal - lastPoint.value) / (lastPoint.value || 1);

    // If difference is large (>4%, e.g. after a trade or major portfolio shift), refresh entire chart rather than creating a single point vertical cliff
    if (diffRatio > 0.04) {
      rangeDataCache.current = {};
      fetchPortfolioChart(chartRangeRef.current, chartMetric);
      return;
    }

    areaSeriesRef.current.update({ time: lastPoint.time as UTCTimestamp, value: Math.round(currentVal * 100) / 100 });
    if (candleSeriesRef.current && currentChart.candleSeriesData.length > 0) {
      const last = currentChart.candleSeriesData[currentChart.candleSeriesData.length - 1];
      candleSeriesRef.current.update({
        time: last.time as UTCTimestamp,
        open: last.open,
        high: Math.max(last.high, currentVal),
        low: Math.min(last.low, currentVal),
        close: Math.round(currentVal * 100) / 100,
      });
    }
  }, [livePrices, metrics.totalValue, metrics.holdingsValue, chartMetric]);

  // Chart Rendering & Data Sync
  useEffect(() => {
    if (!chartContainerRef.current || !isClient || !data) return;

    let isCancelled = false;

    const syncOrRenderChart = async () => {
      const { createChart, AreaSeries, CandlestickSeries, HistogramSeries, ColorType } = await import("lightweight-charts");

      if (isCancelled || !chartContainerRef.current) return;

      const baseline = chartMetric === "total" ? portfolioChartData.capitalBaseline : portfolioChartData.investedBaseline;
      const currentVal = chartMetric === "total" ? metrics.totalValue : metrics.holdingsValue;
      const isProfit = currentVal >= baseline;

      // If chart already exists and view mode matches, simply update series data without disposing
      if (chartRef.current) {
        if (chartViewMode === "area" && areaSeriesRef.current) {
          areaSeriesRef.current.applyOptions({
            lineColor: isProfit ? "#10b981" : "#ef4444",
            topColor: isProfit ? "rgba(16, 185, 129, 0.28)" : "rgba(239, 68, 68, 0.28)",
            bottomColor: isProfit ? "rgba(16, 185, 129, 0.0)" : "rgba(239, 68, 68, 0.0)",
          });
          if (portfolioChartData.areaSeriesData.length > 0) {
            areaSeriesRef.current.setData(portfolioChartData.areaSeriesData);
          }
          chartRef.current.timeScale().fitContent();
          return;
        }
        if (chartViewMode === "candles" && candleSeriesRef.current) {
          if (portfolioChartData.candleSeriesData.length > 0) {
            candleSeriesRef.current.setData(portfolioChartData.candleSeriesData);
          }
          chartRef.current.timeScale().fitContent();
          return;
        }
        if (chartViewMode === "bars" && barSeriesRef.current) {
          if (portfolioChartData.barSeriesData.length > 0) {
            barSeriesRef.current.setData(portfolioChartData.barSeriesData);
          }
          chartRef.current.timeScale().fitContent();
          return;
        }

        // Mode changed: safely clean up existing chart
        try {
          chartRef.current.remove();
        } catch {}
        chartRef.current = null;
      }

      if (chartResizeHandlerRef.current) {
        window.removeEventListener("resize", chartResizeHandlerRef.current);
        chartResizeHandlerRef.current = null;
      }

      chartContainerRef.current.innerHTML = "";

      const chart = createChart(chartContainerRef.current, {
        layout: {
          background: { type: ColorType.Solid, color: "transparent" },
          textColor: isDarkMode ? "#94a3b8" : "#64748b",
          fontSize: 11,
          fontFamily: "var(--font-sans), -apple-system, sans-serif",
        },
        grid: {
          vertLines: { color: isDarkMode ? "rgba(30, 41, 59, 0.35)" : "rgba(226, 232, 240, 0.6)" },
          horzLines: { color: isDarkMode ? "rgba(30, 41, 59, 0.35)" : "rgba(226, 232, 240, 0.6)" },
        },
        rightPriceScale: {
          borderColor: isDarkMode ? "rgba(30, 41, 59, 0.8)" : "rgba(226, 232, 240, 0.8)",
          scaleMargins: { top: 0.12, bottom: 0.12 },
        },
        timeScale: {
          borderColor: isDarkMode ? "rgba(30, 41, 59, 0.8)" : "rgba(226, 232, 240, 0.8)",
          timeVisible: true,
          secondsVisible: false,
        },
        handleScroll: {
          mouseWheel: false,
          pressedMouseMove: true,
          horzTouchDrag: true,
          vertTouchDrag: false,
        },
        handleScale: {
          axisPressedMouseMove: true,
          mouseWheel: false,
          pinch: true,
        },
        localization: {
          priceFormatter: (value: number) => `₹${currency(value)}`,
          timeFormatter: (time: number) => {
            return new Date(time * 1000).toLocaleString([], {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            });
          }
        },
        width: chartContainerRef.current.clientWidth,
        height: 330,
      });

      areaSeriesRef.current = null;
      candleSeriesRef.current = null;
      barSeriesRef.current = null;

      if (chartViewMode === "area") {
        const areaSeries = chart.addSeries(AreaSeries, {
          lineColor: isProfit ? "#10b981" : "#ef4444",
          topColor: isProfit ? "rgba(16, 185, 129, 0.28)" : "rgba(239, 68, 68, 0.28)",
          bottomColor: isProfit ? "rgba(16, 185, 129, 0.0)" : "rgba(239, 68, 68, 0.0)",
          lineWidth: 2,
          crosshairMarkerVisible: true,
        });
        if (portfolioChartData.areaSeriesData.length > 0) {
          areaSeries.setData(portfolioChartData.areaSeriesData);
        }
        areaSeriesRef.current = areaSeries;
      } else if (chartViewMode === "candles") {
        const candleSeries = chart.addSeries(CandlestickSeries, {
          upColor: "#10b981",
          downColor: "#ef4444",
          borderUpColor: "#10b981",
          borderDownColor: "#ef4444",
          wickUpColor: "#10b981",
          wickDownColor: "#ef4444",
        });
        if (portfolioChartData.candleSeriesData.length > 0) {
          candleSeries.setData(portfolioChartData.candleSeriesData);
        }
        candleSeriesRef.current = candleSeries;
      } else if (chartViewMode === "bars") {
        const barSeries = chart.addSeries(HistogramSeries, {
          color: "#10b981",
          priceFormat: { type: "volume" },
        });
        if (portfolioChartData.barSeriesData.length > 0) {
          barSeries.setData(portfolioChartData.barSeriesData);
        }
        barSeriesRef.current = barSeries;
      }

      chart.subscribeCrosshairMove((param) => {
        if (!param.time || !param.seriesData) {
          setHoveredPoint(null);
          return;
        }
        const seriesData = Array.from(param.seriesData.values())[0] as any;
        const val = typeof seriesData?.value === "number" ? seriesData.value : (typeof seriesData?.close === "number" ? seriesData.close : null);
        if (val !== null) {
          setHoveredPoint({
            time: new Date(Number(param.time) * 1000).toLocaleString([], {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            }),
            value: val,
          });
        }
      });

      chart.timeScale().fitContent();
      chartRef.current = chart;

      const handleResize = () => {
        if (chartContainerRef.current && chartRef.current) {
          chartRef.current.applyOptions({ width: chartContainerRef.current.clientWidth });
        }
      };

      chartResizeHandlerRef.current = handleResize;
      window.addEventListener("resize", handleResize);
    };

    syncOrRenderChart();

    return () => {
      isCancelled = true;
      if (chartResizeHandlerRef.current) {
        window.removeEventListener("resize", chartResizeHandlerRef.current);
        chartResizeHandlerRef.current = null;
      }
      if (chartRef.current) {
        const chartToDestroy = chartRef.current;
        chartRef.current = null;
        areaSeriesRef.current = null;
        candleSeriesRef.current = null;
        barSeriesRef.current = null;
        try {
          chartToDestroy.remove();
        } catch {}
      }
    };
  }, [
    data,
    isClient,
    isDarkMode,
    chartViewMode,
    chartMetric,
    portfolioChartData,
  ]);

  const handleExecuteTrade = async (
    thesis: string,
    feedback: string,
    action: "BUY" | "SELL" = "BUY",
    quantity: number = 10
  ) => {
    try {
      const res = await fetch("/api/paper-trading/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: "test_user",
          ticker: selectedStockForModal,
          action,
          quantity,
          userThesis: thesis,
          aiFeedback: feedback,
        }),
      });
      const json = await res.json();
      if (json.ok) {
        rangeDataCache.current = {};
        loadPortfolio(true);
        fetchPortfolioChart(chartRange, chartMetric);
      } else {
        alert("Trade Failed: " + json.error);
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Unexpected error";
      alert("Error: " + message);
    }
  };

  const handleQuickTrade = (ticker: string, action: "BUY" | "SELL") => {
    setSelectedStockForModal(ticker);
    setModalAction(action);
    setModalQuantity(10);
    setIsModalOpen(true);
  };

  if (!isClient || (isLoading && !data) || !data) {
    return (
      <div className="flex h-[calc(100vh-56px)] items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="flex flex-col items-center gap-2 text-slate-500">
          <RefreshCw className="h-6 w-6 animate-spin text-blue-500" />
          <span className="text-sm font-semibold">Loading Paper Trading Crucible...</span>
        </div>
      </div>
    );
  }

  const firstPointVal = portfolioChartData.areaSeriesData.length > 0
    ? portfolioChartData.areaSeriesData[0].value
    : (chartMetric === "total" ? INITIAL_CAPITAL : metrics.investedValue);
  const currentTotalVal = metrics.totalValue;
  const currentHoldingsVal = metrics.holdingsValue;
  const activeVal = hoveredPoint
    ? hoveredPoint.value
    : chartMetric === "total"
    ? currentTotalVal
    : currentHoldingsVal;
  const activePnl = activeVal - firstPointVal;
  const activePnlPct = firstPointVal > 0 ? (activePnl / firstPointVal) * 100 : 0;

  return (
    <div className="min-h-[calc(100vh-56px)] bg-slate-50 dark:bg-slate-950 p-4 lg:p-6 font-sans">
      <div className="mx-auto max-w-[1680px] flex flex-col gap-4">
        {/* Paper Trading Header */}
        <div className="flex flex-col md:flex-row items-center justify-between gap-4 mb-2">
          {/* Left: Branding */}
          <div className="flex items-center gap-3 w-full md:w-auto">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">Paper Trading</h1>
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-bold tracking-wide bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Live MTM
            </span>
          </div>

          {/* Right: Search & Refresh */}
          <div className="flex items-center gap-3 w-full md:w-auto">
            {/* Search Bar - matching Dashboard design but more prominent */}
            <div className="relative w-full md:w-80" ref={tickerInputWrapRef}>
              <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white dark:bg-slate-900 border-2 border-slate-300 dark:border-slate-600 shadow-sm text-slate-900 dark:text-slate-100 transition-all focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20">
                <Search className="w-4 h-4 text-slate-400 shrink-0" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value.toUpperCase());
                    setShowSuggestions(true);
                  }}
                  onFocus={() => setShowSuggestions(true)}
                  placeholder="Search stocks..."
                  className="flex-1 min-w-0 bg-transparent text-[13px] font-bold outline-none placeholder:text-slate-400 uppercase"
                />
                <kbd className="hidden sm:inline-block ml-2 text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-mono border border-slate-200 dark:border-slate-700 pointer-events-none shadow-sm">⌘K</kbd>
              </div>

              {showSuggestions && suggestions.length > 0 && (
                <div className="absolute left-0 right-0 top-full mt-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl z-50 overflow-hidden max-h-64 overflow-y-auto">
                  {suggestions.map((sug) => (
                    <button
                      key={sug.symbol}
                      type="button"
                      onClick={() => {
                        setSearchTerm("");
                        setShowSuggestions(false);
                        setSelectedStockForModal(sug.symbol);
                        setModalAction("BUY");
                        setModalQuantity(10);
                        setIsModalOpen(true);
                      }}
                      className="w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800 border-b border-slate-100 dark:border-slate-800/60 last:border-0 flex items-center justify-between group transition-colors cursor-pointer"
                    >
                      <div>
                        <div className="text-xs font-bold text-slate-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400">
                          {sug.symbol}
                        </div>
                        <div className="text-[11px] text-slate-400 truncate max-w-[200px] sm:max-w-[260px]">
                          {sug.companyName}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                          {sug.exchange}
                        </span>
                        <span className="text-[11px] font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/40 px-2 py-0.5 rounded-md border border-blue-200 dark:border-blue-800 opacity-0 group-hover:opacity-100 transition-opacity">
                          Trade
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => {
                loadPortfolio(true);
                fetchPortfolioChart(chartRange, chartMetric);
              }}
              disabled={isRefreshing}
              className="flex items-center justify-center p-2 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors border border-slate-300 dark:border-slate-700 shrink-0"
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 text-slate-500 dark:text-slate-400 ${isRefreshing ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {/* 2-Column Dashboard Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          {/* LEFT SIDE: Deterministic Portfolio Graph & Tabs */}
          <div className="lg:col-span-8 flex flex-col gap-4">
            {/* Real-time Performance Card */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm relative">
              <div className="flex flex-wrap items-center justify-between gap-4 mb-2">
                <div className="flex items-center gap-3">
                  <span className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white tracking-tight">
                    ₹{currency(activeVal)}
                  </span>
                  <span
                    className={`inline-flex items-center text-xs font-bold px-2.5 py-1 rounded-lg ${
                      activePnl >= 0
                        ? "bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900/50"
                        : "bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-900/50"
                    }`}
                  >
                    {activePnl >= 0 ? <ArrowUpRight className="h-3.5 w-3.5 mr-0.5" /> : <ArrowDownRight className="h-3.5 w-3.5 mr-0.5" />}
                    {activePnl >= 0 ? "+" : ""}₹{currency(activePnl)} ({percent(activePnlPct)})
                    <span className="ml-1.5 text-[10px] font-semibold opacity-90">{hoveredPoint?.time || chartRange}</span>
                  </span>
                </div>

                {/* Right controls: View Mode & Timeframe */}
                <div className="flex items-center gap-2">
                  {/* Chart Style Switcher */}
                  <div className="flex gap-0.5 bg-slate-100 dark:bg-slate-800 p-0.5 rounded-xl border border-slate-200 dark:border-slate-700">
                    <button
                      type="button"
                      onClick={() => setChartViewMode("area")}
                      className={`p-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                        chartViewMode === "area" ? "bg-white dark:bg-slate-900 text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-900 dark:hover:text-white"
                      }`}
                      title="Area Curve"
                    >
                      <LineChart className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setChartViewMode("candles")}
                      className={`p-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                        chartViewMode === "candles" ? "bg-white dark:bg-slate-900 text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-900 dark:hover:text-white"
                      }`}
                      title="Candlestick Chart"
                    >
                      <CandlestickChart className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Range Buttons */}
                  <div className="flex gap-1 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-xl border border-slate-200 dark:border-slate-700/60">
                    {["1D", "1W", "1M", "3M", "1Y", "ALL"].map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setChartRange(r)}
                        className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                          chartRange === r
                            ? "bg-blue-600 text-white shadow-sm"
                            : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                        }`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Chart Canvas with Loading State */}
              <div className="relative">
                <div ref={chartContainerRef} className="relative h-[330px] w-full" />

                {isChartLoading && (
                  <div className="absolute inset-0 bg-white/50 dark:bg-slate-900/50 backdrop-blur-[1px] flex items-center justify-center rounded-xl z-10 transition-all">
                    <div className="flex items-center gap-2 bg-white dark:bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm text-xs font-semibold text-slate-600 dark:text-slate-300">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-500" />
                      Updating {chartRange} Trend...
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Tabbed Detail Section */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden">
              <div className="flex border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 px-4">
                <button
                  type="button"
                  onClick={() => setActiveTab("positions")}
                  className={`px-4 py-3 text-xs font-bold border-b-2 transition-colors ${
                    activeTab === "positions"
                      ? "border-blue-600 text-blue-600 dark:text-blue-400"
                      : "border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                  }`}
                >
                  Active Positions ({positionRows.length})
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab("journal")}
                  className={`flex items-center gap-1.5 px-4 py-3 text-xs font-bold border-b-2 transition-colors ${
                    activeTab === "journal"
                      ? "border-blue-600 text-blue-600 dark:text-blue-400"
                      : "border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                  }`}
                >
                  <Brain className="h-3.5 w-3.5" />
                  <span>AI Mentor Journal ({data.journal.length})</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab("history")}
                  className={`flex items-center gap-1.5 px-4 py-3 text-xs font-bold border-b-2 transition-colors ${
                    activeTab === "history"
                      ? "border-blue-600 text-blue-600 dark:text-blue-400"
                      : "border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                  }`}
                >
                  <History className="h-3.5 w-3.5" />
                  <span>Trade Ledger</span>
                </button>
              </div>

              {/* Tab 1: Positions Table */}
              {activeTab === "positions" && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs text-slate-700 dark:text-slate-300">
                    <thead className="bg-slate-50 dark:bg-slate-950 text-[11px] uppercase font-bold text-slate-400 border-b border-slate-200 dark:border-slate-800">
                      <tr>
                        <th className="px-4 py-3">Stock</th>
                        <th className="px-4 py-3 text-right">Shares</th>
                        <th className="px-4 py-3 text-right">Avg Buy</th>
                        <th className="px-4 py-3 text-right">Live LTP</th>
                        <th className="px-4 py-3 text-right">Invested</th>
                        <th className="px-4 py-3 text-right">Current Value</th>
                        <th className="px-4 py-3 text-right">Unrealized P&L</th>
                        <th className="px-4 py-3 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                      {positionRows.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="px-4 py-10 text-center text-slate-400 font-sans">
                            No open positions. Use the Quick Order form on the right to place a trade.
                          </td>
                        </tr>
                      ) : (
                        positionRows.map((row) => (
                          <tr key={row.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                            <td className="px-4 py-3 font-bold text-slate-900 dark:text-white">
                              <Link href={`/chart?symbol=NSE:${row.ticker}`} className="hover:text-blue-500 hover:underline">
                                {row.ticker}
                              </Link>
                            </td>
                            <td className="px-4 py-3 text-right font-medium text-slate-800 dark:text-slate-200">{row.quantity}</td>
                            <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-400">₹{currency(row.averageBuy)}</td>
                            <td className="px-4 py-3 text-right font-bold text-slate-900 dark:text-white">
                              ₹{currency(row.ltp)}
                            </td>
                            <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-400">₹{currency(row.invested)}</td>
                            <td className="px-4 py-3 text-right font-bold text-slate-900 dark:text-white">₹{currency(row.marketValue)}</td>
                            <td className={`px-4 py-3 text-right font-bold ${row.unrealizedPnl >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                              {row.unrealizedPnl >= 0 ? "+" : ""}₹{currency(row.unrealizedPnl)}
                            </td>
                            <td className="px-4 py-3 text-center">
                              <button
                                type="button"
                                onClick={() => handleQuickTrade(row.ticker, "SELL")}
                                className="px-2.5 py-1 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 hover:bg-rose-100 text-rose-600 dark:text-rose-400 text-[11px] font-bold rounded-lg transition-colors"
                              >
                                Sell
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Tab 2: AI Mentor Journal */}
              {activeTab === "journal" && (
                <div className="divide-y divide-slate-100 dark:divide-slate-800/60 p-2">
                  {data.journal.length === 0 ? (
                    <div className="px-4 py-10 text-center text-slate-400 text-xs">
                      No trades logged yet. Every simulated trade passes through the AI Mentor Gatekeeper.
                    </div>
                  ) : (
                    data.journal.map((entry) => (
                      <div key={entry.id} className="p-4 hover:bg-slate-50/50 dark:hover:bg-slate-850/40 rounded-xl transition-colors">
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                          <div className="flex items-center gap-2">
                            <span
                              className={`px-2 py-0.5 rounded text-[11px] font-extrabold uppercase ${
                                entry.action === "BUY"
                                  ? "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800"
                                  : "bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-800"
                              }`}
                            >
                              {entry.action}
                            </span>
                            <span className="font-bold text-sm text-slate-900 dark:text-white">
                              {entry.quantity} {entry.ticker}
                            </span>
                            <span className="text-xs text-slate-500">
                              @ ₹{currency(entry.execution_price)}
                            </span>
                          </div>
                          <span className="text-[11px] text-slate-400">
                            {new Date(entry.timestamp).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                          </span>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                          <div className="bg-slate-50 dark:bg-slate-950/60 p-3 rounded-xl border border-slate-200/70 dark:border-slate-800">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                              User Thesis
                            </span>
                            <p className="text-xs text-slate-700 dark:text-slate-300 italic leading-relaxed">
                              &ldquo;{entry.user_thesis}&rdquo;
                            </p>
                          </div>

                          <div className="bg-blue-50/60 dark:bg-blue-950/30 p-3 rounded-xl border border-blue-200/60 dark:border-blue-900/40">
                            <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider flex items-center gap-1 mb-1">
                              <Brain className="h-3 w-3" /> AI Mentor Critique
                            </span>
                            <div className="text-slate-700 dark:text-slate-300">
                              <MentorMarkdown text={entry.ai_feedback} />
                            </div>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Tab 3: Ledger */}
              {activeTab === "history" && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs text-slate-700 dark:text-slate-300">
                    <thead className="bg-slate-50 dark:bg-slate-950 text-[11px] uppercase font-bold text-slate-400 border-b border-slate-200 dark:border-slate-800">
                      <tr>
                        <th className="px-4 py-3">Timestamp</th>
                        <th className="px-4 py-3">Action</th>
                        <th className="px-4 py-3">Stock</th>
                        <th className="px-4 py-3 text-right">Qty</th>
                        <th className="px-4 py-3 text-right">Price</th>
                        <th className="px-4 py-3 text-right">Total Turnover</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                      {data.journal.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-4 py-10 text-center text-slate-400 font-sans">
                            No trades recorded.
                          </td>
                        </tr>
                      ) : (
                        [...data.journal].reverse().map((t) => (
                          <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-slate-850">
                            <td className="px-4 py-2.5 text-slate-500">
                              {new Date(t.timestamp).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}
                            </td>
                            <td className="px-4 py-2.5">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                  t.action === "BUY"
                                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400"
                                    : "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-400"
                                }`}
                              >
                                {t.action}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 font-bold text-slate-900 dark:text-white">{t.ticker}</td>
                            <td className="px-4 py-2.5 text-right">{t.quantity}</td>
                            <td className="px-4 py-2.5 text-right">₹{currency(t.execution_price)}</td>
                            <td className="px-4 py-2.5 text-right font-bold">₹{currency(t.quantity * t.execution_price)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT SIDE: User-Requested Paper Portfolio Card & Holdings List */}
          <div className="lg:col-span-4 flex flex-col gap-4">
            {/* Paper Portfolio Card with CAPITAL, INVESTED VALUE, CAPITAL REMAINING, CURRENT VALUE, and Unrealized P&L */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Briefcase className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                  <h2 className="text-base font-bold text-slate-900 dark:text-white">Paper Portfolio</h2>
                </div>
                <span className="px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800">
                  SIMULATION
                </span>
              </div>

              {/* 4-Field Grid matching user request */}
              <div className="grid grid-cols-2 gap-2.5 mb-3.5">
                <div className="bg-slate-50 dark:bg-slate-950/60 p-3 rounded-xl border border-slate-100 dark:border-slate-800">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                    TOTAL CAPITAL
                  </span>
                  <div className="text-base font-extrabold text-slate-900 dark:text-white mt-0.5">
                    ₹{currency(INITIAL_CAPITAL)}
                  </div>
                </div>

                <div className="bg-slate-50 dark:bg-slate-950/60 p-3 rounded-xl border border-slate-100 dark:border-slate-800">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                    CURRENT VALUE
                  </span>
                  <div className="text-base font-extrabold text-slate-900 dark:text-white mt-0.5">
                    ₹{currency(metrics.totalValue)}
                  </div>
                </div>

                <div className="bg-slate-50 dark:bg-slate-950/60 p-3 rounded-xl border border-slate-100 dark:border-slate-800">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                    INVESTED VALUE
                  </span>
                  <div className="text-base font-extrabold text-slate-900 dark:text-white mt-0.5">
                    ₹{currency(metrics.investedValue)}
                  </div>
                </div>

                <div className="bg-slate-50 dark:bg-slate-950/60 p-3 rounded-xl border border-slate-100 dark:border-slate-800">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                    CAPITAL REMAINING
                  </span>
                  <div className="text-base font-extrabold text-emerald-600 dark:text-emerald-400 mt-0.5">
                    ₹{currency(metrics.cash)}
                  </div>
                </div>
              </div>

              {/* Unrealized P&L Banner */}
              <div
                className={`p-3.5 rounded-xl border flex items-center justify-between ${
                  metrics.unrealizedPnl >= 0
                    ? "bg-emerald-50/80 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800/60 text-emerald-800 dark:text-emerald-300"
                    : "bg-rose-50/80 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800/60 text-rose-800 dark:text-rose-300"
                }`}
              >
                <span className="text-xs font-semibold">Unrealized P&L</span>
                <span className="text-sm font-bold flex items-center gap-1">
                  {metrics.unrealizedPnl >= 0 ? "↗" : "↘"} ₹{currency(metrics.unrealizedPnl)} ({percent(metrics.unrealizedReturnPct)})
                </span>
              </div>
            </div>

            {/* HOLDINGS List Card (matching user mockup) */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  HOLDINGS
                </h3>
              </div>

              <div className="divide-y divide-slate-100 dark:divide-slate-800/60 max-h-[380px] overflow-y-auto custom-scrollbar">
                {positionRows.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-400">
                    No active holdings in portfolio.
                  </div>
                ) : (
                  positionRows.map((pos) => {
                    const isProfit = pos.unrealizedPnl >= 0;
                    return (
                      <div
                        key={pos.id}
                        className="py-3.5 flex items-center justify-between hover:bg-slate-50/60 dark:hover:bg-slate-800/30 px-2 rounded-xl transition-colors"
                      >
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-sm text-slate-900 dark:text-white">
                              {pos.ticker}
                            </span>
                          </div>
                          <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                            {pos.quantity} shares @ ₹{pos.averageBuy.toFixed(2)}
                          </div>
                        </div>

                        <div className="text-right">
                          <div className="text-sm font-bold text-slate-900 dark:text-white">
                            ₹{pos.ltp.toFixed(2)}
                          </div>
                          <div
                            className={`text-xs font-semibold mt-0.5 ${
                              isProfit
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-rose-600 dark:text-rose-400"
                            }`}
                          >
                            {isProfit ? "+" : ""}₹{currency(pos.unrealizedPnl)} ({percent(pos.returnPct)})
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {isModalOpen && (
        <TradingModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          ticker={selectedStockForModal}
          initialAction={modalAction}
          initialQuantity={modalQuantity}
          availableCash={metrics.cash}
          existingPosition={
            positionRows.find((p) => p.ticker === selectedStockForModal)
              ? {
                  quantity: positionRows.find((p) => p.ticker === selectedStockForModal)!.quantity,
                  averageBuy: positionRows.find((p) => p.ticker === selectedStockForModal)!.averageBuy,
                }
              : null
          }
          onExecute={handleExecuteTrade}
        />
      )}
    </div>
  );
}
