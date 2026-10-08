"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Flame,
  RefreshCw,
  Sparkles,
  Copy,
  Check,
  Clock,
  TrendingUp,
  TrendingDown,
  FileText,
  X,
  Search,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Tv,
  Eye,
  SlidersHorizontal,
  Database,
  Calendar,
  Radio,
  Zap,
  Type,
  Film,
  Play,
  Video,
  Download
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
  const [selectedStatus, setSelectedStatus] = useState("All");
  const [selectedVerdict, setSelectedVerdict] = useState("All");
  const [activeModalStock, setActiveModalStock] = useState<NiftyStockItem | null>(null);
  const [modalMode, setModalMode] = useState<"teleprompter" | "structured">("teleprompter");
  const [copied, setCopied] = useState(false);
  const [generatingSymbol, setGeneratingSymbol] = useState<string | null>(null);
  const [teleprompterFontSize, setTeleprompterFontSize] = useState<"normal" | "large">("normal");

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

  // Load initial stocks and session info
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

  // Poll batch progress
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

  // Handle single stock video preview / render
  const handleOpenOrGenerateVideo = async (stock: NiftyStockItem, force: boolean = false) => {
    setActiveVideoStock(stock);
    if ((stock as any).video_url) {
      setActiveVideoUrl((stock as any).video_url);
    }

    // If video is already saved and force is false, user clicked Watch/Preview.
    // Modal opens immediately; fetch brief in background so live engine has scene data.
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

    // Force re-render or first-time render requested
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
        // Update stock in state so the UI reflects video ready
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


  // Handle batch video render
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

  // Start Batch Generation (force = true overwrites existing daily scripts in PostgreSQL)
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

  // Generate single stock on demand
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

  // Copy full script to clipboard
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

[FUNDAMENTALS & VALUATION]
${safeRenderText(script.fundamentals)}
Valuation: ${safeRenderText(script.valuation)}

[WHAT TO WATCH]
${safeRenderText(script.what_to_watch)}

[INVESTOR VIEW]
${safeRenderText(script.investor_view)}

[TRADER VIEW]
${safeRenderText(script.trader_view)}

[DISCLAIMER]
${safeRenderText(script.disclaimer)}`;

    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Sectors list
  const sectors = useMemo(() => {
    const s = new Set<string>();
    stocks.forEach((st) => {
      if (st.sector) s.add(st.sector);
    });
    return ["All", ...Array.from(s).sort()];
  }, [stocks]);

  // Filtered stocks
  const filteredStocks = useMemo(() => {
    return stocks.filter((s) => {
      const matchSearch =
        s.symbol.toLowerCase().includes(search.toLowerCase()) ||
        s.company_name.toLowerCase().includes(search.toLowerCase());
      const matchSector = selectedSector === "All" || s.sector === selectedSector;
      const matchStatus =
        selectedStatus === "All" ||
        (selectedStatus === "Ready" && s.status === "ready") ||
        (selectedStatus === "Pending" && s.status !== "ready");
      const matchVerdict =
        selectedVerdict === "All" || s.script?.verdict === selectedVerdict;

      return matchSearch && matchSector && matchStatus && matchVerdict;
    });
  }, [stocks, search, selectedSector, selectedStatus, selectedVerdict]);

  const readyCount = stocks.filter((s) => s.status === "ready" && s.script).length;
  const bullishCount = stocks.filter((s) => s.script?.verdict === "Bullish").length;
  const bearishCount = stocks.filter((s) => s.script?.verdict === "Bearish").length;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 p-6 md:p-8 space-y-6">
      {/* ── HEADER BANNER ─────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 md:p-8 shadow-sm dark:shadow-2xl">
        <div className="absolute top-0 right-0 -mt-8 -mr-8 w-72 h-72 bg-blue-500/10 dark:bg-blue-600/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-1/3 -mb-8 w-60 h-60 bg-amber-500/10 rounded-full blur-2xl pointer-events-none" />

        <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-100 dark:bg-gradient-to-r dark:from-amber-500/20 dark:to-red-500/20 border border-amber-300 dark:border-amber-500/30 text-amber-800 dark:text-amber-400 text-xs font-semibold uppercase tracking-wider">
                <Flame className="w-3.5 h-3.5 animate-pulse text-amber-600 dark:text-amber-400" />
                60–90s Video Shorts
              </span>

              {/* Daily Edition Badge */}
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-50 dark:bg-blue-950/80 border border-blue-200 dark:border-blue-800/60 text-blue-700 dark:text-blue-300 text-xs font-medium">
                <Sparkles className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                Daily Market Edition
              </span>
            </div>

            <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-slate-900 dark:text-white flex items-center gap-3">
              NIFTY 50 Daily Shorts
            </h1>

            <p className="text-slate-600 dark:text-slate-400 text-sm md:text-base leading-relaxed">
              Bite-sized, event-driven research scripts and catalyst breakdowns for all 50 benchmark constituents.
            </p>

            {/* Market Session Status Banner */}
            {sessionInfo && (
              <div
                className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold border ${
                  sessionInfo.isLive
                    ? "bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800/60 text-amber-800 dark:text-amber-300"
                    : "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/60 text-emerald-800 dark:text-emerald-300"
                }`}
              >
                {sessionInfo.isLive ? (
                  <Radio className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 animate-pulse" />
                ) : (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                )}
                <span>{sessionInfo.statusLabel}</span>
                <span className="text-slate-500 dark:text-slate-400 font-normal">({sessionInfo.istTimeString})</span>
              </div>
            )}
          </div>

          {/* Action & Stats Buttons */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 w-full md:w-auto">
            <button
              onClick={() => handleStartBatch(false)}
              disabled={batchProgress.isRunning}
              className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-xs sm:text-sm transition-all duration-200 shadow-sm ${
                batchProgress.isRunning
                  ? "bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed border border-slate-200 dark:border-slate-700"
                  : "bg-white hover:bg-slate-50 dark:bg-slate-800/90 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700 shadow-slate-900/5 dark:shadow-slate-950/40 hover:scale-[1.02]"
              }`}
              title="Updates summaries for any stocks missing today's script"
            >
              {batchProgress.isRunning ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-blue-600 dark:text-blue-400" />
                  <span>Updating ({batchProgress.completed}/{batchProgress.total})...</span>
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  <span>Update Today</span>
                </>
              )}
            </button>

            <button
              onClick={() => handleStartBatch(true)}
              disabled={batchProgress.isRunning}
              className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-xs sm:text-sm transition-all duration-200 shadow-sm ${
                batchProgress.isRunning
                  ? "bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed border border-slate-200 dark:border-slate-700"
                  : "bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 dark:hover:bg-amber-900/60 text-amber-900 dark:text-amber-300 border border-amber-300 dark:border-amber-700/80 shadow-slate-900/5 dark:shadow-slate-950/40 hover:scale-[1.02]"
              }`}
              title="Regenerates all 50 stock briefings for today with the latest market data"
            >
              {batchProgress.isRunning ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-amber-600 dark:text-amber-400" />
                  <span>Regenerating...</span>
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4 text-amber-600 dark:text-amber-400 fill-amber-500" />
                  <span>Regenerate All</span>
                </>
              )}
            </button>

            {/* Batch Render Videos Button */}
            <button
              onClick={() => handleStartVideoBatch(false)}
              disabled={videoBatchProgress.isRunning}
              className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-xs sm:text-sm transition-all duration-200 shadow-sm ${
                videoBatchProgress.isRunning
                  ? "bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed border border-slate-200 dark:border-slate-700"
                  : "bg-gradient-to-r from-amber-500 via-orange-500 to-red-500 hover:from-amber-600 hover:to-red-600 text-white border border-amber-400/40 shadow-slate-900/10 hover:scale-[1.02]"
              }`}
              title="Renders vertical 9:16 short videos for all 50 stocks using Remotion engine"
            >
              {videoBatchProgress.isRunning ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                  <span>Rendering Videos ({videoBatchProgress.completed}/{videoBatchProgress.total})...</span>
                </>
              ) : (
                <>
                  <Film className="w-4 h-4 text-white" />
                  <span>Render All 50 Videos</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Live Video Batch Progress Bar */}
        {videoBatchProgress.isRunning && (
          <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-800/80 space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-300">
              <span className="flex items-center gap-2 font-medium">
                <Film className="w-3.5 h-3.5 text-amber-500 animate-pulse" />
                Rendering Short Video:{" "}
                <strong className="text-slate-900 dark:text-white">{videoBatchProgress.currentSymbol || "Initializing..."}</strong>
              </span>
              <span className="font-mono text-amber-500 font-semibold">
                {videoBatchProgress.completed} / {videoBatchProgress.total} (
                {Math.round((videoBatchProgress.completed / (videoBatchProgress.total || 1)) * 100)}%)
              </span>
            </div>
            <div className="w-full h-2.5 bg-slate-100 dark:bg-slate-950 rounded-full overflow-hidden border border-slate-200 dark:border-slate-800">
              <div
                className="h-full bg-gradient-to-r from-amber-500 via-orange-500 to-red-500 transition-all duration-300 rounded-full"
                style={{
                  width: `${Math.round(
                    (videoBatchProgress.completed / (videoBatchProgress.total || 1)) * 100
                  )}%`,
                }}
              />
            </div>
          </div>
        )}

        {/* Live Batch Progress Bar */}
        {batchProgress.isRunning && (
          <div className="mt-6 pt-5 border-t border-slate-200 dark:border-slate-800/80 space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-300">
              <span className="flex items-center gap-2 font-medium">
                <Sparkles className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 animate-spin" />
                Synthesizing Daily Brief:{" "}
                <strong className="text-slate-900 dark:text-white">{batchProgress.currentSymbol || "Initializing..."}</strong>
              </span>
              <span className="font-mono text-blue-600 dark:text-blue-400 font-semibold">
                {batchProgress.completed} / {batchProgress.total} (
                {Math.round((batchProgress.completed / (batchProgress.total || 1)) * 100)}%)
              </span>
            </div>
            <div className="w-full h-2.5 bg-slate-100 dark:bg-slate-950 rounded-full overflow-hidden border border-slate-200 dark:border-slate-800">
              <div
                className="h-full bg-gradient-to-r from-blue-500 via-indigo-500 to-cyan-400 transition-all duration-300 rounded-full"
                style={{
                  width: `${Math.round(
                    (batchProgress.completed / (batchProgress.total || 1)) * 100
                  )}%`,
                }}
              />
            </div>
          </div>
        )}

        {/* Quick Stats Badges */}
        <div className="mt-6 flex flex-wrap items-center gap-2 pt-4 border-t border-slate-200 dark:border-slate-800/60 text-xs">
          <div className="px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 flex items-center gap-2">
            <Calendar className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
            <span className="text-slate-500 dark:text-slate-400">Trading Session:</span>
            <span className="font-bold text-slate-900 dark:text-white font-mono">
              {sessionInfo?.effectiveTradingDate || "Today"}
            </span>
          </div>
          <div className="px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 flex items-center gap-2">
            <span className="text-slate-500 dark:text-slate-400">Briefs Ready:</span>
            <span className="font-bold text-blue-600 dark:text-blue-400">
              {readyCount} / {stocks.length}
            </span>
          </div>
          <div className="px-3 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/40 text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5 font-semibold">
            <TrendingUp className="w-3.5 h-3.5" />
            {bullishCount} Bullish
          </div>
          <div className="px-3 py-1.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/40 text-rose-700 dark:text-rose-400 flex items-center gap-1.5 font-semibold">
            <TrendingDown className="w-3.5 h-3.5" />
            {bearishCount} Bearish
          </div>
          <div className="px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
            Avg. Length: ~75s (Spoken)
          </div>
        </div>
      </div>

      {/* ── FILTER & SEARCH BAR ───────────────────────────────────── */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4 bg-white dark:bg-slate-900/80 backdrop-blur-md border border-slate-200 dark:border-slate-800/80 p-4 rounded-xl shadow-sm">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search by ticker (e.g. RELIANCE, TCS) or name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800 rounded-lg text-sm text-slate-900 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs">
          <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 px-3 py-1.5 rounded-lg">
            <SlidersHorizontal className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
            <select
              value={selectedSector}
              onChange={(e) => setSelectedSector(e.target.value)}
              className="bg-transparent text-slate-800 dark:text-slate-200 font-medium focus:outline-none cursor-pointer"
            >
              {sectors.map((sec) => (
                <option key={sec} value={sec} className="bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200">
                  {sec}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 px-3 py-1.5 rounded-lg">
            <span className="text-slate-500 dark:text-slate-400">Status:</span>
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="bg-transparent text-slate-800 dark:text-slate-200 font-medium focus:outline-none cursor-pointer"
            >
              <option value="All" className="bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200">All</option>
              <option value="Ready" className="bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200">Ready</option>
              <option value="Pending" className="bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200">Pending</option>
            </select>
          </div>

          <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 px-3 py-1.5 rounded-lg">
            <span className="text-slate-500 dark:text-slate-400">Verdict:</span>
            <select
              value={selectedVerdict}
              onChange={(e) => setSelectedVerdict(e.target.value)}
              className="bg-transparent text-slate-800 dark:text-slate-200 font-medium focus:outline-none cursor-pointer"
            >
              <option value="All" className="bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200">All</option>
              <option value="Bullish" className="bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200">Bullish</option>
              <option value="Bearish" className="bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200">Bearish</option>
              <option value="Neutral" className="bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200">Neutral</option>
              <option value="Watchlist" className="bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200">Watchlist</option>
            </select>
          </div>
        </div>
      </div>

      {/* ── STOCK CARDS GRID ───────────────────────────────────────── */}
      {loading ? (
        <div className="py-20 flex flex-col items-center justify-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
          <p className="text-sm text-slate-500 dark:text-slate-400">Loading daily stock briefings...</p>
        </div>
      ) : filteredStocks.length === 0 ? (
        <div className="py-20 text-center text-slate-500 dark:text-slate-400 space-y-2">
          <AlertCircle className="w-10 h-10 mx-auto text-slate-400 dark:text-slate-600" />
          <p className="text-base font-semibold text-slate-800 dark:text-slate-300">No stocks match your filter</p>
          <p className="text-xs">Try adjusting your search query or reset filter pills.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredStocks.map((stock) => {
            const hasScript = Boolean(stock.script && stock.status === "ready");
            const isGenerating = generatingSymbol === stock.symbol;
            const isUp = (stock.change_pct ?? 0) >= 0;

            return (
              <div
                key={stock.symbol}
                onClick={() => {
                  if (hasScript) setActiveModalStock(stock);
                  else handleGenerateSingle(stock.symbol);
                }}
                className={`group relative rounded-xl border p-5 transition-all duration-200 cursor-pointer flex flex-col justify-between ${
                  hasScript
                    ? "bg-white dark:bg-slate-900/70 hover:bg-slate-50 dark:hover:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 shadow-sm hover:shadow-md hover:shadow-blue-950/5 dark:hover:shadow-blue-950/20"
                    : "bg-white/80 dark:bg-slate-900/40 hover:bg-white dark:hover:bg-slate-900/60 border-slate-200 dark:border-slate-800/60 hover:border-slate-300 dark:hover:border-slate-700/80 shadow-sm"
                }`}
              >
                <div>
                  {/* Card Top Row */}
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-black text-lg text-slate-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                          {stock.symbol}
                        </span>
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700/60 font-medium">
                          {stock.sector}
                        </span>
                      </div>
                      <h4 className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-[200px]" title={stock.company_name}>
                        {stock.company_name}
                      </h4>
                    </div>

                    <div>
                      {isGenerating ? (
                        <span className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full bg-blue-50 dark:bg-blue-950/80 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 font-semibold">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          Generating
                        </span>
                      ) : hasScript ? (
                        <span
                          className={`text-[11px] px-2.5 py-0.5 rounded-full font-bold border ${
                            safeRenderText(stock.script?.verdict) === "Bullish"
                              ? "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/60"
                              : safeRenderText(stock.script?.verdict) === "Bearish"
                              ? "bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-800/60"
                              : "bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800/60"
                          }`}
                        >
                          {safeRenderText(stock.script?.verdict)}
                        </span>
                      ) : (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700/40 font-medium">
                          Pending
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Price & Market Snapshot */}
                  {stock.price !== undefined ? (
                    <div className="flex items-baseline justify-between py-2 px-3 rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800/60 mb-3">
                      <div>
                        <span className="text-sm font-semibold text-slate-900 dark:text-white">
                          ₹{stock.price.toLocaleString("en-IN")}
                        </span>
                        <span
                          className={`ml-2 text-xs font-bold ${
                            isUp ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                          }`}
                        >
                          {isUp ? "+" : ""}
                          {stock.change_pct}%
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {stock.volume_ratio !== undefined && (
                          <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                            {stock.volume_ratio}× Vol
                          </span>
                        )}
                        {stock.trading_date && (
                          <span className="text-[10px] font-mono text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-1.5 py-0.5 rounded">
                            {stock.trading_date}
                          </span>
                        )}
                      </div>
                    </div>
                  ) : null}

                  {/* Script Hook Preview */}
                  {hasScript && stock.script?.hook ? (
                    <div className="space-y-2 mb-4">
                      <p className="text-xs text-slate-700 dark:text-slate-300 italic line-clamp-3 bg-blue-50/60 dark:bg-slate-950/40 p-2.5 rounded-lg border-l-2 border-blue-500">
                        “{safeRenderText(stock.script.hook)}”
                      </p>
                      <div className="flex items-center gap-1.5 text-[10px] text-slate-500 dark:text-slate-400">
                        <span className="uppercase tracking-wider font-semibold text-slate-500">Driver:</span>
                        <span className="font-mono text-slate-700 dark:text-slate-300 capitalize">
                          {safeRenderText(stock.script.event_type).replace(/_/g, " ")}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="py-4 text-center text-xs text-slate-500 dark:text-slate-400">
                      Click to generate today's 60s market brief
                    </div>
                  )}
                </div>

                {/* Card Action Footer */}
                <div className="pt-3 border-t border-slate-200 dark:border-slate-800/60 flex items-center justify-between text-xs">
                  {hasScript ? (
                    <>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveModalStock(stock);
                          }}
                          className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:group-hover:text-blue-300 font-semibold flex items-center gap-1 transition-colors"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          Read
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenOrGenerateVideo(stock);
                          }}
                          disabled={renderingVideoSymbol === stock.symbol}
                          className={`font-semibold flex items-center gap-1 transition-all ${
                            (stock as any).video_url
                              ? "text-amber-500 hover:text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-md border border-amber-500/30"
                              : "text-amber-600 hover:text-amber-700 dark:text-amber-400"
                          }`}
                          title={(stock as any).video_url ? "Watch rendered short video" : "Generate or watch short video"}
                        >
                          {renderingVideoSymbol === stock.symbol ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Film className="w-3.5 h-3.5 text-amber-500" />
                          )}
                          {(stock as any).video_url ? "Watch" : "Video"}
                        </button>
                      </div>
                      <button
                        onClick={(e) => handleGenerateSingle(stock.symbol, e)}
                        disabled={isGenerating}
                        className="text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 transition-colors p-1"
                        title="Regenerate today's brief"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isGenerating ? "animate-spin" : ""}`} />
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={(e) => handleGenerateSingle(stock.symbol, e)}
                      disabled={isGenerating}
                      className="w-full py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 dark:bg-blue-600/20 dark:hover:bg-blue-600/30 text-blue-600 dark:text-blue-400 font-semibold flex items-center justify-center gap-1.5 transition-colors border border-blue-200 dark:border-blue-500/30"
                    >
                      {isGenerating ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          Generating...
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-3.5 h-3.5" />
                          Generate Short
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── INTERACTIVE TELEPROMPTER / SCRIPT MODAL ─────────────────── */}
      {activeModalStock && activeModalStock.script && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-950/80 backdrop-blur-md"
          style={{ overflow: "hidden" }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setActiveModalStock(null);
          }}
        >
          <div
            className="relative w-full max-w-4xl max-h-[92vh] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="shrink-0 p-4 md:px-6 md:py-4.5 border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm flex items-start justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">
                    {activeModalStock.symbol}
                  </span>
                  <span
                    className={`text-xs px-2.5 py-0.5 rounded-full font-bold border ${
                      safeRenderText(activeModalStock.script.verdict) === "Bullish"
                        ? "bg-emerald-50 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800"
                        : safeRenderText(activeModalStock.script.verdict) === "Bearish"
                        ? "bg-rose-50 dark:bg-rose-950/80 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-800"
                        : "bg-amber-50 dark:bg-amber-950/80 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800"
                    }`}
                  >
                    {safeRenderText(activeModalStock.script.verdict)}
                  </span>
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono capitalize border border-slate-200 dark:border-slate-700">
                    {safeRenderText(activeModalStock.script.event_type).replace(/_/g, " ")}
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  {activeModalStock.company_name} • {activeModalStock.sector} • Session:{" "}
                  <strong className="text-slate-800 dark:text-slate-300">{activeModalStock.trading_date || "Today"}</strong> • Est. Duration: ~
                  {activeModalStock.script.estimated_read_seconds || 75}s
                </p>
              </div>

              {/* Header Right Actions */}
              <div className="flex items-center gap-2 shrink-0">
                {modalMode === "teleprompter" && (
                  <button
                    onClick={() => setTeleprompterFontSize((prev) => (prev === "normal" ? "large" : "normal"))}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-semibold border border-slate-200 dark:border-slate-700 transition-colors shadow-xs"
                    title="Toggle Text Size"
                  >
                    <Type className="w-3.5 h-3.5" />
                    <span>{teleprompterFontSize === "normal" ? "A+" : "A"}</span>
                  </button>
                )}

                <button
                  onClick={() => handleCopyScript(activeModalStock.script!, activeModalStock)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold border border-slate-200 dark:border-slate-700 transition-colors shadow-xs"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                      <span className="text-emerald-600 dark:text-emerald-400">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                      <span>Copy</span>
                    </>
                  )}
                </button>

                <button
                  onClick={() => handleGenerateSingle(activeModalStock.symbol)}
                  disabled={generatingSymbol === activeModalStock.symbol}
                  className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 transition-colors shadow-xs"
                  title="Regenerate today's brief"
                >
                  <RefreshCw
                    className={`w-4 h-4 ${
                      generatingSymbol === activeModalStock.symbol ? "animate-spin text-blue-600 dark:text-blue-400" : ""
                    }`}
                  />
                </button>

                {/* Watch Video Button */}
                <button
                  onClick={() => handleOpenOrGenerateVideo(activeModalStock)}
                  disabled={renderingVideoSymbol === activeModalStock.symbol}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-semibold text-xs transition-all shadow-xs"
                  title="Render and watch 9:16 vertical short video"
                >
                  {renderingVideoSymbol === activeModalStock.symbol ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Rendering...</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>Watch Short</span>
                    </>
                  )}
                </button>

                <button
                  onClick={() => setActiveModalStock(null)}
                  className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-700 dark:hover:text-white border border-slate-200 dark:border-slate-700 transition-colors shadow-xs"
                  title="Close modal (Esc)"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Mode Toggle Switch */}
            <div className="shrink-0 px-6 py-2.5 bg-slate-50 dark:bg-slate-950/70 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-1 bg-slate-200/80 dark:bg-slate-900 p-1 rounded-lg border border-slate-300 dark:border-slate-800">
                <button
                  onClick={() => setModalMode("teleprompter")}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-md font-semibold transition-all ${
                    modalMode === "teleprompter"
                      ? "bg-blue-600 text-white shadow-xs"
                      : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                  }`}
                >
                  <Tv className="w-3.5 h-3.5" />
                  Teleprompter Speech Mode
                </button>
                <button
                  onClick={() => setModalMode("structured")}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-md font-semibold transition-all ${
                    modalMode === "structured"
                      ? "bg-blue-600 text-white shadow-xs"
                      : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                  }`}
                >
                  <FileText className="w-3.5 h-3.5" />
                  Structured Inspector
                </button>
              </div>

              {activeModalStock.price !== undefined && (
                <div className="font-mono text-slate-600 dark:text-slate-300 text-xs flex items-center gap-2">
                  <span>
                    LTP: <strong className="text-slate-900 dark:text-white font-semibold">₹{activeModalStock.price.toLocaleString("en-IN")}</strong>
                  </span>
                  <span
                    className={`font-semibold ${
                      (activeModalStock.change_pct ?? 0) >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                    }`}
                  >
                    {(activeModalStock.change_pct ?? 0) >= 0 ? "+" : ""}
                    {activeModalStock.change_pct}%
                  </span>
                  {activeModalStock.volume_ratio !== undefined && (
                    <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                      {activeModalStock.volume_ratio}× Vol
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Modal Body with internal scrolling */}
            <div
              className="flex-1 min-h-0 overflow-y-auto p-5 sm:p-6 md:p-8 space-y-6 text-slate-800 dark:text-slate-200 text-sm leading-relaxed bg-slate-50/40 dark:bg-slate-900/40 scroll-smooth"
              style={{ minHeight: 0 }}
            >
              {modalMode === "teleprompter" ? (
                /* ── TELEPROMPTER VIEW ── */
                <div className="space-y-6 max-w-3xl mx-auto font-sans">
                  {/* Hook */}
                  <div className="p-4 sm:p-5 rounded-xl bg-gradient-to-r from-blue-50 to-indigo-50/80 dark:from-blue-950/50 dark:to-indigo-950/30 border border-blue-200 dark:border-blue-800/60 shadow-xs">
                    <span className="text-[11px] font-bold tracking-wider text-blue-600 dark:text-blue-400 uppercase block mb-1.5 flex items-center gap-1.5">
                      <span>🎣</span> 0:00 – 0:10 • THE HOOK
                    </span>
                    <p className={`font-bold text-slate-900 dark:text-white leading-snug ${teleprompterFontSize === "large" ? "text-xl md:text-2xl" : "text-base md:text-lg"}`}>
                      “{safeRenderText(activeModalStock.script.hook)}”
                    </p>
                  </div>

                  {/* Price Action */}
                  <div className="p-4 rounded-xl bg-white dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800/80 shadow-xs space-y-1.5">
                    <span className="text-[11px] font-bold tracking-wider text-slate-500 dark:text-slate-400 uppercase block flex items-center gap-1.5">
                      <span>📈</span> 0:10 – 0:22 • PRICE ACTION & BENCHMARK RELATIVE
                    </span>
                    <p className={`text-slate-800 dark:text-slate-100 ${teleprompterFontSize === "large" ? "text-lg md:text-xl" : "text-base"}`}>
                      {safeRenderText(activeModalStock.script.price_action)}
                    </p>
                  </div>

                  {/* Why Moving */}
                  <div className="p-4 rounded-xl bg-white dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800/80 shadow-xs space-y-1.5">
                    <span className="text-[11px] font-bold tracking-wider text-amber-600 dark:text-amber-400 uppercase block flex items-center gap-1.5">
                      <span>🔍</span> 0:22 – 0:35 • WHY THE STOCK IS MOVING
                    </span>
                    <p className={`text-slate-800 dark:text-slate-100 ${teleprompterFontSize === "large" ? "text-lg md:text-xl" : "text-base"}`}>
                      {safeRenderText(activeModalStock.script.why_moving)}
                    </p>
                  </div>

                  {/* Technicals */}
                  <div className="p-4 rounded-xl bg-white dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800/80 shadow-xs space-y-1.5">
                    <span className="text-[11px] font-bold tracking-wider text-cyan-600 dark:text-cyan-400 uppercase block flex items-center gap-1.5">
                      <span>📊</span> 0:35 – 0:48 • TECHNICAL SNAPSHOT
                    </span>
                    <p className={`text-slate-800 dark:text-slate-100 ${teleprompterFontSize === "large" ? "text-lg md:text-xl" : "text-base"}`}>
                      {safeRenderText(activeModalStock.script.technicals)}
                    </p>
                  </div>

                  {/* Fundamentals & Valuation */}
                  <div className="p-4 rounded-xl bg-white dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800/80 shadow-xs space-y-2">
                    <span className="text-[11px] font-bold tracking-wider text-emerald-600 dark:text-emerald-400 uppercase block flex items-center gap-1.5">
                      <span>🏢</span> 0:48 – 1:02 • FUNDAMENTALS & VALUATION
                    </span>
                    <p className={`text-slate-800 dark:text-slate-100 ${teleprompterFontSize === "large" ? "text-lg md:text-xl" : "text-base"}`}>
                      {safeRenderText(activeModalStock.script.fundamentals)}
                    </p>
                    {activeModalStock.script.valuation && (
                      <p className={`text-slate-600 dark:text-slate-300 pt-1.5 border-t border-slate-100 dark:border-slate-800 ${teleprompterFontSize === "large" ? "text-base md:text-lg" : "text-sm"}`}>
                        {safeRenderText(activeModalStock.script.valuation)}
                      </p>
                    )}
                  </div>

                  {/* Upcoming Catalysts */}
                  <div className="p-4 rounded-xl bg-white dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800/80 shadow-xs space-y-1.5">
                    <span className="text-[11px] font-bold tracking-wider text-purple-600 dark:text-purple-400 uppercase block flex items-center gap-1.5">
                      <span>⏱️</span> 1:02 – 1:12 • WHAT TO WATCH / CATALYSTS
                    </span>
                    <p className={`text-slate-800 dark:text-slate-100 ${teleprompterFontSize === "large" ? "text-lg md:text-xl" : "text-base"}`}>
                      {safeRenderText(activeModalStock.script.what_to_watch)}
                    </p>
                  </div>

                  {/* Final View: Investor vs Trader */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                    <div className="p-4 sm:p-5 rounded-xl bg-blue-50/60 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/50 space-y-2 shadow-xs">
                      <span className="text-[11px] font-bold text-blue-700 dark:text-blue-400 uppercase tracking-wider flex items-center gap-1.5">
                        <span>👥</span> INVESTOR HORIZON
                      </span>
                      <p className={`text-slate-700 dark:text-slate-200 ${teleprompterFontSize === "large" ? "text-base md:text-lg" : "text-sm"}`}>
                        {safeRenderText(activeModalStock.script.investor_view)}
                      </p>
                    </div>

                    <div className="p-4 sm:p-5 rounded-xl bg-indigo-50/60 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-900/50 space-y-2 shadow-xs">
                      <span className="text-[11px] font-bold text-indigo-700 dark:text-indigo-400 uppercase tracking-wider flex items-center gap-1.5">
                        <span>🎯</span> TRADER HORIZON
                      </span>
                      <p className={`text-slate-700 dark:text-slate-200 ${teleprompterFontSize === "large" ? "text-base md:text-lg" : "text-sm"}`}>
                        {safeRenderText(activeModalStock.script.trader_view)}
                      </p>
                    </div>
                  </div>

                  {/* Disclaimer */}
                  <div className="p-3.5 rounded-lg bg-slate-100/80 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 text-xs text-center leading-relaxed">
                    ⚖️ {safeRenderText(activeModalStock.script.disclaimer)}
                  </div>
                </div>
              ) : (
                /* ── STRUCTURED INSPECTOR VIEW ── */
                <div className="space-y-5 max-w-3xl mx-auto">
                  <div className="p-4 sm:p-5 rounded-xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 shadow-xs">
                    <h5 className="text-xs font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                      <Flame className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                      Opening Hook
                    </h5>
                    <p className="text-base md:text-lg text-slate-900 dark:text-white font-medium italic">
                      “{safeRenderText(activeModalStock.script.hook)}”
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 rounded-xl bg-white dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800 space-y-2 shadow-xs">
                      <h5 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                        Price Action & Relative Move
                      </h5>
                      <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-200">{safeRenderText(activeModalStock.script.price_action)}</p>
                    </div>

                    <div className="p-4 rounded-xl bg-white dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800 space-y-2 shadow-xs">
                      <h5 className="text-xs font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider">
                        Drivers & Catalysts
                      </h5>
                      <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-200">{safeRenderText(activeModalStock.script.why_moving)}</p>
                    </div>

                    <div className="p-4 rounded-xl bg-white dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800 space-y-2 shadow-xs">
                      <h5 className="text-xs font-bold text-cyan-600 dark:text-cyan-400 uppercase tracking-wider">
                        Technical Setup
                      </h5>
                      <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-200">{safeRenderText(activeModalStock.script.technicals)}</p>
                    </div>

                    <div className="p-4 rounded-xl bg-white dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800 space-y-2 shadow-xs">
                      <h5 className="text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">
                        Fundamentals & Multiples
                      </h5>
                      <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-200">{safeRenderText(activeModalStock.script.fundamentals)}</p>
                      {activeModalStock.script.valuation && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 pt-1.5 border-t border-slate-200 dark:border-slate-800/60">
                          {safeRenderText(activeModalStock.script.valuation)}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-white dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800 space-y-2 shadow-xs">
                    <h5 className="text-xs font-bold text-purple-600 dark:text-purple-400 uppercase tracking-wider">
                      Upcoming Catalysts & Events
                    </h5>
                    <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-200">{safeRenderText(activeModalStock.script.what_to_watch)}</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 rounded-xl bg-blue-50/70 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/40 space-y-2 shadow-xs">
                      <h5 className="text-xs font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider">
                        Investor Horizon
                      </h5>
                      <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-200">{safeRenderText(activeModalStock.script.investor_view)}</p>
                    </div>

                    <div className="p-4 rounded-xl bg-indigo-50/70 dark:bg-indigo-950/20 border border-indigo-200 dark:border-indigo-900/40 space-y-2 shadow-xs">
                      <h5 className="text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">
                        Trader Horizon
                      </h5>
                      <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-200">{safeRenderText(activeModalStock.script.trader_view)}</p>
                    </div>
                  </div>

                  <div className="text-xs text-slate-500 dark:text-slate-400 text-center pt-2">
                    ⚖️ {safeRenderText(activeModalStock.script.disclaimer)}
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="shrink-0 px-6 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span className="flex items-center gap-1.5 font-mono">
                <Calendar className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                Session: <strong className="text-slate-800 dark:text-slate-200">{activeModalStock.trading_date || "Today"}</strong>
              </span>
              <div className="flex items-center gap-3">
                <span className="hidden sm:inline text-slate-400">
                  {activeModalStock.script.word_count ? `${activeModalStock.script.word_count} words • ` : ""}
                  ~{activeModalStock.script.estimated_read_seconds || 75}s speech
                </span>
                <button
                  onClick={() => setActiveModalStock(null)}
                  className="px-4 py-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-semibold transition-colors shadow-xs"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── 9:16 VERTICAL VIDEO PLAYER MODAL (ET-VIDEO-ENGINE REPLICA) ── */}
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
    </div>
  );
}
