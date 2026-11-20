"use client";

import Link from "next/link";
import { CyroBotIcon } from "@/components/cyro-bot-icon";
import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { authenticatedFetch } from "@/lib/authenticated-fetch";
import { ThemeToggle } from "@/components/theme-toggle";
import { formatNumber, formatSigned, sparkPath, useMarketOverview } from "@/lib/use-market-overview";
import {
  Sparkles,
  Shield,
  Search,
  Newspaper,
  Map,
  Layers,
  Trophy,
  CalendarDays,
  Activity,
  Flame,
  ArrowUpRight,
  TrendingUp,
  TrendingDown,
  ArrowRight,
  SlidersHorizontal,
  CheckCircle2,
  BarChart2,
  Building2,
  Cpu,
  Car,
  Pill,
  ShoppingBag,
  Bell,
  LogOut,
  User as UserIcon,
  Briefcase,
} from "lucide-react";

/* ─── 7 Core Indian Indices ─── */
/* ─── Search suggestions (metadata only: prices always come from the live feed) ─── */
const STOCKS_DATABASE = [
  { sym: "RELIANCE", name: "Reliance Industries", sector: "Energy" },
  { sym: "HDFCBANK", name: "HDFC Bank", sector: "Banking" },
  { sym: "TCS", name: "Tata Consultancy Services", sector: "IT" },
  { sym: "INFY", name: "Infosys", sector: "IT" },
  { sym: "TATAMOTORS", name: "Tata Motors", sector: "Auto & EV" },
  { sym: "ITC", name: "ITC Ltd", sector: "FMCG" },
  { sym: "BHARTIARTL", name: "Bharti Airtel", sector: "Telecom" },
  { sym: "ICICIBANK", name: "ICICI Bank", sector: "Banking" },
];

type LiveSearchSuggestion = {
  marketId: string;
  exchange: string;
  symbol: string;
  companyName: string;
  price?: string;
  chg?: string;
  up?: boolean;
};

/* ─── Sector Performance Barometer (values are live; this only maps names to icons) ─── */
const SECTOR_ICONS = { "NIFTY IT": Cpu, "NIFTY BANK": Building2, "NIFTY AUTO": Car, "NIFTY PHARMA": Pill, "NIFTY FMCG": ShoppingBag } as const;

/* ─── Navigation Links (Mapped to respective dashboards) ─── */
const NAV_LINKS = [
  { href: "/home", label: "Home", active: true },
  { href: "/screener", label: "Screener" },
  { href: "/cyro", label: "CYRO AI" },
  { href: "/portfolio", label: "My Portfolio" },
  { href: "/heatmap", label: "Heatmap" },
  { href: "/baskets", label: "AI Baskets" },
  { href: "/paper-trading", label: "Paper Trading" },
];

/* ─── Secondary Platform Modules ─── */
const PLATFORM_MODULES = [
  {
    href: "/baskets",
    icon: Layers,
    title: "AI Thematic Baskets",
    desc: "Algorithmic theme portfolios.",
  },
  {
    href: "/invest-like",
    icon: Trophy,
    title: "Super Investors",
    desc: "Track institutional holdings & bulk deals.",
  },
  {
    href: "/portfolio",
    icon: Briefcase,
    title: "My Portfolio",
    desc: "Holdings, live valuation, and P&L tracking.",
  },
  {
    href: "/results-calendar",
    icon: CalendarDays,
    title: "Earnings Calendar",
    desc: "Quarterly results & investor calls.",
  },
  {
    href: "/paper-trading",
    icon: Activity,
    title: "Simulated Paper Trading",
    desc: "Risk-free trades with live order books.",
  },
  {
    href: "/shorts",
    icon: Flame,
    title: "Nifty Shorts Briefings",
    desc: "60-second AI market intelligence briefings.",
  },
];

