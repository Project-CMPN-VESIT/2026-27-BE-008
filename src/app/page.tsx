"use client";

import { FormEvent, startTransition, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Clock,
  Search,
  X,
} from "lucide-react";

type SearchSuggestion = {
  marketId: string;
  exchange: string;
  symbol: string;
  companyName: string;
};

const exchangePriority: Record<string, number> = {
  NSE: 0,
  BSE: 1,
};

const dedupeSuggestions = (items: SearchSuggestion[]) => {
  const deduped = new Map<string, SearchSuggestion>();

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

type LiveIndex = {
  label: string;
  marketId: string;
  ltp: number;
  change: number;
  pChange: number;
};

type MostTraded = {
  symbol: string;
  companyName: string;
  ltp: number;
  change: number;
  pChange: number;
  tradedValue: number;
  volume: number;
  marketId: string;
};

type MarketOverviewResponse = {
  indices: LiveIndex[];
  mostTraded: MostTraded[];
  updatedAt: string;
};

const liveIndexTargets = [
  { label: "NIFTY", marketId: "NSE:NIFTY" },
  { label: "SENSEX", marketId: "BSE:SENSEX" },
  { label: "BANKNIFTY", marketId: "NSE:BANKNIFTY" },
  { label: "MIDCPNIFTY", marketId: "NSE:NIFTY_MID_SELECT" },
];

const OVERVIEW_POLL_MS = 3000;

const formatMoney = (value: number | undefined) => {
  if (typeof value !== "number") return "--";
  return value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
};

const formatPct = (value: number | undefined) => {
  if (typeof value !== "number") return "--";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
};

const formatVolume = (volume: number | undefined) => {
  if (typeof volume !== "number" || volume <= 0) return "Active";
  if (volume >= 10000000) return `${(volume / 10000000).toFixed(2)}Cr`;
  if (volume >= 1000000) return `${(volume / 1000000).toFixed(1)}M`;
  if (volume >= 1000) return `${(volume / 1000).toFixed(0)}k`;
  return volume.toString();
};

export default function DashboardPage() {
  const router = useRouter();
  const [searchInput, setSearchInput] = useState("");
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const [overview, setOverview] = useState<MarketOverviewResponse | null>(null);
  const [overviewError, setOverviewError] = useState("");

  useEffect(() => {
    let isMounted = true;
    let inFlight = false;

    const loadOverview = async () => {
      if (inFlight) {
        return;
      }

      inFlight = true;

      try {
        const response = await fetch(`/api/market-overview?_ts=${Date.now()}`, { cache: "no-store" });
        const data = await response.json();

        if (!isMounted) return;

        if (!response.ok || !data.ok) {
          setOverviewError(data.error ?? "Unable to fetch market overview");
          return;
        }

        setOverview(data.data as MarketOverviewResponse);
        setOverviewError("");
      } catch {
        if (isMounted) {
          setOverviewError("Unable to connect to market feed");
        }
      } finally {
        inFlight = false;
      }
    };

    loadOverview();
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      loadOverview();
    }, OVERVIEW_POLL_MS);

    return () => {
      isMounted = false;
      clearInterval(timer);
    };
  }, []);



  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();

    if (searchInput.trim().length < 2) {
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/tv-search?q=${encodeURIComponent(searchInput.trim())}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await response.json();

        if (!isMounted) return;

        if (response.ok && data.ok) {
          setSuggestions(dedupeSuggestions(data.data as SearchSuggestion[]));
        }
      } catch {
        if (isMounted) {
          setSuggestions([]);
        }
      }
    }, 80);

    return () => {
      isMounted = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [searchInput]);

  const goToChart = (symbol: string, marketId: string) => {
    router.push(`/chart?symbol=${encodeURIComponent(symbol)}&marketId=${encodeURIComponent(marketId)}`);
  };

  const handleSearch = (e: FormEvent) => {
    e.preventDefault();

    const normalized = searchInput.trim().toUpperCase();
    if (!normalized) return;

    const prefixedMarketId = normalized.includes(":") ? normalized : `NSE:${normalized}`;
    goToChart(normalized.replace(/^NSE:/, ""), prefixedMarketId);
    setShowSuggestions(false);
  };


  return (
    <div className="min-h-screen space-y-6 bg-grid-pattern p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Command Center</h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">Brokerage-style market view with live indices and most traded stocks</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <form onSubmit={handleSearch} className="relative flex items-center gap-2">
            <div className="flex min-w-[320px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
              <Search className="h-4 w-4 text-slate-400" />
              <input
                value={searchInput}
                onChange={(e) => {
                  const nextValue = e.target.value;
                  setSearchInput(nextValue);
                  if (nextValue.trim().length < 2) {
                    setSuggestions([]);
                  }
                  setShowSuggestions(true);
                }}
                onFocus={() => setShowSuggestions(true)}
                placeholder="Search stock and open advanced chart"
                className="w-full bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-200"
              />
              {searchInput.trim().length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchInput("");
                    setSuggestions([]);
                    setShowSuggestions(false);
                  }}
                  className="inline-flex h-5 w-5 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {showSuggestions && suggestions.length > 0 && (
              <div className="absolute left-0 top-[calc(100%+4px)] z-30 w-full rounded-lg border border-slate-300 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
                {suggestions.map((item) => (
                  <button
                    key={item.marketId}
                    type="button"
                    onClick={() => goToChart(item.symbol, item.marketId)}
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
            <button
              type="submit"
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
            >
              Open Chart
            </button>
          </form>
          <div className="flex items-center gap-2 rounded-lg border border-slate-300 bg-slate-100 px-3 py-1.5 dark:border-slate-700 dark:bg-slate-800">
            <Clock className="h-3.5 w-3.5 text-slate-500" />
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
              {overview ? `Updated ${new Date(overview.updatedAt).toLocaleTimeString()}` : "Connecting feed"}
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {!overview && !overviewError ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-[104px] rounded-xl border border-slate-300 bg-slate-50/50 p-4 dark:border-slate-800 dark:bg-slate-900/50">
              <div className="h-3 w-16 animate-pulse rounded bg-slate-200 dark:bg-slate-800"></div>
              <div className="mt-2.5 h-7 w-24 animate-pulse rounded bg-slate-200 dark:bg-slate-800"></div>
              <div className="mt-2 h-4 w-20 animate-pulse rounded bg-slate-200 dark:bg-slate-800"></div>
            </div>
          ))
        ) : (
          (overview?.indices ?? []).map((indexItem) => {
            const up = indexItem.pChange >= 0;

            return (
              <button
                key={indexItem.label}
                onClick={() => goToChart(indexItem.label, indexItem.marketId)}
                className="rounded-xl border border-slate-300 bg-white p-4 text-left transition-colors hover:border-blue-300 hover:bg-blue-50/40 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-blue-500/30 dark:hover:bg-slate-800"
              >
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{indexItem.label}</div>
                <div className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{formatMoney(indexItem.ltp)}</div>
                <div className={`mt-1 text-sm font-semibold ${up ? "text-emerald-600" : "text-rose-600"}`}>
                  {formatPct(indexItem.pChange)} <span className="text-xs font-medium">{formatMoney(indexItem.change)}</span>
                </div>
              </button>
            );
          })
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Most traded in market</h2>
          <span className="text-xs text-slate-500 dark:text-slate-400">Live from market feed</span>
        </div>

        {overviewError && <p className="mb-3 text-sm text-rose-600">{overviewError}</p>}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {!overview || (!overview.mostTraded?.length && !overviewError) ? (
            Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-32 rounded-2xl border border-slate-200 bg-slate-50/50 p-4 dark:border-slate-700 dark:bg-slate-900/50">
                <div className="mb-2 flex items-center justify-between">
                  <div className="h-4 w-16 animate-pulse rounded bg-slate-200 dark:bg-slate-800"></div>
                  <div className="h-4 w-12 animate-pulse rounded-full bg-slate-200 dark:bg-slate-800"></div>
                </div>
                <div className="h-3 w-32 animate-pulse rounded bg-slate-200 dark:bg-slate-800"></div>
                <div className="mt-4 h-6 w-20 animate-pulse rounded bg-slate-200 dark:bg-slate-800"></div>
                <div className="mt-2 h-3 w-12 animate-pulse rounded bg-slate-200 dark:bg-slate-800"></div>
              </div>
            ))
          ) : (
            (overview?.mostTraded ?? []).map((stock) => {
              const up = stock.pChange >= 0;

              return (
                <button
                  key={stock.marketId}
                  onClick={() => goToChart(stock.symbol, stock.marketId)}
                  className="rounded-2xl border border-slate-200 bg-white p-4 text-left transition-all hover:border-slate-300 hover:shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-semibold text-slate-900 dark:text-white">{stock.symbol}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      Vol: {formatVolume(stock.volume)}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 line-clamp-1">{stock.companyName}</div>
                  <div className="mt-3 text-xl font-bold text-slate-900 dark:text-white">{formatMoney(stock.ltp)}</div>
                  <div className={`mt-0.5 text-sm font-semibold ${up ? "text-emerald-600" : "text-rose-600"}`}>{formatPct(stock.pChange)}</div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
