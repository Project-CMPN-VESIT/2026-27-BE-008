"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Film,
  Sparkles,
  TrendingUp,
  TrendingDown,
  Search,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Eye,
  Radio,
  Zap,
  RefreshCw,
  Video,
  Play,
  Copy,
  Check,
  X,
  Type,
} from "lucide-react";
import type { NiftyStockItem, ShortScript } from "@/lib/niftyShortsService";
import NiftyShortVideoModal from "@/components/video-player/NiftyShortVideoModal";

interface MarketSession {
  isLive: boolean;
  statusLabel: string;
  effectiveTradingDate: string;
  previousTradingDate: string;
  istTimeString: string;
}

function safeRenderText(val: any): string {
  if (val === null || val === undefined) return "";
  if (typeof val === "string") return val;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  if (Array.isArray(val)) {
    return val.map((item) => safeRenderText(item)).filter(Boolean).join(". ");
  }
  if (typeof val === "object") {
    if (typeof val.text === "string") return val.text;
    if (typeof val.summary === "string") return val.summary;
    if (typeof val.description === "string") return val.description;
    if (typeof val.message === "string") return val.message;
    if (typeof val.headline === "string") return val.headline;
    return Object.values(val)
      .map((item) => safeRenderText(item))
      .filter(Boolean)
      .join(". ");
  }
  return String(val);
}

