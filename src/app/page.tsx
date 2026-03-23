"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  ChevronRight,
  Clock,
  Search,
  Shield,
  Swords,
  Users,
  BarChart3,
  X,
  Activity,
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
  { label: "MIDCPNIFTY", marketId: "NSE:MIDCPNIFTY" },
];

const features = [
  { href: "/war-room", icon: Swords, title: "War Room", desc: "CYRO AI research with source-backed analysis", color: "blue" },
  { href: "/regulatory", icon: Shield, title: "SEBI Shield", desc: "Automated regulatory integrity checks", color: "emerald" },
  { href: "/scoring", icon: BarChart3, title: "RK/PL Scores", desc: "Dual-metric risk and profit scoring", color: "amber" },
  { href: "/alerts", icon: AlertTriangle, title: "Disparity Alerts", desc: "Market hype vs filing fact checker", color: "rose" },
  { href: "/council", icon: Users, title: "Agent Council", desc: "Multi-agent debate and paper trading", color: "cyan" },
  { href: "/paper-trading", icon: Activity, title: "Paper Trading", desc: "AI-Mentored virtual portfolio and reflection journal", color: "indigo" },
];

const colorMap: Record<string, string> = {
  blue: "from-blue-500 to-blue-600",
  emerald: "from-emerald-500 to-emerald-600",
  amber: "from-amber-500 to-amber-600",
  rose: "from-rose-500 to-rose-600",
  cyan: "from-cyan-500 to-cyan-600",
  indigo: "from-indigo-500 to-indigo-600",
};

const colorMapBorder: Record<string, string> = {
  blue: "border-blue-200 dark:border-blue-500/20",
  emerald: "border-emerald-200 dark:border-emerald-500/20",
  amber: "border-amber-200 dark:border-amber-500/20",
  rose: "border-rose-200 dark:border-rose-500/20",
  cyan: "border-cyan-200 dark:border-cyan-500/20",
  indigo: "border-indigo-200 dark:border-indigo-500/20",
};

const colorMapBg: Record<string, string> = {
  blue: "bg-blue-50 dark:bg-blue-500/5",
  emerald: "bg-emerald-50 dark:bg-emerald-500/5",
  amber: "bg-amber-50 dark:bg-amber-500/5",
  rose: "bg-rose-50 dark:bg-rose-500/5",
  cyan: "bg-cyan-50 dark:bg-cyan-500/5",
  indigo: "bg-indigo-50 dark:bg-indigo-500/5",
};

const formatMoney = (value: number | undefined) => {
  if (typeof value !== "number") return "--";
  return value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
};

const formatPct = (value: number | undefined) => {
  if (typeof value !== "number") return "--";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
};