export default function HomePage() {
  const router = useRouter();
  const market = useMarketOverview();
  const vix = market?.indices.find((i) => i.name === "India VIX");
  const breadthTotal = market ? market.breadth.advances + market.breadth.declines + market.breadth.unchanged : 0;
  const { user, signOut } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [liveSuggestions, setLiveSuggestions] = useState<LiveSearchSuggestion[]>([]);
  const searchContainerRef = useRef<HTMLDivElement | null>(null);

  // Close search suggestions on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(event.target as Node)
      ) {
        setIsSearchFocused(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Sync display name
  useEffect(() => {
    let active = true;
    setDisplayName(user?.name ?? "");
    if (!user) return () => { active = false; };
    void authenticatedFetch("/api/user/profile")
      .then((res) => res.json())
      .then(({ profile }) => {
        if (active && profile?.display_name) setDisplayName(profile.display_name);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [user?.id, user?.name]);

  // Live stock search from NSE/BSE API
  useEffect(() => {
    let isMounted = true;
    const q = searchQuery.trim();
    if (q.length < 1) {
      setLiveSuggestions([]);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/tv-search?q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
        });
        const data = await res.json();
        if (isMounted && data.ok && Array.isArray(data.data)) {
          setLiveSuggestions(data.data.slice(0, 8));
        }
      } catch {
        if (isMounted) setLiveSuggestions([]);
      }
    }, 80);

    return () => {
      isMounted = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [searchQuery]);

  // Fallback local filtered stocks
  const localFilteredStocks = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return STOCKS_DATABASE.filter(
      (s) =>
        s.sym.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        s.sector.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  // Open the stock's full dashboard page (identical to dashboard search)
  const openStockDashboard = (symbol: string, marketId?: string) => {
    const cleanSym = symbol.replace(/^NSE:|^BSE:/, "").toUpperCase();
    const mId = marketId || (symbol.includes(":") ? symbol : `NSE:${cleanSym}`);
    setIsSearchFocused(false);
    router.push(`/chart?symbol=${encodeURIComponent(cleanSym)}&marketId=${encodeURIComponent(mId)}`);
  };

  // Keyboard Enter handler
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchQuery.trim().toUpperCase();
    if (!q) return;

    if (liveSuggestions.length > 0) {
      const top = liveSuggestions[0];
      openStockDashboard(top.symbol, top.marketId);
      return;
    }

    if (localFilteredStocks.length > 0) {
      const top = localFilteredStocks[0];
      openStockDashboard(top.sym, `NSE:${top.sym}`);
      return;
    }

    const clean = q.replace(/^NSE:|^BSE:/, "");
    const mId = q.includes(":") ? q : `NSE:${clean}`;
    openStockDashboard(clean, mId);
  };

  return (
    <div
      className="min-h-screen bg-white text-slate-900 font-sans antialiased selection:bg-blue-100 selection:text-blue-900 w-full"
      style={{ zoom: 1.05 }}
    >

      {/* ─────────────────────────────────────────────────────────────
          HERO SECTION with User-Provided Candlestick Background
          (Centered with optical upward shift and generous inter-line breathing room)
      ───────────────────────────────────────────────────────────── */}
      <section className="relative z-30 min-h-[calc(100vh-96px)] flex flex-col justify-center items-center pt-6 pb-14 sm:pt-8 sm:pb-18 px-4 sm:px-6 border-b border-slate-200 bg-gradient-to-b from-white via-slate-50/40 to-slate-100/50">

        {/* Subtle Candlestick Background */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden flex items-end justify-center select-none opacity-20">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/market-chart-bg.webp"
            alt=""
            className="w-full h-auto min-h-[75%] object-cover object-bottom"
          />
        </div>

        <div className="relative max-w-6xl mx-auto px-6 text-center w-full -translate-y-4 sm:-translate-y-6">

          {/* Top Platform Capability Pill Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-50/90 border border-blue-200/80 text-blue-700 text-xs sm:text-[13px] font-semibold mb-6 sm:mb-7 shadow-2xs">
            <span className="w-2 h-2 rounded-full bg-blue-600 animate-pulse shrink-0" />
            <span>AI-Powered Equity Research and Investment Platform.</span>
          </div>

          {/* Main Headline strictly in a single line (Research in black, Deeper. in blue, Invest in black, Smarter. in blue) */}
          <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl xl:text-[64px] font-black tracking-tight leading-[1.12] mb-5 sm:mb-6 whitespace-nowrap">
            <span className="text-slate-900">Research </span>
            <span className="text-blue-600">Deeper. </span>
            <span className="text-slate-900">Invest </span>
            <span className="text-blue-600">Smarter.</span>
          </h1>

          {/* Tagline: Entire line in grey with generous breathing room in a single line */}
          <p className="text-lg sm:text-xl md:text-2xl lg:text-3xl font-bold tracking-tight text-slate-500 mb-10 sm:mb-11 whitespace-nowrap">
            Intelligence That Goes Beyond the Market.
          </p>

          {/* Search Engine Area */}
          <div className="max-w-3xl mx-auto">

            {/* The relative container for search input + attached dropdown */}
            <div
              ref={searchContainerRef}
              className="relative w-full"
              onClick={() => {
                if (searchQuery.trim().length > 0) {
                  setIsSearchFocused(true);
                }
              }}
            >

              {/* Search Input Box with dark border & luminous glow on focus */}
              <form onSubmit={handleSearchSubmit} className="relative w-full">
                <div
                  style={
                    isSearchFocused
                      ? {
                        borderColor: '#1e40af',
                        boxShadow: '0 0 0 3.5px rgba(30, 64, 175, 0.45), 0 0 35px rgba(37, 99, 235, 0.35)',
                      }
                      : undefined
                  }
                  className={`flex items-center bg-white rounded-2xl border transition-all duration-200 ${isSearchFocused
                    ? "border-blue-800"
                    : "border-slate-300 hover:border-slate-400 shadow-sm"
                    } px-6 py-4`}
                >
                  <Search className={`w-5 h-5 shrink-0 mr-3.5 transition-colors ${isSearchFocused ? "text-blue-700" : "text-blue-600"}`} />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setIsSearchFocused(true);
                    }}
                    onFocus={() => setIsSearchFocused(true)}
                    onClick={() => setIsSearchFocused(true)}
                    placeholder="Search stocks (e.g. RELIANCE, TCS, HDFCBANK) to open dashboard..."
                    className="w-full text-slate-900 placeholder-slate-400 text-base sm:text-lg outline-none bg-transparent font-medium"
                  />
                  {searchQuery ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSearchQuery("");
                        setLiveSuggestions([]);
                        setIsSearchFocused(false);
                      }}
                      className="text-xs text-slate-400 hover:text-slate-600 px-2 py-1 font-semibold"
                    >
                      Clear
                    </button>
                  ) : (
                    <div className="hidden sm:flex items-center space-x-1 bg-slate-100 text-slate-500 text-[11px] font-mono px-2 py-1 rounded border border-slate-200">
                      <span>⌘</span>
                      <span>K</span>
                    </div>
                  )}
                </div>
              </form>

              {/* Instant Search Dropdown Results — Professional Institutional UI (Light grey hover, persistent prices, Open Dashboard) */}
              {isSearchFocused && searchQuery.trim().length > 0 && (
                <div className="absolute left-0 right-0 top-full mt-2.5 bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden z-50 text-left divide-y divide-slate-100 animate-in fade-in zoom-in-95 duration-100 max-h-[440px] overflow-y-auto font-sans">
                  {/* If live suggestions from API available */}
                  {liveSuggestions.length > 0 ? (
                    liveSuggestions.map((item) => {
                      const cleanSym = item.symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
                      const sector = STOCKS_DATABASE.find((s) => s.sym.toUpperCase() === cleanSym)?.sector;
                      const displayPrice = item.price || "—";
                      const displayChg = item.chg || "";
                      const isUp = item.up !== undefined ? item.up : true;

                      return (
                        <Link
                          key={`${item.exchange}:${item.symbol}`}
                          href={`/chart?symbol=${encodeURIComponent(item.symbol)}&marketId=${encodeURIComponent(item.marketId)}`}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            openStockDashboard(item.symbol, item.marketId);
                          }}
                          onClick={(e) => {
                            e.preventDefault();
                            openStockDashboard(item.symbol, item.marketId);
                          }}
                          className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-slate-100/90 transition-colors text-left group cursor-pointer"
                        >
                          <div className="flex items-center space-x-3.5 min-w-0 font-sans">
                            {/* Stock Initial Badge */}
                            <div className="w-10 h-10 rounded-xl bg-slate-100 border border-slate-200/90 group-hover:bg-slate-200 group-hover:text-slate-900 text-slate-700 flex items-center justify-center font-sans font-bold text-xs tracking-wider shrink-0 transition-colors shadow-2xs">
                              {item.symbol.slice(0, 2)}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center space-x-2">
                                <span className="font-bold text-slate-900 font-sans text-sm tracking-tight">
                                  {item.symbol}
                                </span>
                                <span className="text-[10px] font-sans font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200/80 uppercase">
                                  {item.exchange || "NSE"}
                                </span>
                                {sector && (
                                  <span className="text-[11px] text-slate-400 font-sans hidden sm:inline">• {sector}</span>
                                )}
                              </div>
                              <p className="text-xs text-slate-500 font-sans font-normal truncate mt-0.5">
                                {item.companyName}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center space-x-4 shrink-0 ml-4 font-sans">
                            <div className="text-right font-sans">
                              <div className="text-sm font-bold text-slate-900 tabular-nums">{displayPrice}</div>
                              <div className={`text-xs font-semibold tabular-nums ${isUp ? "text-emerald-600" : "text-rose-600"}`}>
                                {displayChg}
                              </div>
                            </div>
                            <div className="flex items-center space-x-1.5 text-xs font-sans font-medium text-slate-700 bg-white group-hover:bg-slate-200/90 group-hover:border-slate-300 group-hover:text-slate-900 px-3 py-1.5 rounded-lg border border-slate-200 transition-colors shadow-2xs">
                              <span>Open Dashboard</span>
                              <ArrowRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-700 transition-transform group-hover:translate-x-0.5" />
                            </div>
                          </div>
                        </Link>
                      );
                    })
                  ) : localFilteredStocks.length > 0 ? (
                    localFilteredStocks.map((stock) => {
                      const displayPrice = "—";
                      const displayChg = "";
                      const isUp = true;

                      return (
                        <Link
                          key={stock.sym}
                          href={`/chart?symbol=${encodeURIComponent(stock.sym)}&marketId=NSE:${encodeURIComponent(stock.sym)}`}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            openStockDashboard(stock.sym, `NSE:${stock.sym}`);
                          }}
                          onClick={(e) => {
                            e.preventDefault();
                            openStockDashboard(stock.sym, `NSE:${stock.sym}`);
                          }}
                          className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-slate-100/90 transition-colors text-left group cursor-pointer"
                        >
                          <div className="flex items-center space-x-3.5 min-w-0 font-sans">
                            <div className="w-10 h-10 rounded-xl bg-slate-100 border border-slate-200/90 group-hover:bg-slate-200 group-hover:text-slate-900 text-slate-700 flex items-center justify-center font-sans font-bold text-xs tracking-wider shrink-0 transition-colors shadow-2xs">
                              {stock.sym.slice(0, 2)}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center space-x-2">
                                <span className="font-bold text-slate-900 font-sans text-sm tracking-tight">
                                  {stock.sym}
                                </span>
                                <span className="text-[10px] font-sans font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200/80 uppercase">
                                  NSE
                                </span>
                                <span className="text-[11px] text-slate-400 font-sans hidden sm:inline">• {stock.sector}</span>
                              </div>
                              <p className="text-xs text-slate-500 font-sans font-normal truncate mt-0.5">
                                {stock.name}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center space-x-4 shrink-0 ml-4 font-sans">
                            <div className="text-right font-sans">
                              <div className="text-sm font-bold text-slate-900 tabular-nums">{displayPrice}</div>
                              <div className={`text-xs font-semibold tabular-nums ${isUp ? "text-emerald-600" : "text-rose-600"}`}>
                                {displayChg}
                              </div>
                            </div>
                            <div className="flex items-center space-x-1.5 text-xs font-sans font-medium text-slate-700 bg-white group-hover:bg-slate-200/90 group-hover:border-slate-300 group-hover:text-slate-900 px-3 py-1.5 rounded-lg border border-slate-200 transition-colors shadow-2xs">
                              <span>Open Dashboard</span>
                              <ArrowRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-700 transition-transform group-hover:translate-x-0.5" />
                            </div>
                          </div>
                        </Link>
                      );
                    })
                  ) : (
                    <div className="px-5 py-6 text-center text-xs font-sans text-slate-500">
                      No matching securities found. Press Enter or search another stock.
                    </div>
                  )}
                </div>
              )}

            </div>

            {/* Trending Stock Badges — Only visible when NOT searching, so it never takes that space */}
            {!searchQuery.trim() && (
              <div className="mt-5 flex items-center justify-center gap-2.5 text-xs flex-nowrap whitespace-nowrap overflow-x-auto no-scrollbar">
                <span className="text-slate-400 font-medium mr-1 shrink-0">Trending:</span>
                {(market?.trending.length ? market.trending : STOCKS_DATABASE.slice(0, 4).map((x) => ({ name: x.sym, pct: null as number | null }))).map((stock) => (
                  <button
                    key={stock.name}
                    type="button"
                    onClick={() => openStockDashboard(stock.name, `NSE:${stock.name}`)}
                    className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 rounded-full bg-white border border-slate-200 hover:border-slate-400 hover:bg-slate-50 text-slate-700 transition-colors shadow-2xs font-sans shrink-0 cursor-pointer"
                    title={`Open ${stock.name} dashboard`}
                  >
                    <span className="font-semibold text-slate-900">{stock.name}</span>
                    {stock.pct !== null && (
                      <span className={`text-[11px] font-medium tabular-nums ${stock.pct >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                        {formatSigned(stock.pct)}%
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}

          </div>

        </div>
      </section>

      {/* ─────────────────────────────────────────────────────────────
          4. MARKET OVERVIEW BAROMETER: Live Sparklines of Key Benchmarks
      ───────────────────────────────────────────────────────────── */}
      <section className="max-w-7xl mx-auto px-6 py-20 relative z-10">

        {/* Section Header */}
        <div className="flex items-center justify-between mb-8 pb-4 border-b border-slate-200">
          <div>
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
              Benchmark Indices &amp; Sector Pulse
            </h2>
          </div>
          <div className="flex items-center space-x-2 text-xs font-medium text-slate-500">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
            <span>Live Feeds</span>
          </div>
        </div>

        {/* Primary 4 Benchmarks Cards with Sparklines */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
          {(market?.indices.length
            ? market.indices.slice(0, 4).map((i) => ({
                name: i.name,
                val: formatNumber(i.value),
                pct: `${formatSigned(i.pct)}%`,
                change: formatSigned(i.change),
                up: i.pct >= 0,
                high: i.high ? formatNumber(i.high) : "—",
                low: i.low ? formatNumber(i.low) : "—",
                sparkline: sparkPath(i.spark),
              }))
            : ["Nifty 50", "BSE Sensex", "Nifty Bank", "India VIX"].map((name) => ({
                name, val: "—", pct: "", change: "—", up: true, high: "—", low: "—", sparkline: "",
              }))
          ).map((idx) => (
            <div
              key={idx.name}
              className="bg-white rounded-xl border border-slate-200 p-4 shadow-2xs hover:shadow-md hover:border-slate-300 transition-all flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                  <span className="font-bold text-slate-700">{idx.name}</span>
                </div>

                <div className="flex items-baseline space-x-2">
                  <span className="text-2xl font-bold font-mono tracking-tight text-slate-900">
                    {idx.val}
                  </span>
                  <span
                    className={`inline-flex items-center text-xs font-mono font-bold ${idx.up ? "text-emerald-700" : "text-rose-700"
                      }`}
                  >
                    {idx.pct && (idx.up ? <TrendingUp className="w-3.5 h-3.5 mr-0.5" /> : <TrendingDown className="w-3.5 h-3.5 mr-0.5" />)}
                    {idx.pct}
                  </span>
                </div>

                <div className="text-[11px] font-mono text-slate-500 mt-0.5">
                  Pts: {idx.change}
                </div>
              </div>

              {/* Sparkline Graphic */}
              <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                <div className="w-32 h-8">
                  <svg className="w-full h-full overflow-visible" viewBox="0 0 200 40">
                    <path
                      d={idx.sparkline}
                      fill="none"
                      stroke={idx.up ? "#059669" : "#dc2626"}
                      strokeWidth="2.2"
                      strokeLinecap="round"
                    />
                  </svg>
                </div>
                <div className="text-right text-[10px] font-mono text-slate-600">
                  <div>H: {idx.high}</div>
                  <div>L: {idx.low}</div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Visual Sector Barometer & Market Breadth */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 bg-slate-50 rounded-2xl border border-slate-200 p-6">

          {/* Sector Barometer */}
          <div className="lg:col-span-2">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wide">
                Sector Momentum
              </h3>
              <Link href="/heatmap" className="text-xs font-semibold text-blue-600 hover:text-blue-800">
                Heatmap →
              </Link>
            </div>
            <div className="space-y-3">
              {(market?.sectors.length
                ? market.sectors.map((x) => ({
                    name: x.name,
                    icon: SECTOR_ICONS[x.name as keyof typeof SECTOR_ICONS] ?? Cpu,
                    chg: `${formatSigned(x.pct)}%`,
                    up: x.pct >= 0,
                    width: `${Math.min(100, Math.max(6, 20 + Math.abs(x.pct) * 25))}%`,
                  }))
                : (Object.keys(SECTOR_ICONS) as Array<keyof typeof SECTOR_ICONS>).map((name) => ({
                    name, icon: SECTOR_ICONS[name], chg: "—", up: true, width: "6%",
                  }))
              ).map((sec) => {
                const Icon = sec.icon;
                return (
                  <div key={sec.name} className="flex items-center space-x-3 text-xs font-mono">
                    <div className="w-28 flex items-center space-x-1.5 font-sans font-semibold text-slate-700 shrink-0">
                      <Icon className="w-3.5 h-3.5 text-slate-500" />
                      <span>{sec.name}</span>
                    </div>
                    <div className="flex-1 bg-slate-200/80 rounded-full h-3 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${sec.up ? "bg-emerald-600" : "bg-rose-600"
                          }`}
                        style={{ width: sec.width }}
                      />
                    </div>
                    <span className={`w-14 text-right font-bold ${sec.up ? "text-emerald-700" : "text-rose-700"}`}>
                      {sec.chg}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Market Breadth Card */}
          <div className="border-t lg:border-t-0 lg:border-l border-slate-200 pt-4 lg:pt-0 lg:pl-6 flex flex-col justify-between">
            <div>
              <div className="text-xs font-bold text-slate-800 uppercase tracking-wide mb-3">
                Market Breadth{market ? ` · ${market.breadth.universe}` : ""}
              </div>

              {/* Breadth Bar */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs font-mono font-semibold">
                  <span className="text-emerald-700">{market ? `${market.breadth.advances} Advances` : "— Advances"}</span>
                  <span className="text-rose-700">{market ? `${market.breadth.declines} Declines` : "— Declines"}</span>
                </div>
                <div className="w-full h-3 rounded-full overflow-hidden flex bg-slate-200">
                  {breadthTotal > 0 && (
                    <>
                      <div className="bg-emerald-600 h-full" style={{ width: `${(market!.breadth.advances / breadthTotal) * 100}%` }} />
                      <div className="bg-slate-300 h-full" style={{ width: `${(market!.breadth.unchanged / breadthTotal) * 100}%` }} />
                      <div className="bg-rose-600 h-full" style={{ width: `${(market!.breadth.declines / breadthTotal) * 100}%` }} />
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-4 pt-4 border-t border-slate-200 flex items-center justify-between text-xs">
              <span className="text-slate-600 font-medium">India VIX:</span>
              <span className="font-mono font-bold text-slate-800">
                {vix ? `${formatNumber(vix.value)} (${formatSigned(vix.pct)}%)` : "—"}
              </span>
            </div>
          </div>

        </div>

      </section>

      {/* ─────────────────────────────────────────────────────────────
          5. CORE PILLARS — Visual Previews with Minimal Text
      ───────────────────────────────────────────────────────────── */}
      <section className="max-w-7xl mx-auto px-6 py-14 sm:py-16 border-t border-slate-200/80">
        <div className="mb-8">
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">
            Institutional Modules
          </h2>
        </div>

        {/* 4 Flagships Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-14">

          {/* Module 1: CYRO AI */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs hover:border-blue-400 hover:shadow-md transition-all group flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center space-x-2.5">
                  <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-200 text-blue-600 flex items-center justify-center">
                    <CyroBotIcon className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900 text-base">CYRO AI Analyst</h3>
                    <div className="text-xs text-slate-500">Autonomous Equity Research</div>
                  </div>
                </div>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                  FLAGSHIP
                </span>
              </div>

              {/* Minimal Visual Preview Box */}
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5 font-mono text-xs space-y-2 mb-4">
                <div className="flex items-center justify-between text-slate-500 border-b border-slate-200 pb-2">
                  <span className="font-bold text-slate-700 font-sans">RELIANCE Investigation</span>
                  <span className="text-emerald-700 font-semibold flex items-center text-[11px]">
                    <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Bullish (92%)
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div className="bg-white p-2 rounded border border-slate-200">
                    <span className="text-slate-500 block">Debt/Equity</span>
                    <span className="font-bold text-slate-900">0.38x (Safe)</span>
                  </div>
                  <div className="bg-white p-2 rounded border border-slate-200">
                    <span className="text-slate-500 block">Audit Red Flags</span>
                    <span className="font-bold text-emerald-700">0 Identified</span>
                  </div>
                </div>
              </div>
            </div>

            <Link
              href="/cyro"
              className="inline-flex items-center justify-between text-xs font-semibold text-blue-600 group-hover:text-blue-800 pt-2 border-t border-slate-100"
            >
              <span>Launch CYRO Engine</span>
              <ArrowRight className="w-3.5 h-3.5 ml-1 transition-transform group-hover:translate-x-1" />
            </Link>
          </div>

          {/* Module 2: Stock Screener */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs hover:border-blue-400 hover:shadow-md transition-all group flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center space-x-2.5">
                  <div className="w-8 h-8 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-600 flex items-center justify-center">
                    <Search className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900 text-base">Multi-Factor Screener</h3>
                    <div className="text-xs text-slate-500">5,000+ Stocks Filtered</div>
                  </div>
                </div>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                  REAL-TIME
                </span>
              </div>

              {/* Minimal Visual Preview Box */}
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5 font-mono text-xs space-y-2 mb-4">
                <div className="flex items-center justify-between text-slate-500 border-b border-slate-200 pb-2">
                  <span className="font-sans font-bold text-slate-700">Screen: High ROCE</span>
                  <SlidersHorizontal className="w-3.5 h-3.5 text-slate-400" />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <span className="bg-white px-2 py-0.5 rounded border border-slate-200 text-slate-700 text-[10px]">
                    ROCE &gt; 25%
                  </span>
                  <span className="bg-white px-2 py-0.5 rounded border border-slate-200 text-slate-700 text-[10px]">
                    Debt/Eq &lt; 0.2
                  </span>
                  <span className="bg-white px-2 py-0.5 rounded border border-slate-200 text-slate-700 text-[10px]">
                    PEG &lt; 1.5
                  </span>
                </div>
              </div>
            </div>

            <Link
              href="/screener"
              className="inline-flex items-center justify-between text-xs font-semibold text-blue-600 group-hover:text-blue-800 pt-2 border-t border-slate-100"
            >
              <span>Explore Screener</span>
              <ArrowRight className="w-3.5 h-3.5 ml-1 transition-transform group-hover:translate-x-1" />
            </Link>
          </div>

          {/* Module 3: My Portfolio */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs hover:border-blue-400 hover:shadow-md transition-all group flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center space-x-2.5">
                  <div className="w-8 h-8 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-600 flex items-center justify-center">
                    <Briefcase className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900 text-base">My Portfolio</h3>
                    <div className="text-xs text-slate-500">Holdings &amp; P&amp;L Tracking</div>
                  </div>
                </div>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                  PORTFOLIO
                </span>
              </div>

              {/* Minimal Visual Preview Box */}
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5 font-mono text-xs space-y-2 mb-4">
                <div className="bg-white p-2 rounded border border-slate-200 space-y-0.5">
                  <div className="flex justify-between text-slate-800 font-semibold">
                    <span>Portfolio Valuation</span>
                    <span className="text-emerald-700">+₹18,42,390</span>
                  </div>
                  <div className="flex justify-between text-[10px] text-slate-500">
                    <span>Today's Gain</span>
                    <span className="text-emerald-600 font-semibold">+1.12% (₹12,480)</span>
                  </div>
                </div>
              </div>
            </div>

            <Link
              href="/portfolio"
              className="inline-flex items-center justify-between text-xs font-semibold text-blue-600 group-hover:text-blue-800 pt-2 border-t border-slate-100"
            >
              <span>Open My Portfolio</span>
              <ArrowRight className="w-3.5 h-3.5 ml-1 transition-transform group-hover:translate-x-1" />
            </Link>
          </div>

          {/* Module 4: Sector Heatmap */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs hover:border-blue-400 hover:shadow-md transition-all group flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center space-x-2.5">
                  <div className="w-8 h-8 rounded-lg bg-slate-100 border border-slate-300 text-slate-700 flex items-center justify-center">
                    <Map className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900 text-base">Market Heatmap</h3>
                    <div className="text-xs text-slate-500">Visual Momentum Matrix</div>
                  </div>
                </div>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                  VISUAL
                </span>
              </div>

              {/* Mini Heatmap Grid */}
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 font-mono text-xs mb-4">
                <div className="grid grid-cols-4 gap-1.5 h-16">
                  <div className="col-span-2 row-span-2 bg-emerald-100 border border-emerald-300 rounded p-1 flex flex-col justify-between">
                    <span className="font-bold text-emerald-900 text-[10px]">RELIANCE</span>
                    <span className="font-bold text-emerald-700 text-xs">+1.12%</span>
                  </div>
                  <div className="bg-emerald-50 border border-emerald-200 rounded p-1 flex flex-col justify-between">
                    <span className="font-bold text-emerald-900 text-[9px]">HDFC</span>
                    <span className="text-emerald-700 text-[9px]">+0.31%</span>
                  </div>
                  <div className="bg-rose-50 border border-rose-200 rounded p-1 flex flex-col justify-between">
                    <span className="font-bold text-rose-900 text-[9px]">TCS</span>
                    <span className="text-rose-700 text-[9px]">-0.47%</span>
                  </div>
                </div>
              </div>
            </div>

            <Link
              href="/heatmap"
              className="inline-flex items-center justify-between text-xs font-semibold text-blue-600 group-hover:text-blue-800 pt-2 border-t border-slate-100"
            >
              <span>Explore Heatmap</span>
              <ArrowRight className="w-3.5 h-3.5 ml-1 transition-transform group-hover:translate-x-1" />
            </Link>
          </div>

        </div>

        {/* ─────────────────────────────────────────────────────────────
            6. ECOSYSTEM MODULES (Minimal & Punchy)
        ───────────────────────────────────────────────────────────── */}
        <div className="border-t border-slate-200 pt-12">
          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-5">
            Platform Capabilities
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {PLATFORM_MODULES.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="bg-white rounded-xl border border-slate-200 p-3 hover:border-slate-300 hover:shadow-xs transition-all flex items-center space-x-3 group"
                >
                  <div className="w-7 h-7 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center shrink-0 group-hover:bg-blue-50 group-hover:text-blue-600 transition-colors">
                    <Icon className="w-3.5 h-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-xs text-slate-900 group-hover:text-blue-600 transition-colors">
                        {item.title}
                      </span>
                      <ArrowUpRight className="w-3 h-3 text-slate-400 group-hover:text-blue-600 transition-colors" />
                    </div>
                    <p className="text-[11px] text-slate-500 truncate mt-0.5">
                      {item.desc}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>

      </section>

      {/* ─────────────────────────────────────────────────────────────
          7. LIGHT CTA BANNER (Minimal)
      ───────────────────────────────────────────────────────────── */}
      <section className="max-w-7xl mx-auto px-6 py-14 sm:py-16 border-t border-slate-200/80">
        <div className="bg-gradient-to-r from-blue-50 via-slate-50 to-blue-50/40 rounded-2xl border border-blue-200/80 p-6 sm:p-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <div>
            <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">
              Analyze Any Indian Company with CYRO
            </h2>
            <p className="text-slate-600 text-xs mt-1">
              Autonomous research and forensic audit checks in seconds.
            </p>
          </div>

          <div className="flex items-center space-x-3 shrink-0">
            <Link
              href="/cyro"
              className="inline-flex items-center text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 px-4 py-2.5 rounded-xl shadow-xs transition-colors"
            >
              <CyroBotIcon className="w-4 h-4 mr-1.5" />
              Launch CYRO AI
            </Link>
            <Link
              href="/screener"
              className="inline-flex items-center text-xs font-semibold text-slate-700 hover:text-slate-900 bg-white border border-slate-300 hover:border-slate-400 px-3.5 py-2.5 rounded-xl transition-colors"
            >
              Open Screener
            </Link>
          </div>
        </div>
      </section>

      {/* ─────────────────────────────────────────────────────────────
          8. CLEAN INSTITUTIONAL FOOTER
      ───────────────────────────────────────────────────────────── */}
      <footer className="border-t border-slate-200 bg-slate-50/60 pt-14 pb-12 text-slate-600 text-xs">
        <div className="max-w-7xl mx-auto px-6">

          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 pb-8 border-b border-slate-200">

            <div className="md:col-span-1 space-y-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/finpilot-brand-logo-transparent.webp"
                alt="FinPilot"
                className="h-8 w-auto object-contain"
              />
              <p className="text-xs text-slate-500 leading-relaxed">
                Autonomous Indian equity intelligence grounded in NSE/BSE filings.
              </p>
            </div>

            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-slate-900 mb-2">
                Research
              </div>
              <ul className="space-y-1.5 text-xs text-slate-500">
                <li><Link href="/screener" className="hover:text-blue-600 transition-colors">Stock Screener</Link></li>
                <li><Link href="/cyro" className="hover:text-blue-600 transition-colors">CYRO AI Analyst</Link></li>
                <li><Link href="/portfolio" className="hover:text-blue-600 transition-colors">My Portfolio</Link></li>
                <li><Link href="/heatmap" className="hover:text-blue-600 transition-colors">Market Heatmap</Link></li>
              </ul>
            </div>

            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-slate-900 mb-2">
                Trading
              </div>
              <ul className="space-y-1.5 text-xs text-slate-500">
                <li><Link href="/baskets" className="hover:text-blue-600 transition-colors">AI Baskets</Link></li>
                <li><Link href="/invest-like" className="hover:text-blue-600 transition-colors">Super Investors</Link></li>
                <li><Link href="/paper-trading" className="hover:text-blue-600 transition-colors">Paper Trading</Link></li>
                <li><Link href="/results-calendar" className="hover:text-blue-600 transition-colors">Earnings Calendar</Link></li>
              </ul>
            </div>

            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-slate-900 mb-2">
                Platform
              </div>
              <ul className="space-y-1.5 text-xs text-slate-500">
                <li><Link href="/" className="hover:text-blue-600 transition-colors">Dashboard</Link></li>
                <li><Link href="/portfolio" className="hover:text-blue-600 transition-colors">Portfolio Analytics</Link></li>
                <li><Link href="/shorts" className="hover:text-blue-600 transition-colors">Nifty Shorts</Link></li>
                <li><Link href="/profile" className="hover:text-blue-600 transition-colors">Settings</Link></li>
              </ul>
            </div>

          </div>

          <div className="pt-6 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 gap-2">
            <div>&copy; {new Date().getFullYear()} FinPilot. Powered by primary NSE &amp; BSE filings.</div>
            <div className="flex items-center space-x-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span>Live Market Feeds</span>
            </div>
          </div>

        </div>
      </footer>

    </div>
  );
}
