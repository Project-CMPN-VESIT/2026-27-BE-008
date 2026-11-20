"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PortfolioChart from "@/components/chart/PortfolioChart";
import { Holding } from "@/lib/portfolio/usePortfolio";
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
import { authenticatedFetch } from "@/lib/authenticated-fetch";
import { useAuth } from "@/lib/auth-context";

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
  const { user } = useAuth();
  const tickerInputWrapRef = useRef<HTMLDivElement>(null);
  const [isDarkMode, setIsDarkMode] = useState(false);

  const ownerName = useMemo(() => {
    const raw = (user?.name || user?.email?.split("@")[0] || "Shivam").trim();
    const first = raw.split(" ")[0].trim();
    const letters = first.replace(/[^a-zA-Z]/g, "");
    const base = letters.length >= 2 ? letters : first;
    return base.charAt(0).toUpperCase() + base.slice(1);
  }, [user]);

  const paperChartTitle = `${ownerName}'s Paper Trading Portfolio`;

  const [data, setData] = useState<PortfolioData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});
  const [activeTab, setActiveTab] = useState<"positions" | "journal" | "history">("positions");
  const [isModalOpen, setIsModalOpen] = useState(false);

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedStockForModal, setSelectedStockForModal] = useState<string>("RELIANCE");
  const [modalAction, setModalAction] = useState<"BUY" | "SELL">("BUY");
  const [modalQuantity, setModalQuantity] = useState<number>(10);

  const [isClient, setIsClient] = useState(false);
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [chartMetric, setChartMetric] = useState<"total" | "holdings">("holdings");

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
      } catch { }
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
        const res = await authenticatedFetch("/api/paper-trading/portfolio");
        const json = await res.json();
        if (json.ok) {
          setData(json.data);
          try {
            sessionStorage.setItem("finpilot_paper_portfolio_cache", JSON.stringify(json.data));
            localStorage.setItem("finpilot_paper_portfolio_cache", JSON.stringify(json.data));
          } catch {}
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
    let hasCache = false;
    try {
      const cached =
        sessionStorage.getItem("finpilot_paper_portfolio_cache") ||
        localStorage.getItem("finpilot_paper_portfolio_cache");
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && Array.isArray(parsed.positions)) {
          setData(parsed);
          setIsLoading(false);
          hasCache = true;
        }
      }
    } catch {}

    loadPortfolio(hasCache);
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") loadPortfolio(true);
    }, PORTFOLIO_POLL_MS);
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

    return data.positions.map((position, idx) => {
      const ltp = livePrices[position.ticker] ?? position.average_buy_price;
      const invested = position.quantity * position.average_buy_price;
      const marketValue = position.quantity * ltp;
      const unrealizedPnl = marketValue - invested;
      const returnPct = invested > 0 ? (unrealizedPnl / invested) * 100 : 0;

      return {
        id: position.id ?? idx + 1,
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

  // Dynamic holdings basket derived reactively from user positions
  const holdings: Holding[] = useMemo(() => {
    if (!data?.positions || data.positions.length === 0) return [];
    return data.positions.map((p) => ({
      symbol: p.ticker.includes(':') ? p.ticker : `NSE:${p.ticker}`,
      qty: p.quantity,
    }));
  }, [data?.positions]);

  const handleExecuteTrade = async (
    thesis: string,
    feedback: string,
    action: "BUY" | "SELL" = "BUY",
    quantity: number = 10
  ) => {
    try {
      const res = await authenticatedFetch("/api/paper-trading/execute", {
        method: "POST",
        body: JSON.stringify({
          ticker: selectedStockForModal,
          action,
          quantity,
          userThesis: thesis,
          aiFeedback: feedback,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      const json = await res.json();
      if (json.ok) {
        loadPortfolio(false);
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

  if (!isClient || (isLoading && !data)) {
    return (
      <div
        className="min-h-[calc(100vh-107px)] bg-slate-50 dark:bg-slate-950 pt-6 sm:pt-8 px-4 pb-6 lg:px-6 lg:pb-8 font-sans animate-pulse"
        style={{ fontFamily: "Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}
      >
        <div className="mx-auto max-w-[1680px] flex flex-col gap-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 mb-2">
            <div className="flex items-center gap-3 w-full md:w-auto">
              <div className="h-8 w-44 bg-slate-200 dark:bg-slate-800 rounded-lg" />
              <div className="h-5 w-20 bg-slate-200 dark:bg-slate-800 rounded-md" />
            </div>
            <div className="flex items-center gap-3 w-full md:w-auto">
              <div className="h-10 w-full md:w-80 bg-slate-200 dark:bg-slate-800 rounded-xl" />
              <div className="h-10 w-10 bg-slate-200 dark:bg-slate-800 rounded-lg shrink-0" />
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
            <div className="lg:col-span-8 flex flex-col gap-4">
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm h-[400px] flex flex-col gap-4">
                <div className="h-5 w-48 bg-slate-200 dark:bg-slate-800 rounded" />
                <div className="h-9 w-60 bg-slate-200 dark:bg-slate-800 rounded" />
                <div className="flex-1 bg-slate-100 dark:bg-slate-800/40 rounded-xl" />
              </div>
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl h-64 p-4 flex flex-col gap-3">
                <div className="h-6 w-36 bg-slate-200 dark:bg-slate-800 rounded" />
                <div className="h-10 bg-slate-100 dark:bg-slate-800/50 rounded" />
                <div className="h-10 bg-slate-100 dark:bg-slate-800/50 rounded" />
                <div className="h-10 bg-slate-100 dark:bg-slate-800/50 rounded" />
              </div>
            </div>
            <div className="lg:col-span-4 flex flex-col gap-4">
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm h-80 flex flex-col gap-3">
                <div className="h-6 w-36 bg-slate-200 dark:bg-slate-800 rounded" />
                <div className="grid grid-cols-2 gap-3 mt-2">
                  <div className="h-16 bg-slate-100 dark:bg-slate-800/50 rounded-xl" />
                  <div className="h-16 bg-slate-100 dark:bg-slate-800/50 rounded-xl" />
                  <div className="h-16 bg-slate-100 dark:bg-slate-800/50 rounded-xl" />
                  <div className="h-16 bg-slate-100 dark:bg-slate-800/50 rounded-xl" />
                </div>
              </div>
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm h-72" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (loadError && !data) {
    return (
      <div className="flex h-[calc(100vh-56px)] items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="flex flex-col items-center gap-3 text-center p-6 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm max-w-md">
          <div className="text-rose-500 font-semibold text-base">Unable to Load Paper Trading</div>
          <p className="text-xs text-slate-500 dark:text-slate-400">{loadError}</p>
          <button
            onClick={() => loadPortfolio(false)}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition-colors mt-2"
          >
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  return (
    <div
      className="min-h-[calc(100vh-107px)] bg-slate-50 dark:bg-slate-950 pt-6 sm:pt-8 px-4 pb-6 lg:px-6 lg:pb-8 font-sans"
      style={{ fontFamily: "Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}
    >
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
              <PortfolioChart
                holdings={holdings}
                cash={data.balance}
                metric={chartMetric}
                onMetricChange={setChartMetric}
                defaultRange="1D"
                defaultMode="line"
                live
                dark={isDarkMode}
                height={330}
                title={paperChartTitle}
              />
            </div>

            {/* Tabbed Detail Section */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden">
              <div className="flex border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 px-4">
                <button
                  type="button"
                  onClick={() => setActiveTab("positions")}
                  className={`px-4 py-3 text-xs font-bold border-b-2 transition-colors ${activeTab === "positions"
                    ? "border-blue-600 text-blue-600 dark:text-blue-400"
                    : "border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                    }`}
                >
                  Active Positions ({positionRows.length})
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab("journal")}
                  className={`flex items-center gap-1.5 px-4 py-3 text-xs font-bold border-b-2 transition-colors ${activeTab === "journal"
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
                  className={`flex items-center gap-1.5 px-4 py-3 text-xs font-bold border-b-2 transition-colors ${activeTab === "history"
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
                          <tr key={row.ticker} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                            <td className="px-4 py-3 font-bold text-slate-900 dark:text-white">
                              <Link href={`/chart?symbol=NSE:${row.ticker}`} className="hover:text-blue-500 hover:underline">
                                {row.ticker}
                              </Link>
                            </td>
                            <td className="px-4 py-3 text-right font-medium tabular-nums text-slate-800 dark:text-slate-200">{row.quantity}</td>
                            <td className="px-4 py-3 text-right font-medium tabular-nums text-slate-600 dark:text-slate-400">₹{currency(row.averageBuy)}</td>
                            <td className="px-4 py-3 text-right font-medium tabular-nums text-slate-900 dark:text-white">
                              ₹{currency(row.ltp)}
                            </td>
                            <td className="px-4 py-3 text-right font-medium tabular-nums text-slate-600 dark:text-slate-400">₹{currency(row.invested)}</td>
                            <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-900 dark:text-white">₹{currency(row.marketValue)}</td>
                            <td className={`px-4 py-3 text-right font-semibold tabular-nums ${row.unrealizedPnl >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
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
                    data.journal.map((entry, idx) => (
                      <div key={entry.id ?? `journal-${entry.ticker}-${idx}`} className="p-4 hover:bg-slate-50/50 dark:hover:bg-slate-850/40 rounded-xl transition-colors">
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                          <div className="flex items-center gap-2">
                            <span
                              className={`px-2 py-0.5 rounded text-[11px] font-extrabold uppercase ${entry.action === "BUY"
                                ? "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800"
                                : "bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-800"
                                }`}
                            >
                              {entry.action}
                            </span>
                            <span className="font-bold tabular-nums text-sm text-slate-900 dark:text-white">
                              {entry.quantity} {entry.ticker}
                            </span>
                            <span className="text-xs font-medium tabular-nums text-slate-500">
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
                        [...data.journal].reverse().map((t, idx) => (
                          <tr key={t.id ?? `trade-${t.ticker}-${idx}`} className="hover:bg-slate-50 dark:hover:bg-slate-850">
                            <td className="px-4 py-2.5 text-slate-500">
                              {new Date(t.timestamp).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}
                            </td>
                            <td className="px-4 py-2.5">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold ${t.action === "BUY"
                                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400"
                                  : "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-400"
                                  }`}
                              >
                                {t.action}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 font-bold text-slate-900 dark:text-white">{t.ticker}</td>
                            <td className="px-4 py-2.5 text-right font-medium tabular-nums">{t.quantity}</td>
                            <td className="px-4 py-2.5 text-right font-medium tabular-nums">₹{currency(t.execution_price)}</td>
                            <td className="px-4 py-2.5 text-right font-semibold tabular-nums">₹{currency(t.quantity * t.execution_price)}</td>
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
                  <div className="text-base font-bold tabular-nums text-slate-900 dark:text-white mt-0.5">
                    ₹{currency(INITIAL_CAPITAL)}
                  </div>
                </div>

                <div className="bg-slate-50 dark:bg-slate-950/60 p-3 rounded-xl border border-slate-100 dark:border-slate-800">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                    CURRENT VALUE
                  </span>
                  <div className="text-base font-bold tabular-nums text-slate-900 dark:text-white mt-0.5">
                    ₹{currency(metrics.totalValue)}
                  </div>
                </div>

                <div className="bg-slate-50 dark:bg-slate-950/60 p-3 rounded-xl border border-slate-100 dark:border-slate-800">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                    INVESTED VALUE
                  </span>
                  <div className="text-base font-bold tabular-nums text-slate-900 dark:text-white mt-0.5">
                    ₹{currency(metrics.investedValue)}
                  </div>
                </div>

                <div className="bg-slate-50 dark:bg-slate-950/60 p-3 rounded-xl border border-slate-100 dark:border-slate-800">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                    CAPITAL REMAINING
                  </span>
                  <div className="text-base font-bold tabular-nums text-emerald-600 dark:text-emerald-400 mt-0.5">
                    ₹{currency(metrics.cash)}
                  </div>
                </div>
              </div>

              {/* Unrealized P&L Banner */}
              <div
                className={`p-3.5 rounded-xl border flex items-center justify-between ${metrics.unrealizedPnl >= 0
                  ? "bg-emerald-50/80 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800/60 text-emerald-800 dark:text-emerald-300"
                  : "bg-rose-50/80 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800/60 text-rose-800 dark:text-rose-300"
                  }`}
              >
                <span className="text-xs font-semibold">Unrealized P&L</span>
                <span className="text-sm font-semibold tabular-nums flex items-center gap-1">
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
                        key={pos.ticker}
                        className="py-3.5 flex items-center justify-between hover:bg-slate-50/60 dark:hover:bg-slate-800/30 px-2 rounded-xl transition-colors"
                      >
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold tabular-nums text-sm text-slate-900 dark:text-white">
                              {pos.ticker}
                            </span>
                          </div>
                          <div className="text-xs font-medium tabular-nums text-slate-400 dark:text-slate-500 mt-0.5">
                            {pos.quantity} shares @ ₹{pos.averageBuy.toFixed(2)}
                          </div>
                        </div>

                        <div className="text-right">
                          <div className="text-sm font-semibold tabular-nums text-slate-900 dark:text-white">
                            ₹{pos.ltp.toFixed(2)}
                          </div>
                          <div
                            className={`text-xs font-medium tabular-nums mt-0.5 ${isProfit
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
