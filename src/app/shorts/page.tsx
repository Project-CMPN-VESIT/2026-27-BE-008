"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import {
  Film,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Search,
  TrendingUp,
  TrendingDown,
  Clock,
  RefreshCw,
  X,
  BarChart3,
  Calendar,
  RotateCcw,
  RotateCw,
} from "lucide-react";

export interface RenderedShortItem {
  symbol: string;
  company_name: string;
  sector: string;
  trading_date: string;
  price?: number;
  change_pct?: number;
  video_url: string;
  headline?: string;
  verdict?: "Bullish" | "Bearish" | "Watchlist" | "Neutral";
  duration_seconds?: number;
  brief?: any;
  scenes?: any[];
  script?: any;
  created_at?: string;
}

const fmt = (p?: number) =>
  p != null
    ? p.toLocaleString("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : "--";

function formatDateDisplay(d?: string) {
  if (!d) return "";
  try {
    const parts = d.split("-");
    if (parts.length === 3) {
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      const date = new Date(year, month, day);
      if (!isNaN(date.getTime())) {
        return date.toLocaleDateString("en-IN", {
          day: "numeric",
          month: "short",
          year: "numeric",
        });
      }
    }
  } catch {}
  return d;
}

function cleanSceneLabel(headline?: string, symbol?: string, defaultIndex: number = 1): string {
  if (!headline) return `Scene ${defaultIndex}`;
  let clean = headline.trim();
  if (symbol) {
    const re = new RegExp(`^${symbol}\\s*[-:·]?\\s*`, "i");
    clean = clean.replace(re, "").trim();
  }
  if (!clean) return `Scene ${defaultIndex}`;
  // Title-case common words if all caps
  if (clean === clean.toUpperCase()) {
    clean = clean
      .toLowerCase()
      .split(" ")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }
  return clean;
}

export default function NiftyShortsUserDashboard() {
  const [shorts, setShorts] = useState<RenderedShortItem[]>([]);
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState("");
  const [selectedSector, setSelectedSector] = useState("All");
  const [selectedVerdict, setSelectedVerdict] = useState("All");
  const [sortBy, setSortBy] = useState<"newest" | "gainers" | "losers" | "symbol">("newest");

  // Active playing video modal
  const [activeShort, setActiveShort] = useState<RenderedShortItem | null>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const fetchShorts = async (date?: string) => {
    try {
      setLoading(true);
      setError(null);
      const url = date ? `/api/shorts?date=${encodeURIComponent(date)}` : "/api/shorts";
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`Failed to load shorts (${res.status})`);
      }
      const json = await res.json();
      if (json.success) {
        setShorts(json.shorts || []);
        setAvailableDates(json.available_dates || []);
        if (json.selected_date) {
          setSelectedDate(json.selected_date);
        }
      } else {
        throw new Error(json.error || "Unable to load shorts feed");
      }
    } catch (err: any) {
      console.error("[Shorts Page]", err);
      setError(err.message || "Could not connect to video engine feed.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchShorts();
  }, []);

  // Filter & Sort
  const sectors = useMemo(() => {
    const set = new Set<string>();
    shorts.forEach((s) => {
      if (s.sector) set.add(s.sector);
    });
    return ["All", ...Array.from(set).sort()];
  }, [shorts]);

  const filteredShorts = useMemo(() => {
    return shorts
      .filter((s) => {
        const q = search.trim().toLowerCase();
        const matchesQuery =
          !q ||
          s.symbol.toLowerCase().includes(q) ||
          s.company_name.toLowerCase().includes(q) ||
          (s.headline && s.headline.toLowerCase().includes(q));

        const matchesSector =
          selectedSector === "All" || s.sector.toLowerCase() === selectedSector.toLowerCase();

        const matchesVerdict =
          selectedVerdict === "All" ||
          (s.verdict && s.verdict.toLowerCase() === selectedVerdict.toLowerCase());

        return matchesQuery && matchesSector && matchesVerdict;
      })
      .sort((a, b) => {
        if (sortBy === "gainers") return (b.change_pct ?? 0) - (a.change_pct ?? 0);
        if (sortBy === "losers") return (a.change_pct ?? 0) - (b.change_pct ?? 0);
        if (sortBy === "symbol") return a.symbol.localeCompare(b.symbol);
        return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
      });
  }, [shorts, search, selectedSector, selectedVerdict, sortBy]);

  // When activeShort changes, reset playback states
  useEffect(() => {
    if (activeShort) {
      setIsPlaying(true);
      setCurrentTime(0);
      setDuration(activeShort.duration_seconds || 30);
    }
  }, [activeShort]);

  // Handle Video Modal Time Updates
  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
      if (videoRef.current.duration && !isNaN(videoRef.current.duration)) {
        setDuration(videoRef.current.duration);
      }
    }
  };

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play().catch(() => {});
      setIsPlaying(true);
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    videoRef.current.muted = !videoRef.current.muted;
    setIsMuted(videoRef.current.muted);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextTime = parseFloat(e.target.value);
    if (videoRef.current) {
      videoRef.current.currentTime = nextTime;
      setCurrentTime(nextTime);
    }
  };

  const jumpSeconds = (delta: number) => {
    if (!videoRef.current) return;
    const target = Math.max(0, Math.min(duration || 100, videoRef.current.currentTime + delta));
    videoRef.current.currentTime = target;
    setCurrentTime(target);
  };

  // Up to 4 concise scenes with cumulative start times for highlights
  const scenesWithTimes = useMemo(() => {
    if (!activeShort?.scenes || !Array.isArray(activeShort.scenes)) return [];
    let cumTime = 0;
    return activeShort.scenes.slice(0, 4).map((sc, idx) => {
      const start = cumTime;
      const dur = sc.duration_seconds || 5;
      cumTime += dur;
      return {
        ...sc,
        sceneIndex: idx + 1,
        startTime: start,
        endTime: cumTime,
      };
    });
  }, [activeShort]);

  const activeScene = useMemo(() => {
    if (!scenesWithTimes.length) return null;
    return (
      scenesWithTimes.find((sc) => currentTime >= sc.startTime && currentTime < sc.endTime) ||
      scenesWithTimes[scenesWithTimes.length - 1]
    );
  }, [scenesWithTimes, currentTime]);

  return (
    <div
      style={{
        fontFamily: "Inter, system-ui, -apple-system, sans-serif",
      }}
      className="min-h-screen bg-[#F6F7F9] dark:bg-[#0B1220] text-[#0F172A] dark:text-slate-100 pb-16 antialiased"
    >
      {/* ─── Institutional FinPilot Header ─── */}
      <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h1 className="text-2xl sm:text-[28px] font-bold tracking-tight text-slate-900 dark:text-white">
                  Nifty Shorts
                </h1>
                <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                  {shorts.length} Available
                </span>
              </div>
              <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                Daily market video reels synced with session price action and catalyst breakdowns.
              </p>
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              {availableDates.length > 1 && (
                <div className="flex items-center gap-2 h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 shadow-2xs">
                  <Calendar className="w-3.5 h-3.5 text-slate-400" />
                  <select
                    value={selectedDate}
                    onChange={(e) => {
                      setSelectedDate(e.target.value);
                      fetchShorts(e.target.value);
                    }}
                    className="bg-transparent text-xs font-semibold text-slate-700 dark:text-slate-200 outline-none pr-1 cursor-pointer"
                  >
                    {availableDates.map((d) => (
                      <option key={d} value={d} className="bg-white dark:bg-slate-900">
                        {formatDateDisplay(d)}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <button
                onClick={() => fetchShorts(selectedDate)}
                disabled={loading}
                className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-slate-500 ${loading ? "animate-spin text-blue-600" : ""}`} />
                <span>Refresh</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Search & Filters Bar ─── */}
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 mt-6">
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-white dark:bg-slate-900 p-2.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs">
          {/* Search Input */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by stock symbol or company name (e.g. ADANIENT, AXISBANK)..."
              className="w-full pl-9.5 pr-8 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl outline-none focus:border-blue-500 text-slate-900 dark:text-white placeholder:text-slate-400 font-medium"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Clean Controls */}
          <div className="flex items-center gap-2 overflow-x-auto py-0.5">
            <select
              value={selectedSector}
              onChange={(e) => setSelectedSector(e.target.value)}
              className="h-9 text-xs font-semibold bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 px-3 rounded-xl outline-none cursor-pointer"
            >
              {sectors.map((sec) => (
                <option key={sec} value={sec}>
                  {sec === "All" ? "All Sectors" : sec}
                </option>
              ))}
            </select>

            <select
              value={selectedVerdict}
              onChange={(e) => setSelectedVerdict(e.target.value)}
              className="h-9 text-xs font-semibold bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 px-3 rounded-xl outline-none cursor-pointer"
            >
              <option value="All">All Signals</option>
              <option value="Bullish">Bullish</option>
              <option value="Bearish">Bearish</option>
              <option value="Watchlist">Watchlist</option>
            </select>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="h-9 text-xs font-semibold bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 px-3 rounded-xl outline-none cursor-pointer shrink-0"
            >
              <option value="newest">Newest First</option>
              <option value="gainers">Top Gainers</option>
              <option value="losers">Top Losers</option>
              <option value="symbol">Symbol (A-Z)</option>
            </select>
          </div>
        </div>
      </div>

      {/* ─── Video Grid (3 Columns) ─── */}
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 mt-6">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              Loading market shorts...
            </p>
          </div>
        ) : error ? (
          <div className="bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-2xl p-6 text-center max-w-lg mx-auto">
            <p className="text-xs font-semibold text-rose-600 dark:text-rose-400 mb-2">{error}</p>
            <button
              onClick={() => fetchShorts(selectedDate)}
              className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold cursor-pointer"
            >
              Retry
            </button>
          </div>
        ) : filteredShorts.length === 0 ? (
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-10 text-center max-w-lg mx-auto mt-6 shadow-2xs">
            <Film className="w-8 h-8 mx-auto text-slate-400 mb-2" />
            <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-1">
              No Shorts Available
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
              {search || selectedSector !== "All" || selectedVerdict !== "All"
                ? "No shorts match your filter criteria."
                : "No market shorts have been generated for this session yet."}
            </p>
            {(search || selectedSector !== "All" || selectedVerdict !== "All") && (
              <button
                onClick={() => {
                  setSearch("");
                  setSelectedSector("All");
                  setSelectedVerdict("All");
                }}
                className="px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 cursor-pointer"
              >
                Clear Filters
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredShorts.map((item) => {
              const isUp = (item.change_pct ?? 0) >= 0;
              const verdictStyle =
                item.verdict === "Bullish"
                  ? "bg-emerald-500/20 text-emerald-300 border-emerald-400/30"
                  : item.verdict === "Bearish"
                  ? "bg-rose-500/20 text-rose-300 border-rose-400/30"
                  : "bg-amber-500/20 text-amber-300 border-amber-400/30";

              return (
                <div
                  key={`${item.trading_date}-${item.symbol}`}
                  className="group relative flex flex-col rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden shadow-2xs hover:shadow-md transition-all duration-200"
                >
                  {/* Video Preview Frame (Increased by 20% to 295px height) */}
                  <div
                    onClick={() => setActiveShort(item)}
                    className="relative w-full h-[295px] bg-slate-950 cursor-pointer overflow-hidden flex items-center justify-center"
                  >
                    <video
                      src={item.video_url}
                      preload="metadata"
                      muted
                      playsInline
                      className="absolute inset-0 w-full h-full object-cover group-hover:scale-103 transition-transform duration-300"
                      onMouseEnter={(e) => {
                        const v = e.currentTarget;
                        v.play().catch(() => {});
                      }}
                      onMouseLeave={(e) => {
                        const v = e.currentTarget;
                        v.pause();
                        v.currentTime = 0;
                      }}
                    />

                    <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-black/50 pointer-events-none" />

                    {/* Top Badges */}
                    <div className="absolute top-3 inset-x-3 flex items-center justify-between gap-1.5 z-10">
                      <div className="flex items-center gap-1.5">
                        <span className="px-2.5 py-0.5 rounded-md text-xs font-bold tracking-wide bg-[#1E3A8A] text-white shadow-2xs">
                          {item.symbol}
                        </span>
                        <span className="px-2 py-0.5 rounded-md text-[10.5px] font-medium bg-black/60 text-slate-200 border border-white/10 max-w-[130px] truncate">
                          {item.sector}
                        </span>
                      </div>

                      {item.verdict && (
                        <span
                          className={`px-2 py-0.5 rounded-md text-[10.5px] font-semibold border backdrop-blur-md ${verdictStyle}`}
                        >
                          {item.verdict}
                        </span>
                      )}
                    </div>

                    {/* Center Play Button */}
                    <div className="relative z-10 w-12 h-12 rounded-full bg-white/25 group-hover:bg-blue-600 text-white flex items-center justify-center backdrop-blur-md border border-white/30 group-hover:border-blue-500 shadow-md transition-all duration-200">
                      <Play className="w-5 h-5 fill-white ml-0.5" />
                    </div>

                    {/* Duration badge */}
                    <div className="absolute top-3 right-3 z-10">
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-black/70 text-slate-300 border border-white/10">
                        <Clock className="w-2.5 h-2.5 text-slate-300" />
                        {item.duration_seconds ? `0:${String(item.duration_seconds).padStart(2, "0")}` : "0:30"}
                      </span>
                    </div>

                    {/* Bottom Info inside Frame */}
                    <div className="absolute bottom-3 inset-x-3 z-10 space-y-0.5 text-white">
                      <div className="flex items-baseline justify-between gap-2">
                        <div className="truncate">
                          <div className="text-xs font-medium text-slate-300 leading-tight truncate">
                            {item.company_name}
                          </div>
                          <div className="text-lg font-bold text-white tabular-nums">
                            ₹{fmt(item.price)}
                          </div>
                        </div>

                        {item.change_pct != null && (
                          <div
                            className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold tabular-nums shrink-0 ${
                              isUp ? "bg-emerald-950/80 text-emerald-400" : "bg-rose-950/80 text-rose-400"
                            }`}
                          >
                            {isUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                            <span>
                              {isUp ? "+" : ""}
                              {item.change_pct.toFixed(2)}%
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Actions Drawer */}
                  <div className="p-2.5 bg-slate-50/90 dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 flex items-center gap-2">
                    <button
                      onClick={() => setActiveShort(item)}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-2xs cursor-pointer transition-colors"
                    >
                      <Play className="w-3.5 h-3.5 fill-white" />
                      <span>Watch Reel</span>
                    </button>

                    <Link
                      href={`/chart?symbol=${encodeURIComponent(item.symbol)}&marketId=NSE:${encodeURIComponent(item.symbol)}`}
                      className="inline-flex items-center justify-center h-9 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-semibold shadow-2xs transition-colors"
                      title="View Interactive Chart"
                    >
                      <BarChart3 className="w-3.5 h-3.5 mr-1 text-slate-500" />
                      <span>Chart</span>
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ─── Institutional Video Modal Player (Enlarged by 12%) ─── */}
      {activeShort && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-md p-4 animate-in fade-in duration-150 select-none">
          <div className="relative w-full max-w-[880px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-2xl flex flex-col md:flex-row max-h-[92vh]">
            {/* Left: Video Player Phone Frame */}
            <div className="flex-1 bg-slate-100 dark:bg-slate-950 border-b md:border-b-0 md:border-r border-slate-200 dark:border-slate-800 flex flex-col items-center justify-center p-5 sm:p-6">
              <div className="relative w-[260px] sm:w-[290px] aspect-[9/16] rounded-2xl overflow-hidden border-2 border-slate-700 dark:border-slate-600 shadow-xl bg-black shrink-0">
                <video
                  ref={videoRef}
                  src={activeShort.video_url}
                  autoPlay
                  playsInline
                  onTimeUpdate={handleTimeUpdate}
                  onEnded={() => setIsPlaying(false)}
                  className="w-full h-full object-cover"
                />

                <div className="absolute top-2.5 inset-x-2.5 flex items-center justify-between text-xs z-20">
                  <span className="px-2 py-0.5 rounded-md bg-[#1E3A8A] text-white font-bold text-xs shadow">
                    {activeShort.symbol}
                  </span>
                  <button
                    onClick={toggleMute}
                    className="p-1.5 rounded-full bg-black/60 hover:bg-black/80 text-white backdrop-blur-md cursor-pointer border border-white/20 transition-all"
                    title={isMuted ? "Unmute" : "Mute"}
                  >
                    {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {/* Scrubber & Controls */}
              <div className="w-[260px] sm:w-[290px] mt-3.5 space-y-1.5">
                <input
                  type="range"
                  min={0}
                  max={duration || 100}
                  step={0.1}
                  value={currentTime}
                  onChange={handleSeek}
                  className="w-full accent-blue-600 h-1.5 bg-slate-300 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer"
                />

                <div className="flex items-center justify-between text-[11px] font-mono text-slate-600 dark:text-slate-400">
                  <span>
                    {Math.floor(currentTime / 60)}:{String(Math.floor(currentTime % 60)).padStart(2, "0")}
                  </span>

                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => jumpSeconds(-5)}
                      title="Rewind 5s"
                      className="p-1 rounded-md bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 cursor-pointer shadow-2xs"
                    >
                      <RotateCcw className="w-3 h-3" />
                    </button>

                    <button
                      onClick={togglePlay}
                      className="w-8 h-8 rounded-full bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center cursor-pointer shadow-sm transition-transform active:scale-95"
                    >
                      {isPlaying ? (
                        <Pause className="w-3.5 h-3.5 fill-white" />
                      ) : (
                        <Play className="w-3.5 h-3.5 fill-white ml-0.5" />
                      )}
                    </button>

                    <button
                      onClick={() => jumpSeconds(5)}
                      title="Forward 5s"
                      className="p-1 rounded-md bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 cursor-pointer shadow-2xs"
                    >
                      <RotateCw className="w-3 h-3" />
                    </button>
                  </div>

                  <span>
                    {Math.floor(duration / 60)}:{String(Math.floor(duration % 60)).padStart(2, "0")}
                  </span>
                </div>
              </div>
            </div>

            {/* Right: Clean Financial Detail Card */}
            <div className="w-full md:w-[380px] lg:w-[410px] p-6 bg-white dark:bg-slate-900 flex flex-col justify-between overflow-y-auto">
              <div>
                {/* Header row with Symbol, Date & Close */}
                <div className="flex items-start justify-between gap-2 pb-3 border-b border-slate-100 dark:border-slate-800 mb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">
                        {activeShort.symbol}
                      </h2>
                      {activeShort.verdict && (
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase border ${
                            activeShort.verdict === "Bullish"
                              ? "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800"
                              : activeShort.verdict === "Bearish"
                              ? "bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-800"
                              : "bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800"
                          }`}
                        >
                          {activeShort.verdict}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      {activeShort.company_name} · {activeShort.sector}
                    </p>
                  </div>

                  <button
                    onClick={() => setActiveShort(null)}
                    className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors cursor-pointer"
                    title="Close"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Price & Session Stats */}
                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-800 mb-3.5 flex items-center justify-between">
                  <div>
                    <div className="text-[10px] uppercase font-semibold text-slate-500 dark:text-slate-400">
                      Market Price (LTP)
                    </div>
                    <div className="text-lg font-bold text-slate-900 dark:text-white tabular-nums">
                      ₹{fmt(activeShort.price)}
                    </div>
                  </div>

                  {activeShort.change_pct != null && (
                    <div
                      className={`text-right ${
                        (activeShort.change_pct ?? 0) >= 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-rose-600 dark:text-rose-400"
                      }`}
                    >
                      <div className="text-[10px] uppercase font-semibold text-slate-500 dark:text-slate-400">
                        Session Move
                      </div>
                      <div className="text-sm font-bold tabular-nums flex items-center gap-1 justify-end">
                        {(activeShort.change_pct ?? 0) >= 0 ? "+" : ""}
                        {activeShort.change_pct.toFixed(2)}%
                      </div>
                    </div>
                  )}
                </div>

                {/* Session Summary & Drivers (Medium-level concise text) */}
                <div className="space-y-1.5 mb-3.5">
                  <div className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                    Session Summary &amp; Drivers
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                    Intraday price action and institutional flow analysis for {activeShort.company_name}. Benchmark comparisons evaluated against session trends.
                  </div>
                </div>

                {/* Clean Highlights (Up to 4 concise scenes) */}
                {scenesWithTimes.length > 0 && (
                  <div className="space-y-1.5 mb-3.5">
                    <div className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                      Reel Highlights
                    </div>

                    <div className="space-y-1">
                      {scenesWithTimes.map((sc) => {
                        const isCurrent = activeScene?.sceneIndex === sc.sceneIndex;
                        const label = cleanSceneLabel(sc.headline || sc.subline, activeShort.symbol, sc.sceneIndex);

                        return (
                          <button
                            key={sc.sceneIndex}
                            onClick={() => {
                              if (videoRef.current) {
                                videoRef.current.currentTime = sc.startTime;
                                videoRef.current.play().catch(() => {});
                                setIsPlaying(true);
                              }
                            }}
                            className={`w-full text-left flex items-center justify-between px-3 py-2 rounded-lg border text-xs transition-colors cursor-pointer ${
                              isCurrent
                                ? "bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 font-semibold"
                                : "bg-slate-50 dark:bg-slate-800/40 hover:bg-slate-100 dark:hover:bg-slate-800 border-slate-200/70 dark:border-slate-800 text-slate-700 dark:text-slate-300"
                            }`}
                          >
                            <span className="truncate pr-2">{label}</span>
                            <span className="text-[10px] font-mono text-slate-400 shrink-0">
                              {Math.floor(sc.startTime / 60)}:
                              {String(Math.floor(sc.startTime % 60)).padStart(2, "0")}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Action Button: Bright White Text & Crisp Blue Button */}
              <div className="pt-3.5 border-t border-slate-100 dark:border-slate-800">
                <Link
                  href={`/chart?symbol=${encodeURIComponent(activeShort.symbol)}&marketId=NSE:${encodeURIComponent(activeShort.symbol)}`}
                  style={{ color: "#ffffff", textDecoration: "none" }}
                  className="w-full h-11 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500 !text-white text-xs font-bold flex items-center justify-center gap-2 shadow-sm hover:shadow active:scale-[0.99] transition-all cursor-pointer"
                >
                  <BarChart3 className="w-4 h-4 !text-white shrink-0" style={{ color: "#ffffff" }} />
                  <span className="!text-white font-bold" style={{ color: "#ffffff" }}>
                    Open Interactive Chart
                  </span>
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}