export default function DashboardPage() {
  const router = useRouter();
  const overviewRef = useRef<MarketOverviewResponse | null>(null);
  const livePollCursorRef = useRef(0);
  const livePollInFlightRef = useRef(false);
  const liveMostTradedCursorRef = useRef(0);
  const liveMostTradedInFlightRef = useRef(false);

  const [searchInput, setSearchInput] = useState("");
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const [overview, setOverview] = useState<MarketOverviewResponse | null>(null);
  const [overviewError, setOverviewError] = useState("");

  useEffect(() => {
    overviewRef.current = overview;
  }, [overview]);

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
    const timer = setInterval(loadOverview, 10000);

    return () => {
      isMounted = false;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    const loadLiveIndexTick = async () => {
      if (livePollInFlightRef.current) {
        return;
      }

      livePollInFlightRef.current = true;
      const target = liveIndexTargets[livePollCursorRef.current % liveIndexTargets.length];
      livePollCursorRef.current += 1;

      try {
        const response = await fetch(
          `/api/tv-quote?marketId=${encodeURIComponent(target.marketId)}&_ts=${Date.now()}`,
          { cache: "no-store" }
        );
        const data = await response.json();

        if (!isMounted) {
          return;
        }

        if (!response.ok || !data.ok) {
          return;
        }

        const liveRow: LiveIndex = {
          label: target.label,
          marketId: target.marketId,
          ltp: typeof data.data?.quote?.ltp === "number" ? data.data.quote.ltp : 0,
          change: typeof data.data?.quote?.change === "number" ? data.data.quote.change : 0,
          pChange: typeof data.data?.quote?.pChange === "number" ? data.data.quote.pChange : 0,
        };

        setOverview((prev) => {
          if (!prev) {
            return {
              indices: [liveRow],
              mostTraded: [],
              updatedAt: new Date().toISOString(),
            };
          }

          const mergedIndices = prev.indices.map((item) => (item.marketId === liveRow.marketId ? liveRow : item));
          const hasCurrent = mergedIndices.some((item) => item.marketId === liveRow.marketId);

          return {
            ...prev,
            indices: hasCurrent ? mergedIndices : [...mergedIndices, liveRow],
            updatedAt: new Date().toISOString(),
          };
        });
      } catch {
        // Keep previous ticks if one poll fails.
      } finally {
        livePollInFlightRef.current = false;
      }
    };

    loadLiveIndexTick();
    const timer = setInterval(loadLiveIndexTick, 1000);

    return () => {
      isMounted = false;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    const loadLiveMostTradedTick = async () => {
      if (liveMostTradedInFlightRef.current) {
        return;
      }

      const currentMostTraded = overviewRef.current?.mostTraded ?? [];
      if (!currentMostTraded.length) {
        return;
      }

      liveMostTradedInFlightRef.current = true;
      const target = currentMostTraded[liveMostTradedCursorRef.current % currentMostTraded.length];
      liveMostTradedCursorRef.current += 1;

      try {
        const response = await fetch(
          `/api/tv-quote?marketId=${encodeURIComponent(target.marketId)}&_ts=${Date.now()}`,
          { cache: "no-store" }
        );
        const data = await response.json();

        if (!isMounted || !response.ok || !data.ok) {
          return;
        }

        const nextLtp = typeof data.data?.quote?.ltp === "number" ? data.data.quote.ltp : target.ltp;
        const nextChange = typeof data.data?.quote?.change === "number" ? data.data.quote.change : target.change;
        const nextPChange = typeof data.data?.quote?.pChange === "number" ? data.data.quote.pChange : target.pChange;

        setOverview((prev) => {
          if (!prev) {
            return prev;
          }

          return {
            ...prev,
            mostTraded: prev.mostTraded.map((row) => {
              if (row.marketId !== target.marketId) {
                return row;
              }

              return {
                ...row,
                ltp: nextLtp,
                change: nextChange,
                pChange: nextPChange,
              };
            }),
            updatedAt: new Date().toISOString(),
          };
        });
      } catch {
        // Keep previous values if one poll fails.
      } finally {
        liveMostTradedInFlightRef.current = false;
      }
    };

    loadLiveMostTradedTick();
    const timer = setInterval(loadLiveMostTradedTick, 1000);

    return () => {
      isMounted = false;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    if (searchInput.trim().length < 2) {
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/tv-search?q=${encodeURIComponent(searchInput.trim())}`, {
          cache: "no-store",
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
    }, 200);

    return () => {
      isMounted = false;
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

  const recentAlerts = [
    {
      id: 1,
      title: "Adani Enterprises",
      desc: "News sentiment bullish but filing shows elevated debt/equity ratio",
      severity: "high",
      time: "2m ago",
    },
    {
      id: 2,
      title: "Yes Bank",
      desc: "Director flagged in SEBI debarred list",
      severity: "critical",
      time: "8m ago",
    },
  ];

  const severityColors: Record<string, string> = {
    critical: "bg-red-100 dark:bg-red-500/10 text-red-700 dark:text-red-400 border-red-200 dark:border-red-500/20",
    high: "bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/20",
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
        {(overview?.indices ?? []).map((indexItem) => {
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
        })}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Most traded in market</h2>
          <span className="text-xs text-slate-500 dark:text-slate-400">Live from market feed</span>
        </div>

        {overviewError && <p className="mb-3 text-sm text-rose-600">{overviewError}</p>}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {(overview?.mostTraded ?? []).map((stock) => {
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
                    TV: {Math.round(stock.tradedValue / 10000000)} Cr
                  </span>
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 line-clamp-1">{stock.companyName}</div>
                <div className="mt-3 text-xl font-bold text-slate-900 dark:text-white">{formatMoney(stock.ltp)}</div>
                <div className={`mt-0.5 text-sm font-semibold ${up ? "text-emerald-600" : "text-rose-600"}`}>{formatPct(stock.pChange)}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="rounded-xl border border-slate-300 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Recent Intelligence Alerts</h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Filing-backed alerts from CYRO analysis engine</p>
            </div>
            <Link href="/alerts" className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400">
              View All <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="space-y-2">
            {recentAlerts.map((alert) => (
              <div key={alert.id} className={`flex items-start gap-3 rounded-lg border px-3 py-3 ${severityColors[alert.severity]}`}>
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="flex-1">
                  <div className="text-sm font-semibold">{alert.title}</div>
                  <p className="mt-0.5 text-xs opacity-80">{alert.desc}</p>
                </div>
                <span className="mt-0.5 whitespace-nowrap text-[10px] opacity-60">{alert.time}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h2 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Research Modules</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {features.map((feature) => (
              <Link
                key={feature.href}
                href={feature.href}
                className={`group rounded-xl border p-5 transition-all duration-200 hover:scale-[1.02] hover:shadow-lg ${colorMapBorder[feature.color]} ${colorMapBg[feature.color]} bg-white dark:bg-slate-900`}
              >
                <div className={`mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br ${colorMap[feature.color]}`}>
                  <feature.icon className="h-5 w-5 text-white" />
                </div>
                <h3 className="mb-1 text-sm font-semibold text-slate-900 dark:text-white">{feature.title}</h3>
                <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">{feature.desc}</p>
                <div className="flex items-center gap-1 text-xs font-medium text-blue-600 transition-all group-hover:gap-2 dark:text-blue-400">
                  Open Module <ChevronRight className="h-3 w-3" />
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
