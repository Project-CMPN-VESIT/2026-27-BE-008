"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { IChartApi, UTCTimestamp } from "lightweight-charts";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  BookOpen,
  Brain,
  Briefcase,
  RefreshCw,
  TrendingUp,
  Wallet,
} from "lucide-react";
import TradingModal from "@/components/TradingModal";

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
const PORTFOLIO_POLL_MS = 10_000;

const RANGE_TO_DAYS: Record<string, number> = {
  "1D": 1,
  "1W": 7,
  "1M": 30,
  "3M": 90,
  "1Y": 365,
  "5Y": 1825,
  ALL: 3650,
};

const currency = (value: number) =>
  value.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const percent = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;

const toTimestamp = (value: string): UTCTimestamp =>
  Math.floor(new Date(value).getTime() / 1000) as UTCTimestamp;

const clampPositiveInteger = (value: number, min = 1) => {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.floor(value));
};

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
  const [activeTab, setActiveTab] = useState<"holdings" | "journal">("holdings");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [tradeForm, setTradeForm] = useState({
    ticker: "RELIANCE",
    action: "BUY" as "BUY" | "SELL",
    quantity: 10,
  });
  const [isClient, setIsClient] = useState(false);
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [chartRange, setChartRange] = useState("1M");

  useEffect(() => {
    let isMounted = true;
    if (tradeForm.ticker.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/tv-search?q=${encodeURIComponent(tradeForm.ticker.trim())}`);
        const data = await response.json();
        if (!isMounted) return;
        if (response.ok && data.ok) {
          const items = data.data as SearchSuggestion[];
          const deduped = Array.from(new Map(items.map(i => [i.symbol, i])).values());
          setSuggestions(deduped);
        }
      } catch {}
    }, 250);
    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [tradeForm.ticker]);

  useEffect(() => {
    if (!showSuggestions) {
      return;
    }

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

    const syncTheme = () => {
      setIsDarkMode(root.classList.contains("dark"));
    };

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
        return {
          ticker: position.ticker,
          ltp: json?.ok ? Number(json?.data?.ltp) : undefined,
          source: json?.ok ? String(json?.data?.source || "") : "",
        };
      })
    );

    const currentTickers = new Set(positions.map((position) => position.ticker));
    const newPrices: Record<string, number> = {};
    for (const item of settled) {
      if (item.status !== "fulfilled") {
        continue;
      }

      // Accept only positive live quotes. Fallback/zero values are treated as unavailable.
      if (item.value.source === "live" && Number.isFinite(item.value.ltp) && (item.value.ltp ?? 0) > 0) {
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

  const loadPortfolio = useCallback(async (isBackground = false) => {
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
  }, [fetchLivePrices]);

  useEffect(() => {
    setIsClient(true);
    loadPortfolio(false);
    const interval = setInterval(() => loadPortfolio(true), PORTFOLIO_POLL_MS);
    return () => clearInterval(interval);
  }, [loadPortfolio]);

  const journalAscending = useMemo(() => {
    if (!data?.journal) {
      return [];
    }

    return [...data.journal].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  }, [data?.journal]);

  const positionRows = useMemo<PositionView[]>(() => {
    if (!data) {
      return [];
    }

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

      if (qty <= 0 || price <= 0) {
        continue;
      }

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
          if (pnl >= 0) {
            closedTradeWins += 1;
          } else {
            closedTradeLosses += 1;
          }

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

  const performancePoints = useMemo(() => {
    if (!data) {
      return [] as Array<{ time: UTCTimestamp; value: number }>;
    }

    const nowTs = Math.floor(Date.now() / 1000) as UTCTimestamp;
    if (!journalAscending.length) {
      return [
        { time: (Number(nowTs) - 3600) as UTCTimestamp, value: INITIAL_CAPITAL },
        { time: nowTs, value: metrics.totalValue },
      ];
    }

    let cash = INITIAL_CAPITAL;
    const book = new Map<string, { qty: number; avg: number }>();
    const markerPrice = new Map<string, number>();

    const points: Array<{ time: UTCTimestamp; value: number }> = [];

    const firstTradeTs = toTimestamp(journalAscending[0].timestamp);
    points.push({
      time: (Math.max(1, Number(firstTradeTs) - 60)) as UTCTimestamp,
      value: INITIAL_CAPITAL,
    });

    const calculateEquity = () => {
      let holdings = 0;
      for (const [ticker, state] of book) {
        if (state.qty <= 0) {
          continue;
        }
        const mark = markerPrice.get(ticker) ?? livePrices[ticker] ?? state.avg;
        holdings += state.qty * mark;
      }
      return cash + holdings;
    };

    for (const trade of journalAscending) {
      const action = String(trade.action || "").toUpperCase();
      const qty = clampPositiveInteger(Number(trade.quantity), 0);
      const price = Number(trade.execution_price) || 0;

      if (qty <= 0 || price <= 0) {
        continue;
      }

      const value = qty * price;
      const current = book.get(trade.ticker) ?? { qty: 0, avg: 0 };

      if (action === "BUY") {
        cash -= value;
        const newQty = current.qty + qty;
        const newAvg = newQty > 0 ? (current.qty * current.avg + value) / newQty : current.avg;
        book.set(trade.ticker, { qty: newQty, avg: newAvg });
      } else if (action === "SELL") {
        const executableQty = Math.min(current.qty, qty);
        if (executableQty > 0) {
          cash += executableQty * price;
          const remainingQty = current.qty - executableQty;
          book.set(trade.ticker, {
            qty: remainingQty,
            avg: remainingQty > 0 ? current.avg : 0,
          });
        }
      }

      markerPrice.set(trade.ticker, price);
      points.push({
        time: toTimestamp(trade.timestamp),
        value: calculateEquity(),
      });
    }

    points.push({ time: nowTs, value: metrics.totalValue });

    // Lightweight charts requires strictly increasing timestamps.
    const normalized: Array<{ time: UTCTimestamp; value: number }> = [];
    let last = 0;
    for (const point of points.sort((a, b) => Number(a.time) - Number(b.time))) {
      let timestamp = Number(point.time);
      if (timestamp <= last) {
        timestamp = last + 1;
      }
      last = timestamp;
      normalized.push({ time: timestamp as UTCTimestamp, value: point.value });
    }

    return normalized;
  }, [data, journalAscending, livePrices, metrics.totalValue]);

  const visiblePerformance = useMemo(() => {
    if (!performancePoints.length) {
      return [];
    }

    if (chartRange === "ALL") {
      return performancePoints;
    }

    const rangeDays = RANGE_TO_DAYS[chartRange] ?? 30;
    const cutoff = Date.now() - rangeDays * 24 * 60 * 60 * 1000;

    const filtered = performancePoints.filter((point) => Number(point.time) * 1000 >= cutoff);
    if (filtered.length >= 2) {
      return filtered;
    }

    return performancePoints.slice(-Math.min(30, performancePoints.length));
  }, [chartRange, performancePoints]);

  useEffect(() => {
    if (!chartContainerRef.current || !isClient || !data) return;

    let isCancelled = false;

    const renderChart = async () => {
      const { createChart, AreaSeries, ColorType } = await import("lightweight-charts");

      if (isCancelled || !chartContainerRef.current) {
        return;
      }

      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }

      if (chartResizeHandlerRef.current) {
        window.removeEventListener("resize", chartResizeHandlerRef.current);
        chartResizeHandlerRef.current = null;
      }

      const chart = createChart(chartContainerRef.current, {
        layout: {
          background: { type: ColorType.Solid, color: "transparent" },
          textColor: isDarkMode ? "#94a3b8" : "#475569",
        },
        grid: {
          vertLines: { color: isDarkMode ? "rgba(51, 65, 85, 0.45)" : "rgba(148, 163, 184, 0.35)" },
          horzLines: { color: isDarkMode ? "rgba(51, 65, 85, 0.45)" : "rgba(148, 163, 184, 0.35)" },
        },
        rightPriceScale: {
          borderColor: isDarkMode ? "rgba(51, 65, 85, 0.55)" : "rgba(148, 163, 184, 0.6)",
        },
        timeScale: {
          borderColor: isDarkMode ? "rgba(51, 65, 85, 0.55)" : "rgba(148, 163, 184, 0.6)",
        },
        localization: {
          priceFormatter: (value: number) => `₹${currency(value)}`,
        },
        width: chartContainerRef.current.clientWidth,
        height: 300,
      });

      const areaSeries = chart.addSeries(AreaSeries, {
        lineColor: isDarkMode ? "#22d3ee" : "#2563eb",
        topColor: isDarkMode ? "rgba(34, 211, 238, 0.25)" : "rgba(37, 99, 235, 0.24)",
        bottomColor: isDarkMode ? "rgba(34, 211, 238, 0.03)" : "rgba(37, 99, 235, 0.03)",
        lineWidth: 2,
        crosshairMarkerVisible: true,
      });

      areaSeries.setData(visiblePerformance);
      areaSeries.createPriceLine({
        price: INITIAL_CAPITAL,
        color: isDarkMode ? "rgba(148, 163, 184, 0.5)" : "rgba(100, 116, 139, 0.65)",
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: "Start",
      });

      chart.timeScale().fitContent();
      chartRef.current = chart;

      const handleResize = () => {
        if (chartContainerRef.current) {
          chart.applyOptions({ width: chartContainerRef.current.clientWidth });
        }
      };

      chartResizeHandlerRef.current = handleResize;
      window.addEventListener("resize", handleResize);
    };

    renderChart();

    return () => {
      isCancelled = true;
      if (chartResizeHandlerRef.current) {
        window.removeEventListener("resize", chartResizeHandlerRef.current);
        chartResizeHandlerRef.current = null;
      }
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [data, isClient, isDarkMode, visiblePerformance]);

  const handleExecuteTrade = async (thesis: string, feedback: string) => {
    try {
      const res = await fetch("/api/paper-trading/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: "test_user",
          ticker: tradeForm.ticker,
          action: tradeForm.action,
          quantity: tradeForm.quantity,
          userThesis: thesis,
          aiFeedback: feedback
        })
      });
      const json = await res.json();
      if (json.ok) {
        alert("Trade Executed Successfully!");
        loadPortfolio(true);
      } else {
        alert("Trade Failed: " + json.error);
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Unexpected error";
      alert("Error: " + message);
    }
  };

  if (!isClient) {
    return (
      <div className="min-h-screen bg-grid-pattern p-6">
        <div className="mx-auto max-w-6xl rounded-xl border border-slate-300 bg-white p-6 text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
          Loading Paper Trading dashboard...
        </div>
      </div>
    );
  }

  if (isLoading && !data) {
    return (
      <div className="min-h-screen bg-grid-pattern p-6">
        <div className="mx-auto max-w-6xl rounded-xl border border-slate-300 bg-white p-6 text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
          Loading portfolio data...
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-grid-pattern p-6">
        <div className="mx-auto max-w-6xl rounded-xl border border-rose-200 bg-rose-50 p-6 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
          <div className="mb-3 font-semibold">Unable to load paper trading data.</div>
          <div className="mb-4 text-sm">{loadError || "Unknown error"}</div>
          <button
            onClick={() => loadPortfolio(false)}
            className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-grid-pattern p-6">
      <div className="mx-auto max-w-6xl space-y-6">

        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900 dark:text-white">
              <Activity className="h-6 w-6 text-blue-500" /> Paper Trading Crucible
            </h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              AI-mentored reflection loop with live mark-to-market portfolio tracking
            </p>
          </div>

          <div className="flex items-center gap-2">
            {lastSyncedAt && (
              <span className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                Updated: {new Date(lastSyncedAt).toLocaleTimeString()}
              </span>
            )}
            <button
              onClick={() => loadPortfolio(true)}
              disabled={isRefreshing}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
              {isRefreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        {loadError && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
            {loadError}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-slate-300 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-500 dark:text-slate-400">
              <Briefcase className="h-4 w-4" /> Total Portfolio Value
            </div>
            <div className="mt-2 text-3xl font-bold text-slate-900 dark:text-white">₹{currency(metrics.totalValue)}</div>
            <div className={`mt-2 text-xs font-semibold ${metrics.totalPnl >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
              {metrics.totalPnl >= 0 ? <ArrowUpRight className="mr-1 inline h-3 w-3" /> : <ArrowDownRight className="mr-1 inline h-3 w-3" />}
              {metrics.totalPnl >= 0 ? "+" : ""}₹{currency(metrics.totalPnl)} ({percent(metrics.totalReturnPct)})
            </div>
          </div>

          <div className="rounded-xl border border-slate-300 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-500 dark:text-slate-400">
              <Wallet className="h-4 w-4" /> Cash & Holdings
            </div>
            <div className="mt-2 text-base font-semibold text-slate-900 dark:text-white">Cash: ₹{currency(metrics.cash)}</div>
            <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">Holdings: ₹{currency(metrics.holdingsValue)}</div>
            <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">Capital deployed: {percent(metrics.deployedPct)}</div>
          </div>

          <div className="rounded-xl border border-slate-300 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-500 dark:text-slate-400">
              <TrendingUp className="h-4 w-4" /> Realized / Unrealized
            </div>
            <div className={`mt-2 text-base font-semibold ${metrics.realizedPnl >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
              Realized: {metrics.realizedPnl >= 0 ? "+" : ""}₹{currency(metrics.realizedPnl)} ({percent(metrics.realizedReturnPct)})
            </div>
            <div className={`mt-1 text-sm ${metrics.unrealizedPnl >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
              Unrealized: {metrics.unrealizedPnl >= 0 ? "+" : ""}₹{currency(metrics.unrealizedPnl)} ({percent(metrics.unrealizedReturnPct)})
            </div>
            <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">Invested cost: ₹{currency(metrics.investedValue)}</div>
          </div>

          <div className="rounded-xl border border-slate-300 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-500 dark:text-slate-400">
              <BarChart3 className="h-4 w-4" /> Trade Analytics
            </div>
            <div className="mt-2 text-base font-semibold text-slate-900 dark:text-white">Buy value: ₹{currency(metrics.totalBuyValue)}</div>
            <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">Sell value: ₹{currency(metrics.totalSellValue)}</div>
            <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Trades: {metrics.tradeCount} | Win rate: {metrics.winRate.toFixed(1)}%
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="rounded-xl border border-slate-300 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 lg:col-span-2">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-white">Live Portfolio Performance</h2>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  Built from executed trades and latest fetched market prices
                </p>
              </div>
              <div className="flex gap-1 rounded-lg border border-slate-300 bg-slate-100 p-1 dark:border-slate-700 dark:bg-slate-800/60">
                {["1D", "1W", "1M", "3M", "1Y", "5Y", "ALL"].map(r => (
                  <button
                    key={r}
                    onClick={() => setChartRange(r)}
                    className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                      chartRange === r
                        ? "bg-blue-600 text-white shadow-sm"
                        : "text-slate-600 hover:bg-slate-200 hover:text-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-slate-100"
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>

            <div ref={chartContainerRef} className="relative h-[300px] w-full" />

            <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
              <span>Start Capital: ₹{currency(INITIAL_CAPITAL)}</span>
              <span>Current Value: ₹{currency(metrics.totalValue)}</span>
              <span className={metrics.totalReturnPct >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}>
                Return: {percent(metrics.totalReturnPct)}
              </span>
            </div>
          </div>

          <div className="relative flex flex-col justify-center rounded-xl border border-slate-300 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <h2 className="mb-4 text-base font-semibold text-slate-900 dark:text-white">Execute Trade</h2>
            <div className="space-y-4">
              <div className="relative" ref={tickerInputWrapRef}>
                <label className="mb-1 block text-sm text-slate-500 dark:text-slate-400">Ticker</label>
                <input
                  value={tradeForm.ticker}
                  onChange={e => {
                    setTradeForm({...tradeForm, ticker: e.target.value.toUpperCase()});
                    setShowSuggestions(true);
                  }}
                  onFocus={() => setShowSuggestions(true)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                />

                {showSuggestions && suggestions.length > 0 && (
                  <div className="absolute left-0 top-full z-30 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-slate-300 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
                    {suggestions.map((item) => (
                      <button
                        key={item.marketId}
                        type="button"
                        onClick={() => {
                          setTradeForm({...tradeForm, ticker: item.symbol});
                          setShowSuggestions(false);
                        }}
                        className="flex w-full flex-col border-b border-slate-200 px-3 py-2 text-left hover:bg-slate-50 last:border-0 dark:border-slate-800/60 dark:hover:bg-slate-800"
                      >
                        <div className="text-sm font-bold text-slate-800 dark:text-slate-200">{item.symbol}</div>
                        <div className="w-full truncate text-xs text-slate-500 dark:text-slate-400">{item.companyName}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm text-slate-500 dark:text-slate-400">Action</label>
                  <select
                    value={tradeForm.action}
                    onChange={e => setTradeForm({...tradeForm, action: e.target.value as "BUY"|"SELL"})}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  >
                    <option value="BUY">BUY</option>
                    <option value="SELL">SELL</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-sm text-slate-500 dark:text-slate-400">Qty</label>
                  <input
                    type="number"
                    min={1}
                    value={tradeForm.quantity}
                    onChange={e => setTradeForm({...tradeForm, quantity: clampPositiveInteger(Number(e.target.value))})}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />
                </div>
              </div>

              <button
                onClick={() => setIsModalOpen(true)}
                disabled={!tradeForm.ticker.trim() || tradeForm.quantity < 1}
                className="mt-2 w-full rounded-lg bg-blue-600 py-3 font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Queue Trade
              </button>
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-300 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex border-b border-slate-200 bg-slate-50/70 px-4 dark:border-slate-800 dark:bg-slate-900/70">
            <button
              onClick={() => setActiveTab("holdings")}
              className={`border-b-2 px-4 py-4 text-sm font-medium transition-colors ${activeTab === "holdings" ? "border-blue-500 text-blue-600 dark:text-blue-400" : "border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"}`}
            >
              Current Holdings
            </button>

            <button
              onClick={() => setActiveTab("journal")}
              className={`flex items-center gap-2 border-b-2 px-4 py-4 text-sm font-medium transition-colors ${activeTab === "journal" ? "border-blue-500 text-blue-600 dark:text-blue-400" : "border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"}`}
            >
              <BookOpen className="h-4 w-4" /> Reflection Journal
            </button>
          </div>

          <div className="p-0">
            {activeTab === "holdings" ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-slate-700 dark:text-slate-300">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-900/80 dark:text-slate-500">
                    <tr>
                      <th className="px-6 py-4 font-medium">Ticker</th>
                      <th className="px-6 py-4 font-medium">Quantity</th>
                      <th className="px-6 py-4 font-medium">Avg Buy</th>
                      <th className="px-6 py-4 font-medium">LTP</th>
                      <th className="px-6 py-4 font-medium">Invested</th>
                      <th className="px-6 py-4 font-medium">Market Value</th>
                      <th className="px-6 py-4 font-medium">Unrealized</th>
                      <th className="px-6 py-4 font-medium">Return %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800/60">
                    {positionRows.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-6 py-8 text-center text-slate-500">
                          No open positions.
                        </td>
                      </tr>
                    ) : (
                      positionRows.map((row) => (
                        <tr key={row.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/20">
                          <td className="px-6 py-4 font-semibold text-slate-900 dark:text-white">{row.ticker}</td>
                          <td className="px-6 py-4">{row.quantity}</td>
                          <td className="px-6 py-4">₹{currency(row.averageBuy)}</td>
                          <td className="px-6 py-4">
                            <span className={livePrices[row.ticker] ? "" : "opacity-80"}>₹{currency(row.ltp)}</span>
                            {!livePrices[row.ticker] && (
                              <span className="ml-1 text-[10px] uppercase text-slate-400">offline</span>
                            )}
                          </td>
                          <td className="px-6 py-4">₹{currency(row.invested)}</td>
                          <td className="px-6 py-4">₹{currency(row.marketValue)}</td>
                          <td className={`px-6 py-4 font-semibold ${row.unrealizedPnl >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                            {row.unrealizedPnl >= 0 ? "+" : ""}₹{currency(row.unrealizedPnl)}
                          </td>
                          <td className={`px-6 py-4 font-semibold ${row.returnPct >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                            {percent(row.returnPct)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="divide-y divide-slate-200 dark:divide-slate-800/60">
                {data.journal.length === 0 ? (
                  <div className="px-6 py-8 text-center text-slate-500">No trades logged yet.</div>
                ) : data.journal.map((entry) => (
                  <div key={entry.id} className="p-6">
                    <div className="mb-3 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className={`rounded-md px-2 py-1 text-xs font-bold ${entry.action === "BUY" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400" : "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-400"}`}>
                          {entry.action}
                        </span>
                        <span className="text-lg font-bold text-slate-900 dark:text-white">
                          {entry.quantity} {entry.ticker}
                        </span>
                        <span className="text-sm text-slate-500 dark:text-slate-400">
                          @ ₹{currency(entry.execution_price)}
                        </span>
                      </div>
                      <span className="text-xs text-slate-500 dark:text-slate-400">{new Date(entry.timestamp).toLocaleString()}</span>
                    </div>

                    <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900">
                        <div className="mb-2 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">My Thesis</div>
                        <p className="text-sm italic text-slate-700 dark:text-slate-300">&ldquo;{entry.user_thesis}&rdquo;</p>
                      </div>

                      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-500/30 dark:bg-blue-900/10">
                        <div className="mb-2 flex items-center gap-1 text-xs font-semibold uppercase text-blue-600 dark:text-blue-400">
                          <Brain className="h-3 w-3" /> AI Mentor Feedback
                        </div>
                        <p className="text-sm text-slate-700 dark:text-slate-300">{entry.ai_feedback}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {isModalOpen && (
        <TradingModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          ticker={tradeForm.ticker}
          action={tradeForm.action}
          quantity={tradeForm.quantity}
          currentPrice={livePrices[tradeForm.ticker] || 0}
          onExecute={handleExecuteTrade}
        />
      )}
    </div>
  );
}