export default function NiftyShortsPage() {
  const [stocks, setStocks] = useState<NiftyStockItem[]>([]);
  const [sessionInfo, setSessionInfo] = useState<MarketSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedSector, setSelectedSector] = useState("All");
  const [selectedVerdict, setSelectedVerdict] = useState("All");
  const [activeModalStock, setActiveModalStock] = useState<NiftyStockItem | null>(null);
  const [modalMode, setModalMode] = useState<"teleprompter" | "structured">("teleprompter");
  const [copied, setCopied] = useState(false);
  const [generatingSymbol, setGeneratingSymbol] = useState<string | null>(null);
  const [teleprompterFontSize, setTeleprompterFontSize] = useState<"normal" | "large">("normal");

  // Batch progress state
  const [batchProgress, setBatchProgress] = useState<{
    isRunning: boolean;
    total: number;
    completed: number;
    currentSymbol: string;
    errors: number;
  }>({
    isRunning: false,
    total: 50,
    completed: 0,
    currentSymbol: "",
    errors: 0,
  });

  // Video state
  const [activeVideoStock, setActiveVideoStock] = useState<NiftyStockItem | null>(null);
  const [activeVideoUrl, setActiveVideoUrl] = useState<string | null>(null);
  const [activeVideoBrief, setActiveVideoBrief] = useState<any>(null);
  const [renderingVideoSymbol, setRenderingVideoSymbol] = useState<string | null>(null);
  const [videoBatchProgress, setVideoBatchProgress] = useState<{
    isRunning: boolean;
    total: number;
    completed: number;
    failed: number;
    currentSymbol: string;
  }>({
    isRunning: false,
    total: 50,
    completed: 0,
    failed: 0,
    currentSymbol: "",
  });

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const videoPollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Lock body scroll and handle Escape key when modal is open
  useEffect(() => {
    if (!activeModalStock) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setActiveModalStock(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeModalStock]);

  const fetchStocks = async () => {
    try {
      const res = await fetch("/api/nifty-shorts");
      const json = await res.json();
      if (json.success && json.data) {
        setStocks(json.data.stocks || []);
        if (json.data.market_session) {
          setSessionInfo(json.data.market_session);
        }
      }
    } catch (e) {
      console.error("Failed to load stocks:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStocks();
  }, []);

  // Poll script batch progress
  useEffect(() => {
    const checkBatch = async () => {
      try {
        const res = await fetch("/api/nifty-shorts/batch");
        const json = await res.json();
        if (json.success && json.data) {
          setBatchProgress(json.data);
          if (json.data.isRunning) {
            fetchStocks();
          }
        }
      } catch (e) {
        console.error("Error polling batch:", e);
      }
    };

    if (batchProgress.isRunning) {
      pollIntervalRef.current = setInterval(checkBatch, 2000);
    } else {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    }

    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [batchProgress.isRunning]);

  // Poll video batch progress
  useEffect(() => {
    const checkVideoBatch = async () => {
      try {
        const res = await fetch("/api/nifty-shorts/video/batch");
        const json = await res.json();
        if (json.success && json.data) {
          const isRunning = json.data.status === "running";
          setVideoBatchProgress({
            isRunning,
            total: json.data.total || 50,
            completed: json.data.completed || 0,
            failed: json.data.failed || 0,
            currentSymbol: json.data.current || "",
          });
          if (isRunning) {
            fetchStocks();
          }
        }
      } catch (e) {
        console.error("Error polling video batch:", e);
      }
    };

    if (videoBatchProgress.isRunning) {
      videoPollIntervalRef.current = setInterval(checkVideoBatch, 2500);
    } else {
      if (videoPollIntervalRef.current) {
        clearInterval(videoPollIntervalRef.current);
        videoPollIntervalRef.current = null;
      }
    }

    return () => {
      if (videoPollIntervalRef.current) clearInterval(videoPollIntervalRef.current);
    };
  }, [videoBatchProgress.isRunning]);

  const handleOpenOrGenerateVideo = async (stock: NiftyStockItem, force: boolean = false) => {
    setActiveVideoStock(stock);
    if ((stock as any).video_url) {
      setActiveVideoUrl((stock as any).video_url);
    }

    if ((stock as any).video_url && !force) {
      try {
        const res = await fetch("/api/nifty-shorts/video", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol: stock.symbol, force: false }),
        });
        const json = await res.json();
        if (json.success && json.data) {
          if (json.data.video_brief) setActiveVideoBrief(json.data.video_brief);
          if (json.data.video_url) setActiveVideoUrl(json.data.video_url);
        }
      } catch (err) {
        console.warn("Could not prefetch brief for", stock.symbol, err);
      }
      return;
    }

    setRenderingVideoSymbol(stock.symbol);
    try {
      const res = await fetch("/api/nifty-shorts/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: stock.symbol, force }),
      });
      const json = await res.json();
      if (json.success && json.data) {
        if (json.data.video_url) {
          setActiveVideoUrl(json.data.video_url);
        }
        if (json.data.video_brief) {
          setActiveVideoBrief(json.data.video_brief);
        }
        setStocks((prev) =>
          prev.map((s) =>
            s.symbol === stock.symbol
              ? { ...s, video_url: json.data.video_url }
              : s
          )
        );
      } else {
        alert(json.error || "Failed to generate video with video-engine.");
      }
    } catch (e: any) {
      alert("Error contacting video engine: " + (e.message || String(e)));
    } finally {
      setRenderingVideoSymbol(null);
    }
  };

  const handleStartVideoBatch = async (force: boolean = false) => {
    try {
      const res = await fetch("/api/nifty-shorts/video/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const json = await res.json();
      if (json.success) {
        setVideoBatchProgress((prev) => ({
          ...prev,
          isRunning: true,
          total: json.data?.total || 50,
          completed: 0,
          failed: 0,
        }));
      } else {
        alert(json.error || "Failed to start batch video generation");
      }
    } catch (e: any) {
      alert("Error starting batch video: " + (e.message || String(e)));
    }
  };

  const handleStartBatch = async (forceParam: boolean = false) => {
    const force = typeof forceParam === "boolean" ? forceParam : false;
    try {
      setBatchProgress((prev) => ({ ...prev, isRunning: true, completed: 0 }));
      const res = await fetch("/api/nifty-shorts/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const json = await res.json();
      if (json.success) {
        setBatchProgress(json.data);
      }
    } catch (e) {
      console.error("Failed to start batch:", e);
    }
  };

  const handleGenerateSingle = async (symbol: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setGeneratingSymbol(symbol);
    try {
      const res = await fetch("/api/nifty-shorts/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, force: true }),
      });
      const json = await res.json();
      if (json.success && json.data) {
        setStocks((prev) =>
          prev.map((s) => (s.symbol === symbol ? json.data : s))
        );
        if (activeModalStock?.symbol === symbol) {
          setActiveModalStock(json.data);
        }
      }
    } catch (err) {
      console.error(`Failed to generate ${symbol}:`, err);
    } finally {
      setGeneratingSymbol(null);
    }
  };

  const handleCopyScript = (script: ShortScript, stock: NiftyStockItem) => {
    const text = `🎯 60-SECOND NIFTY SHORT: ${stock.symbol} (${stock.company_name})
Trading Session: ${stock.trading_date || "Latest"} | Verdict: ${safeRenderText(script.verdict)} | Event: ${safeRenderText(script.event_type).toUpperCase()}

[HOOK]
${safeRenderText(script.hook)}

[PRICE ACTION]
${safeRenderText(script.price_action)}

[WHY IT'S MOVING]
${safeRenderText(script.why_moving)}

[TECHNICAL SNAPSHOT]
${safeRenderText(script.technicals)}

[WHAT TO WATCH]
${safeRenderText(script.what_to_watch)}

[DISCLAIMER]
${safeRenderText(script.disclaimer)}`;

    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const sectors = useMemo(() => {
    const s = new Set<string>();
    stocks.forEach((st) => {
      if (st.sector) s.add(st.sector);
    });
    return ["All", ...Array.from(s).sort()];
  }, [stocks]);

  const filteredStocks = useMemo(() => {
    return stocks.filter((s) => {
      const matchSearch =
        s.symbol.toLowerCase().includes(search.toLowerCase()) ||
        s.company_name.toLowerCase().includes(search.toLowerCase());
      const matchSector = selectedSector === "All" || s.sector === selectedSector;
      const matchVerdict =
        selectedVerdict === "All" ||
        (selectedVerdict === "VideosReady"
          ? Boolean((s as any).video_url)
          : s.script?.verdict === selectedVerdict);

      return matchSearch && matchSector && matchVerdict;
    });
  }, [stocks, search, selectedSector, selectedVerdict]);

  const readyCount = stocks.filter((s) => s.status === "ready" && s.script).length;
  const bullishCount = stocks.filter((s) => s.script?.verdict === "Bullish").length;
  const bearishCount = stocks.filter((s) => s.script?.verdict === "Bearish").length;
  const watchlistCount = stocks.filter((s) => s.script?.verdict === "Watchlist").length;
  const videosReadyCount = stocks.filter((s) => Boolean((s as any).video_url)).length;

  return (
    <div className="min-h-screen bg-[#F6F7F9] dark:bg-[#090d16] text-[#0F172A] dark:text-slate-100 font-sans antialiased overflow-x-hidden">
      <main
        className="mx-auto px-4 sm:px-8 pt-6 sm:pt-8 pb-16 flex flex-col gap-6 w-full"
        style={{
          zoom: 0.92,
          width: "108.696%",
          maxWidth: "1461px",
          transformOrigin: "top center",
        }}
      >
        {/* ─── Top Header: Clean, Minimal, Non-congested ─── */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3.5">
            <span className="w-12 h-12 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800/60 grid place-items-center shrink-0 shadow-2xs">
              <Film className="w-5 h-5" strokeWidth={2} />
            </span>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="m-0 text-2xl font-bold tracking-tight text-[#0F172A] dark:text-white">
                  Nifty 50 Shorts
                </h1>
                <span className="px-2.5 py-0.5 border border-slate-300 dark:border-slate-700 rounded-full bg-white dark:bg-slate-800 text-[11px] font-semibold text-blue-700 dark:text-blue-400">
                  DAILY 9:16 SHORTS
                </span>
                {sessionInfo && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    {sessionInfo.effectiveTradingDate}
                  </span>
                )}
              </div>
              <p className="mt-1 mb-0 text-sm text-slate-500 dark:text-slate-400">
                Daily 60-second presenter briefings and AI-narrated vertical video shorts for Nifty 50 stocks.
              </p>
            </div>
          </div>

          {/* Clean Action Buttons */}
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => handleStartBatch(false)}
              disabled={batchProgress.isRunning}
              className={`inline-flex items-center gap-2 h-10 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 text-xs sm:text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer shadow-2xs ${
                batchProgress.isRunning ? "opacity-60 cursor-not-allowed" : ""
              }`}
            >
              <RefreshCw className={`w-3.5 h-3.5 text-blue-600 dark:text-blue-400 ${batchProgress.isRunning ? "animate-spin" : ""}`} />
              <span>{batchProgress.isRunning ? `Updating (${batchProgress.completed}/${batchProgress.total})...` : "Update Scripts"}</span>
            </button>

            <button
              onClick={() => handleStartVideoBatch(false)}
              disabled={videoBatchProgress.isRunning}
              className={`inline-flex items-center gap-2 h-10 px-4 rounded-xl border border-black dark:border-white bg-black dark:bg-white text-white dark:text-black text-xs sm:text-sm font-semibold hover:bg-slate-800 dark:hover:bg-slate-100 transition-all cursor-pointer shadow-xs ${
                videoBatchProgress.isRunning ? "opacity-60 cursor-not-allowed" : ""
              }`}
            >
              {videoBatchProgress.isRunning ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Rendering ({videoBatchProgress.completed}/{videoBatchProgress.total})...</span>
                </>
              ) : (
                <>
                  <Video className="w-3.5 h-3.5" />
                  <span>Render All Videos</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* ─── Minimal Progress Notification (Only when running) ─── */}
        {(videoBatchProgress.isRunning || batchProgress.isRunning) && (
          <div className="p-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xs space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-300 font-medium">
              <span>
                {videoBatchProgress.isRunning ? "Rendering Remotion Videos: " : "Generating Scripts: "}
                <strong className="text-slate-900 dark:text-white font-mono">
                  {videoBatchProgress.isRunning ? videoBatchProgress.currentSymbol : batchProgress.currentSymbol}
                </strong>
              </span>
              <span className="font-mono">
                {videoBatchProgress.isRunning
                  ? `${videoBatchProgress.completed} / ${videoBatchProgress.total}`
                  : `${batchProgress.completed} / ${batchProgress.total}`}
              </span>
            </div>
            <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-600 transition-all duration-300 rounded-full"
                style={{
                  width: `${Math.round(
                    ((videoBatchProgress.isRunning ? videoBatchProgress.completed : batchProgress.completed) /
                      (videoBatchProgress.isRunning ? videoBatchProgress.total : batchProgress.total || 1)) *
                      100
                  )}%`,
                }}
              />
            </div>
          </div>
        )}

        {/* ─── 4 Minimal Stat Cards (Clean, Uncluttered, Essential) ─── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
          <div
            onClick={() => setSelectedVerdict("All")}
            className={`bg-white dark:bg-slate-900 rounded-xl p-4 border transition-all cursor-pointer ${
              selectedVerdict === "All"
                ? "border-black dark:border-white shadow-xs ring-1 ring-black/5"
                : "border-slate-200 dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-600 shadow-2xs"
            }`}
          >
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Scripts Ready</div>
            <div className="mt-1 text-2xl font-bold tracking-tight tabular-nums text-slate-900 dark:text-white">
              {readyCount} <span className="text-xs font-normal text-slate-400">/ {stocks.length}</span>
            </div>
          </div>

          <div
            onClick={() => setSelectedVerdict("Bullish")}
            className={`bg-white dark:bg-slate-900 rounded-xl p-4 border transition-all cursor-pointer ${
              selectedVerdict === "Bullish"
                ? "border-black dark:border-white shadow-xs ring-1 ring-black/5"
                : "border-slate-200 dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-600 shadow-2xs"
            }`}
          >
            <div className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Bullish Setups</div>
            <div className="mt-1 text-2xl font-bold tracking-tight tabular-nums text-slate-900 dark:text-white">
              {bullishCount}
            </div>
          </div>

          <div
            onClick={() => setSelectedVerdict("Bearish")}
            className={`bg-white dark:bg-slate-900 rounded-xl p-4 border transition-all cursor-pointer ${
              selectedVerdict === "Bearish"
                ? "border-black dark:border-white shadow-xs ring-1 ring-black/5"
                : "border-slate-200 dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-600 shadow-2xs"
            }`}
          >
            <div className="text-xs font-medium text-rose-600 dark:text-rose-400">Bearish / Watchlist</div>
            <div className="mt-1 text-2xl font-bold tracking-tight tabular-nums text-slate-900 dark:text-white">
              {bearishCount + watchlistCount}
            </div>
          </div>

          <div
            onClick={() => setSelectedVerdict("VideosReady")}
            className={`bg-white dark:bg-slate-900 rounded-xl p-4 border transition-all cursor-pointer ${
              selectedVerdict === "VideosReady"
                ? "border-black dark:border-white shadow-xs ring-1 ring-black/5"
                : "border-slate-200 dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-600 shadow-2xs"
            }`}
          >
            <div className="text-xs font-medium text-amber-600 dark:text-amber-400">Videos Rendered</div>
            <div className="mt-1 text-2xl font-bold tracking-tight tabular-nums text-slate-900 dark:text-white">
              {videosReadyCount} <span className="text-xs font-normal text-slate-400">/ {stocks.length}</span>
            </div>
          </div>
        </div>

        {/* ─── Search & Segmented Filter Bar ─── */}
        <div className="flex flex-wrap gap-3 items-center justify-between">
          <label className="flex items-center gap-2 h-11 px-3.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl flex-1 max-w-[360px] text-slate-400 focus-within:border-blue-600 focus-within:ring-2 focus-within:ring-blue-100 dark:focus-within:ring-blue-900/40 transition-all shadow-2xs">
            <Search className="w-4 h-4 text-slate-400" />
            <input
              type="search"
              placeholder="Search ticker or company..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="border-0 outline-none flex-1 min-w-0 bg-transparent text-sm text-slate-900 dark:text-white placeholder:text-slate-400"
            />
          </label>

          <div className="flex flex-wrap items-center gap-2">
            {[
              { id: "All", label: "All", count: stocks.length },
              { id: "Bullish", label: "Bullish", count: bullishCount },
              { id: "Bearish", label: "Bearish", count: bearishCount },
              { id: "VideosReady", label: "Videos Ready", count: videosReadyCount },
            ].map((tab) => {
              const active = selectedVerdict === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setSelectedVerdict(tab.id)}
                  className={`inline-flex items-center gap-1.5 h-10 px-3.5 rounded-xl text-xs sm:text-[13px] font-semibold transition-all cursor-pointer ${
                    active
                      ? "bg-black dark:bg-white text-white dark:text-black border border-black dark:border-white shadow-2xs"
                      : "bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 shadow-2xs"
                  }`}
                >
                  <span>{tab.label}</span>
                  <span className={`text-[11px] tabular-nums ${active ? "opacity-75" : "text-slate-500"}`}>
                    {tab.count}
                  </span>
                </button>
              );
            })}

            {/* Sector Selector */}
            <select
              value={selectedSector}
              onChange={(e) => setSelectedSector(e.target.value)}
              className="h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 text-xs sm:text-[13px] font-medium outline-none cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors shadow-2xs"
            >
              {sectors.map((sec) => (
                <option key={sec} value={sec}>
                  {sec === "All" ? "All Sectors" : sec}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* ─── Stock Cards Grid: Clean, Uncongested, Roomy ─── */}
        {loading ? (
          <div className="py-20 text-center text-sm text-slate-500 flex flex-col items-center justify-center gap-2">
            <RefreshCw className="w-5 h-5 animate-spin text-blue-600" />
            <span>Loading daily Nifty 50 briefings...</span>
          </div>
        ) : filteredStocks.length === 0 ? (
          <div className="py-16 text-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 text-sm text-slate-500">
            No stocks matching the current filter.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredStocks.map((stock) => {
              const hasScript = Boolean(stock.script && stock.status === "ready");
              const hasVideo = Boolean((stock as any).video_url);
              const isGenerating = generatingSymbol === stock.symbol;
              const isRenderingVideo = renderingVideoSymbol === stock.symbol;
              const isUp = (stock.change_pct ?? 0) >= 0;
              const verdict = safeRenderText(stock.script?.verdict) || "Neutral";

              return (
                <div
                  key={stock.symbol}
                  className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-600 rounded-2xl p-4 sm:p-5 transition-all shadow-2xs hover:shadow-xs flex flex-col justify-between gap-3.5 group"
                >
                  <div>
                    {/* Top Header: Symbol, Sector, Verdict */}
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-base text-slate-900 dark:text-white group-hover:text-blue-600 transition-colors">
                            {stock.symbol}
                          </span>
                          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                            {stock.sector}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-[200px] mt-0.5" title={stock.company_name}>
                          {stock.company_name}
                        </p>
                      </div>

                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${
                          verdict === "Bullish"
                            ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/60"
                            : verdict === "Bearish"
                            ? "bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-800/60"
                            : "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800/60"
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            verdict === "Bullish" ? "bg-emerald-500" : verdict === "Bearish" ? "bg-rose-500" : "bg-amber-500"
                          }`}
                        />
                        {verdict}
                      </span>
                    </div>

                    {/* Price Snapshot */}
                    <div className="mt-3 flex items-baseline justify-between">
                      <div className="flex items-baseline gap-2">
                        <span className="text-base font-bold tabular-nums text-slate-900 dark:text-white">
                          ₹{stock.price ? stock.price.toLocaleString("en-IN") : "—"}
                        </span>
                        <span
                          className={`text-xs font-semibold tabular-nums ${
                            isUp ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                          }`}
                        >
                          {isUp ? "+" : ""}{stock.change_pct}%
                        </span>
                      </div>
                      {stock.volume_ratio && (
                        <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                          {stock.volume_ratio}× vol
                        </span>
                      )}
                    </div>

                    {/* Clean 1-line Brief Summary (No Congestion) */}
                    {hasScript && stock.script?.hook ? (
                      <p className="mt-2.5 text-xs text-slate-600 dark:text-slate-300 line-clamp-2 leading-relaxed">
                        {safeRenderText(stock.script.hook)}
                      </p>
                    ) : (
                      <p className="mt-2.5 text-xs text-slate-400 italic">
                        Click to generate today&apos;s briefing
                      </p>
                    )}
                  </div>

                  {/* Clean Action Buttons */}
                  <div className="pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          if (hasScript) setActiveModalStock(stock);
                          else handleGenerateSingle(stock.symbol);
                        }}
                        className="h-8 px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-medium hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
                      >
                        <Eye className="w-3.5 h-3.5 text-slate-500" />
                        <span>Script</span>
                      </button>

                      <button
                        onClick={() => handleOpenOrGenerateVideo(stock)}
                        disabled={isRenderingVideo}
                        className={`h-8 px-3 rounded-lg font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs ${
                          hasVideo
                            ? "bg-amber-500 hover:bg-amber-600 text-white"
                            : "border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                        }`}
                      >
                        {isRenderingVideo ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Play className={`w-3 h-3 ${hasVideo ? "fill-current" : ""}`} />
                        )}
                        <span>{hasVideo ? "Watch Video" : "Render Video"}</span>
                      </button>
                    </div>

                    <button
                      onClick={(e) => handleGenerateSingle(stock.symbol, e)}
                      disabled={isGenerating}
                      className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors cursor-pointer rounded-md hover:bg-slate-100 dark:hover:bg-slate-800"
                      title="Regenerate script"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isGenerating ? "animate-spin" : ""}`} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ─── Script Teleprompter / Structured Modal ─── */}
        {activeModalStock && activeModalStock.script && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-950/60 backdrop-blur-md animate-in fade-in duration-200"
            onClick={(e) => {
              if (e.target === e.currentTarget) setActiveModalStock(null);
            }}
          >
            <div
              className="relative w-full max-w-3xl max-h-[88vh] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Top Bar */}
              <div className="shrink-0 px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-slate-900 dark:text-white">
                      {activeModalStock.symbol} Script
                    </h3>
                    <span className="text-xs px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-medium">
                      {activeModalStock.company_name}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Trading Session: {activeModalStock.trading_date || "Today"}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <div className="inline-flex rounded-lg border border-slate-300 dark:border-slate-700 p-0.5 bg-slate-50 dark:bg-slate-800 text-xs font-semibold">
                    <button
                      onClick={() => setModalMode("teleprompter")}
                      className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                        modalMode === "teleprompter"
                          ? "bg-black dark:bg-white text-white dark:text-black shadow-xs"
                          : "text-slate-600 dark:text-slate-400"
                      }`}
                    >
                      Teleprompter
                    </button>
                    <button
                      onClick={() => setModalMode("structured")}
                      className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                        modalMode === "structured"
                          ? "bg-black dark:bg-white text-white dark:text-black shadow-xs"
                          : "text-slate-600 dark:text-slate-400"
                      }`}
                    >
                      Structured
                    </button>
                  </div>

                  {modalMode === "teleprompter" && (
                    <button
                      onClick={() =>
                        setTeleprompterFontSize((prev) => (prev === "normal" ? "large" : "normal"))
                      }
                      className="h-8 px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs font-semibold hover:bg-slate-50 transition-colors cursor-pointer"
                    >
                      {teleprompterFontSize === "large" ? "A-" : "A+"}
                    </button>
                  )}

                  <button
                    onClick={() => handleCopyScript(activeModalStock.script!, activeModalStock)}
                    className="h-8 px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs font-semibold hover:bg-slate-50 transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    {copied ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 text-slate-500" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>

                  <button
                    onClick={() => setActiveModalStock(null)}
                    className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 transition-colors cursor-pointer ml-1"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Modal Body */}
              <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4">
                {modalMode === "teleprompter" ? (
                  <div
                    className={`space-y-4 font-sans leading-relaxed ${
                      teleprompterFontSize === "large" ? "text-lg sm:text-xl" : "text-sm sm:text-base"
                    }`}
                  >
                    <div className="p-3.5 rounded-xl bg-blue-50/60 dark:bg-blue-950/20 border-l-3 border-blue-600">
                      <span className="block text-xs font-bold uppercase tracking-wider text-blue-700 dark:text-blue-400 mb-1">
                        Hook
                      </span>
                      <p className="text-slate-900 dark:text-white font-medium">
                        {safeRenderText(activeModalStock.script.hook)}
                      </p>
                    </div>

                    <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border-l-3 border-slate-400">
                      <span className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
                        Price Action
                      </span>
                      <p className="text-slate-900 dark:text-white font-medium">
                        {safeRenderText(activeModalStock.script.price_action)}
                      </p>
                    </div>

                    <div className="p-3.5 rounded-xl bg-amber-50/60 dark:bg-amber-950/20 border-l-3 border-amber-500">
                      <span className="block text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400 mb-1">
                        Why Moving
                      </span>
                      <p className="text-slate-900 dark:text-white font-medium">
                        {safeRenderText(activeModalStock.script.why_moving)}
                      </p>
                    </div>

                    <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border-l-3 border-slate-400">
                      <span className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
                        Technical Setup
                      </span>
                      <p className="text-slate-900 dark:text-white font-medium">
                        {safeRenderText(activeModalStock.script.technicals)}
                      </p>
                    </div>

                    <div className="p-3.5 rounded-xl bg-indigo-50/60 dark:bg-indigo-950/20 border-l-3 border-indigo-500">
                      <span className="block text-xs font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-400 mb-1">
                        Trade Setup
                      </span>
                      <p className="text-slate-900 dark:text-white font-medium">
                        {safeRenderText(activeModalStock.script.what_to_watch)}
                      </p>
                    </div>

                    <div className="p-3.5 rounded-xl bg-emerald-50/60 dark:bg-emerald-950/20 border-l-3 border-emerald-500">
                      <span className="block text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 mb-1">
                        Verdict
                      </span>
                      <p className="text-slate-900 dark:text-white font-medium">
                        FinPilot verdict on {activeModalStock.symbol} is {safeRenderText(activeModalStock.script.verdict)}.{" "}
                        {safeRenderText(activeModalStock.script.disclaimer)}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3 text-xs sm:text-sm">
                    <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800">
                      <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Hook</div>
                      <p className="text-slate-900 dark:text-white font-medium">{safeRenderText(activeModalStock.script.hook)}</p>
                    </div>
                    <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800">
                      <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Price Momentum</div>
                      <p className="text-slate-900 dark:text-white">{safeRenderText(activeModalStock.script.price_action)}</p>
                    </div>
                    <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800">
                      <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Catalyst</div>
                      <p className="text-slate-900 dark:text-white">{safeRenderText(activeModalStock.script.why_moving)}</p>
                    </div>
                    <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800">
                      <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Technicals</div>
                      <p className="text-slate-900 dark:text-white">{safeRenderText(activeModalStock.script.technicals)}</p>
                    </div>
                    <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800">
                      <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Strategy</div>
                      <p className="text-slate-900 dark:text-white">{safeRenderText(activeModalStock.script.what_to_watch)}</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Modal Bottom Bar */}
              <div className="shrink-0 px-5 py-3 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between text-xs text-slate-500">
                <span>60s Presenter Teleprompter</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      const stock = activeModalStock;
                      setActiveModalStock(null);
                      handleOpenOrGenerateVideo(stock);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-semibold transition-colors cursor-pointer shadow-2xs"
                  >
                    <Play className="w-3 h-3 fill-current" />
                    <span>Watch in Video Player</span>
                  </button>
                  <button
                    onClick={() => setActiveModalStock(null)}
                    className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold cursor-pointer"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ─── 9:16 Vertical Video Player Modal ─── */}
        {activeVideoStock && (
          <NiftyShortVideoModal
            stock={activeVideoStock}
            videoUrl={activeVideoUrl || (activeVideoStock as any).video_url || null}
            videoBrief={activeVideoBrief}
            isRendering={renderingVideoSymbol === activeVideoStock.symbol}
            onClose={() => {
              setActiveVideoStock(null);
              setActiveVideoUrl(null);
              setActiveVideoBrief(null);
            }}
            onRender={(force) => handleOpenOrGenerateVideo(activeVideoStock, force)}
          />
        )}
      </main>
    </div>
  );
}
