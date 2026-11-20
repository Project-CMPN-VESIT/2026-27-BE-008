"use client";

import React, { useCallback, useEffect, useMemo, useState, useDeferredValue } from "react";
import {
  CalendarDays,
  Search,
  RefreshCw,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Building2,
  Calendar,
  Clock,
  ArrowDown,
  ArrowUp,
  X,
  Layers,
  FileText,
  Landmark,
} from "lucide-react";

type ResultCalendarItem = {
  securityCode: string;
  shortName: string;
  companyName: string;
  resultDate: string;
  url: string;
};

type ResultCalendarResponse = {
  count: number;
  source: string;
  fetchedAt: string;
  results: ResultCalendarItem[];
  detail?: string;
};

const POLL_MS = 60000;

const parseResultDate = (value: string | null | undefined): number => {
  if (!value || value === "--" || value === "null") return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const formatDisplayDate = (value: string | null | undefined): string => {
  const ts = parseResultDate(value);
  if (!ts) return value || "—";
  const d = new Date(ts);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const day = d.getDate();
  const month = months[d.getMonth()];
  const year = d.getFullYear();
  return `${day} ${month} ${year}`;
};

export default function ResultsCalendarPage() {
  const [rows, setRows] = useState<ResultCalendarItem[]>([]);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [timingFilter, setTimingFilter] = useState<"ALL" | "TODAY" | "UPCOMING" | "PAST">("ALL");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string>("");

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Initial load from cache if available
  useEffect(() => {
    try {
      const saved = localStorage.getItem("finpilot_results_cal");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setRows(parsed);
          setLoading(false);
        }
      }
    } catch {}
  }, []);

  const fetchCalendar = useCallback(async (background = false, forceRefresh = false) => {
    if (background || rows.length > 0) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const url = forceRefresh ? "/api/results-calendar?refresh=true" : "/api/results-calendar";
      const response = await fetch(url, { cache: "no-store" });
      const payload: ResultCalendarResponse = await response.json();

      if (!response.ok) {
        throw new Error(payload.detail || "Failed to fetch results calendar");
      }

      const items = Array.isArray(payload.results) ? payload.results : [];
      setRows(items);
      setLastUpdatedAt(payload.fetchedAt || new Date().toISOString());

      if (items.length > 0) {
        try {
          localStorage.setItem("finpilot_results_cal", JSON.stringify(items));
        } catch {}
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load results calendar");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [rows.length]);

  useEffect(() => {
    fetchCalendar(false);
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      fetchCalendar(true);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [fetchCalendar]);

  // Aggregate metrics
  const stats = useMemo(() => {
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const tomorrowStart = todayStart + 24 * 60 * 60 * 1000;

    let todayCount = 0;
    let upcomingCount = 0;
    let pastCount = 0;

    for (const row of rows) {
      const ts = parseResultDate(row.resultDate);
      if (!ts) continue;

      if (ts >= todayStart && ts < tomorrowStart) {
        todayCount += 1;
      }
      if (ts >= tomorrowStart) {
        upcomingCount += 1;
      }
      if (ts < todayStart) {
        pastCount += 1;
      }
    }

    return {
      total: rows.length,
      today: todayCount,
      upcoming: upcomingCount,
      past: pastCount,
    };
  }, [rows]);

  // Reset page when filter changes
  useEffect(() => {
    setPage(1);
  }, [deferredSearch, timingFilter, sortOrder]);

  // Filtered rows
  const filteredRows = useMemo(() => {
    const query = deferredSearch.trim().toLowerCase();
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const tomorrowStart = todayStart + 24 * 60 * 60 * 1000;

    return rows
      .filter((row) => {
        const ts = parseResultDate(row.resultDate);

        if (timingFilter === "TODAY") {
          if (!ts || ts < todayStart || ts >= tomorrowStart) return false;
        } else if (timingFilter === "UPCOMING") {
          if (!ts || ts < tomorrowStart) return false;
        } else if (timingFilter === "PAST") {
          if (!ts || ts >= todayStart) return false;
        }

        if (!query) return true;
        const text = `${row.securityCode} ${row.shortName} ${row.companyName} ${row.resultDate}`.toLowerCase();
        return text.includes(query);
      })
      .sort((a, b) => {
        const timeA = parseResultDate(a.resultDate);
        const timeB = parseResultDate(b.resultDate);
        if (timeA !== timeB) {
          return sortOrder === "asc" ? timeA - timeB : timeB - timeA;
        }
        return a.companyName.localeCompare(b.companyName);
      });
  }, [rows, deferredSearch, timingFilter, sortOrder]);

  // Paginated slice
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const paginatedRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, page, pageSize]);

  const getStatusBadge = (dateStr: string) => {
    const ts = parseResultDate(dateStr);
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const tomorrowStart = todayStart + 24 * 60 * 60 * 1000;

    if (!ts) {
      return {
        label: "SCHEDULED",
        bg: "#F2F4F7",
        text: "#344054",
        dot: "#667085",
      };
    }
    if (ts >= todayStart && ts < tomorrowStart) {
      return {
        label: "TODAY",
        bg: "#EFF4FF",
        text: "#1849A9",
        dot: "#2E6BFF",
      };
    }
    if (ts >= tomorrowStart) {
      return {
        label: "UPCOMING",
        bg: "#ECFDF3",
        text: "#067647",
        dot: "#12B76A",
      };
    }
    return {
      label: "ANNOUNCED",
      bg: "#F2F4F7",
      text: "#475467",
      dot: "#98A2B3",
    };
  };

  return (
    <div className="min-h-screen bg-[#F6F7F9] dark:bg-[#090d16] text-[#0F172A] dark:text-slate-100 font-sans antialiased overflow-x-hidden">
      <main
        className="mx-auto px-4 sm:px-8 pt-6 sm:pt-8 pb-16 flex flex-col gap-5 w-full"
        style={{
          zoom: 0.92,
          width: "108.696%",
          maxWidth: "1461px",
          transformOrigin: "top center",
        }}
      >
        {/* ─── Top Header & Primary Actions ─── */}
        <div className="flex items-center justify-between gap-5 flex-wrap">
          <div className="flex items-center gap-4">
            <span className="w-[52px] h-[52px] rounded-[14px] bg-[#EFF4FF] dark:bg-blue-950/40 text-[#1F5EFF] dark:text-blue-400 border border-[#B2CCFF] dark:border-blue-800/60 grid place-items-center shrink-0 shadow-xs">
              <CalendarDays className="w-6 h-6" strokeWidth={1.8} />
            </span>
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="m-0 text-[28px] font-bold tracking-[-0.02em] text-[#0F172A] dark:text-white">
                  Results Calendar
                </h1>
                <span className="px-2.5 py-1 border border-[#D0D5DD] dark:border-slate-700 rounded-full bg-white dark:bg-slate-800 text-[11px] font-semibold tracking-[0.1em] text-[#475467] dark:text-slate-300">
                  BSE &amp; NSE CORPORATE
                </span>
              </div>
              <p className="mt-1.5 mb-0 text-[14.5px] text-[#475467] dark:text-slate-400">
                Scheduled quarterly earnings, financial results, and board meetings across exchanges
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={() => fetchCalendar(true, true)}
              disabled={loading || refreshing}
              className={`inline-flex items-center gap-2 h-11 px-[18px] rounded-xl border border-[#D0D5DD] dark:border-slate-700 bg-white dark:bg-slate-900 text-[#0F172A] dark:text-slate-200 text-sm font-semibold hover:bg-[#F9FAFB] dark:hover:bg-slate-800 transition-colors shadow-2xs ${
                loading || refreshing ? "opacity-60 cursor-not-allowed" : "cursor-pointer"
              }`}
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} strokeWidth={1.8} />
              <span>{refreshing ? "Refreshing..." : "Refresh Calendar"}</span>
            </button>
          </div>
        </div>

        {error && (
          <div className="p-4 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* ─── 3 KPI Stat Cards (Compact Height & Black Border Highlight on Active) ─── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Card 1: Total Scheduled */}
          <div
            onClick={() => setTimingFilter("ALL")}
            className={`bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 cursor-pointer transition-all ${
              timingFilter === "ALL"
                ? "border-2 border-[#0F172A] dark:border-white shadow-md ring-1 ring-[#0F172A]/10"
                : "border-2 border-[#E5E8EE] dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-600 shadow-[0_1px_2px_rgba(16,24,40,0.04)]"
            }`}
          >
            <div className="flex justify-between items-center">
              <span className="text-xs font-semibold tracking-[0.07em] uppercase text-[#475467] dark:text-slate-400">
                Total Scheduled
              </span>
              <span className="w-8 h-8 rounded-lg bg-[#F2F4F7] dark:bg-slate-800 text-[#344054] dark:text-slate-300 grid place-items-center">
                <Layers className="w-4 h-4" strokeWidth={1.8} />
              </span>
            </div>
            <div className="mt-2 text-[30px] font-bold tracking-[-0.02em] leading-tight tabular-nums text-[#0F172A] dark:text-white">
              {stats.total.toLocaleString()}
            </div>
            <div className="mt-0.5 text-xs text-[#667085] dark:text-slate-400">
              Board meetings tracked from exchange feed
            </div>
          </div>

          {/* Card 2: Results Today */}
          <div
            onClick={() => setTimingFilter("TODAY")}
            className={`bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 cursor-pointer transition-all ${
              timingFilter === "TODAY"
                ? "border-2 border-[#0F172A] dark:border-white shadow-md ring-1 ring-[#0F172A]/10"
                : "border-2 border-[#E5E8EE] dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-600 shadow-[0_1px_2px_rgba(16,24,40,0.04)]"
            }`}
          >
            <div className="flex justify-between items-center">
              <span className="text-xs font-semibold tracking-[0.07em] uppercase text-[#1849A9] dark:text-blue-400">
                Results Today
              </span>
              <span className="w-8 h-8 rounded-lg bg-[#EFF4FF] dark:bg-blue-950/40 text-[#1849A9] dark:text-blue-400 grid place-items-center">
                <Clock className="w-4 h-4" strokeWidth={1.8} />
              </span>
            </div>
            <div className="mt-2 text-[30px] font-bold tracking-[-0.02em] leading-tight tabular-nums text-[#0F172A] dark:text-white">
              {stats.today.toLocaleString()}
            </div>
            <div className="mt-0.5 text-xs text-[#667085] dark:text-slate-400">
              Scheduled for corporate disclosure today
            </div>
          </div>

          {/* Card 3: Upcoming Results */}
          <div
            onClick={() => setTimingFilter("UPCOMING")}
            className={`bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 cursor-pointer transition-all ${
              timingFilter === "UPCOMING"
                ? "border-2 border-[#0F172A] dark:border-white shadow-md ring-1 ring-[#0F172A]/10"
                : "border-2 border-[#E5E8EE] dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-600 shadow-[0_1px_2px_rgba(16,24,40,0.04)]"
            }`}
          >
            <div className="flex justify-between items-center">
              <span className="text-xs font-semibold tracking-[0.07em] uppercase text-[#067647] dark:text-emerald-400">
                Upcoming Results
              </span>
              <span className="w-8 h-8 rounded-lg bg-[#ECFDF3] dark:bg-emerald-950/40 text-[#067647] dark:text-emerald-400 grid place-items-center">
                <Calendar className="w-4 h-4" strokeWidth={1.8} />
              </span>
            </div>
            <div className="mt-2 text-[30px] font-bold tracking-[-0.02em] leading-tight tabular-nums text-[#0F172A] dark:text-white">
              {stats.upcoming.toLocaleString()}
            </div>
            <div className="mt-0.5 text-xs text-[#667085] dark:text-slate-400">
              Future board dates scheduled on calendar
            </div>
          </div>
        </div>

        {/* ─── Search Bar & Black Border Segmented Filters (Matching SEBI & News Feed) ─── */}
        <div className="flex flex-wrap gap-4 items-center justify-between">
          <label className="flex items-center gap-2.5 h-12 px-4 bg-white dark:bg-slate-900 border border-[#D0D5DD] dark:border-slate-700 rounded-xl flex-1 max-w-[460px] text-[#667085] focus-within:border-[#1F5EFF] focus-within:ring-3 focus-within:ring-[#D1E0FF] transition-all">
            <Search className="w-[18px] h-[18px] text-[#667085]" strokeWidth={1.8} />
            <input
              type="search"
              placeholder="Search security code, company name, short name..."
              aria-label="Search results calendar"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="border-0 outline-none flex-1 min-w-0 bg-transparent text-sm text-[#0F172A] dark:text-white placeholder:text-[#667085]"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="text-[#667085] hover:text-[#0F172A] dark:hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </label>

          <div className="flex flex-wrap gap-3 items-center">
            {/* Filter Buttons with Black Border & Solid Black on Active */}
            <div className="flex flex-wrap items-center gap-2 sm:gap-2.5" role="group" aria-label="Filter by schedule">
              {[
                { id: "ALL" as const, label: "All Scheduled", count: stats.total },
                { id: "TODAY" as const, label: "Today", count: stats.today },
                { id: "UPCOMING" as const, label: "Upcoming", count: stats.upcoming },
                { id: "PAST" as const, label: "Past", count: stats.past },
              ].map((tab) => {
                const active = timingFilter === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setTimingFilter(tab.id)}
                    className={`inline-flex items-center gap-2 h-11 px-3.5 sm:px-4 rounded-xl text-[13.5px] font-semibold whitespace-nowrap transition-all cursor-pointer ${
                      active
                        ? "bg-black dark:bg-white text-white dark:text-black border border-black dark:border-white shadow-xs"
                        : "bg-white dark:bg-slate-900 text-black dark:text-white border border-black dark:border-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 shadow-2xs"
                    }`}
                  >
                    <span>{tab.label}</span>
                    <span
                      className={`text-xs px-2.5 py-0.5 rounded-full font-semibold tabular-nums transition-colors ${
                        active
                          ? "bg-white dark:bg-black text-black dark:text-white"
                          : "bg-[#E9ECEF] dark:bg-slate-800 text-slate-800 dark:text-slate-300"
                      }`}
                    >
                      {tab.count.toLocaleString()}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Date Sort Toggle */}
            <button
              onClick={() => setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"))}
              className="inline-flex items-center gap-2 h-11 px-4 rounded-xl border border-black dark:border-slate-400 bg-white dark:bg-slate-900 text-black dark:text-slate-200 text-[13.5px] font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer shadow-2xs"
            >
              <span>Date</span>
              {sortOrder === "asc" ? (
                <ArrowUp className="w-4 h-4 text-black dark:text-slate-200" strokeWidth={1.8} />
              ) : (
                <ArrowDown className="w-4 h-4 text-black dark:text-slate-200" strokeWidth={1.8} />
              )}
            </button>
          </div>
        </div>

        {/* ─── Data Table matching SEBI Shield & News Feed Exactly ─── */}
        <div className="bg-white dark:bg-slate-900 border border-[#E5E8EE] dark:border-slate-800 rounded-2xl shadow-[0_1px_2px_rgba(16,24,40,0.04)] overflow-hidden">
          <div className="overflow-x-auto">
            <div className="min-w-[960px]">
              {/* Header Columns */}
              <div
                className="grid gap-4 items-center px-6 h-12 bg-[#F9FAFB] dark:bg-slate-800/60 text-[11.5px] font-semibold tracking-[0.07em] uppercase text-[#667085] dark:text-slate-400 select-none"
                style={{ gridTemplateColumns: "minmax(280px, 3.2fr) 1.2fr 1.6fr minmax(240px, 2.8fr) 64px" }}
              >
                <span>Company &amp; Security Code</span>
                <span>Exchange</span>
                <span>Scheduled Date &amp; Status</span>
                <span>Meeting Subject &amp; Agenda</span>
                <span className="text-right">Notice</span>
              </div>

              {/* Data Rows */}
              {loading && rows.length === 0 ? (
                <div className="px-6 py-16 text-center text-sm text-[#667085] flex flex-col items-center justify-center gap-2">
                  <RefreshCw className="w-5 h-5 animate-spin text-[#1F5EFF]" />
                  <span>Loading exchange results calendar...</span>
                </div>
              ) : paginatedRows.length === 0 ? (
                <div className="px-6 py-16 text-center text-sm text-[#667085]">
                  No scheduled earnings or board results found for the current query.
                </div>
              ) : (
                paginatedRows.map((row) => {
                  const badge = getStatusBadge(row.resultDate);

                  return (
                    <div
                      key={`${row.securityCode}-${row.resultDate}-${row.shortName}`}
                      className="grid gap-4 items-center px-6 min-h-[68px] border-t border-[#EAECF0] dark:border-slate-800 hover:bg-[#F9FAFB] dark:hover:bg-slate-800/40 transition-colors group"
                      style={{ gridTemplateColumns: "minmax(280px, 3.2fr) 1.2fr 1.6fr minmax(240px, 2.8fr) 64px" }}
                    >
                      {/* Company & Security Code */}
                      <div className="py-3">
                        <a
                          href={row.url || "#"}
                          target="_blank"
                          rel="noreferrer"
                          className="block text-[14.5px] font-semibold leading-[1.35] text-[#0F172A] dark:text-white group-hover:text-[#1F5EFF] dark:group-hover:text-blue-400 transition-colors"
                        >
                          {row.companyName || row.shortName}
                        </a>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="font-mono text-xs font-semibold text-[#1F5EFF] dark:text-blue-400 bg-blue-50 dark:bg-blue-950/60 px-2 py-0.5 rounded border border-blue-100 dark:border-blue-900/40">
                            {row.securityCode}
                          </span>
                          {row.shortName && row.shortName !== row.companyName && (
                            <span className="text-xs text-[#667085] dark:text-slate-400 font-medium">
                              {row.shortName}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Exchange Pill */}
                      <div>
                        <span className="inline-flex items-center gap-1.5 h-[26px] px-2.5 rounded-full text-xs font-semibold bg-[#ECFDF3] dark:bg-emerald-950/40 text-[#067647] dark:text-emerald-400 border border-[#ABEFC6] dark:border-emerald-800/60">
                          <i className="w-1.5 h-1.5 rounded-full inline-block bg-[#12B76A]" />
                          BSE Corporate
                        </span>
                      </div>

                      {/* Scheduled Date & Status */}
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[13.5px] font-semibold text-[#344054] dark:text-slate-200 tabular-nums">
                          {formatDisplayDate(row.resultDate)}
                        </span>
                        <span
                          className="inline-flex items-center gap-1.5 h-[24px] px-2 rounded-full text-[11px] font-semibold uppercase whitespace-nowrap"
                          style={{ background: badge.bg, color: badge.text }}
                        >
                          <i className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: badge.dot }} />
                          {badge.label}
                        </span>
                      </div>

                      {/* Meeting Agenda */}
                      <div className="text-xs text-[#475467] dark:text-slate-300 leading-relaxed pr-2">
                        <span className="font-semibold text-[#0F172A] dark:text-slate-100">
                          Quarterly Financial Results
                        </span>
                        <div className="text-[11.5px] text-[#667085] dark:text-slate-400 mt-0.5 truncate">
                          Board meeting to consider and approve standalone / consolidated financials.
                        </div>
                      </div>

                      {/* Official Notice Link */}
                      <div className="flex justify-end">
                        {row.url ? (
                          <a
                            href={row.url}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`Open BSE notice for ${row.companyName}`}
                            className="w-11 h-11 grid place-items-center rounded-xl border border-[#E5E8EE] dark:border-slate-700 bg-white dark:bg-slate-800 text-[#475467] dark:text-slate-300 hover:bg-[#F2F4F7] dark:hover:bg-slate-700 hover:text-[#0F172A] transition-colors shadow-2xs"
                          >
                            <ExternalLink className="w-4 h-4" strokeWidth={1.8} />
                          </a>
                        ) : (
                          <span className="w-11 h-11 grid place-items-center text-slate-300 dark:text-slate-700 text-xs">
                            —
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* ─── Fluid Table Pagination Footer ─── */}
          <div className="flex flex-wrap gap-4 items-center justify-between px-6 py-4 bg-white dark:bg-slate-900 border-t border-[#EAECF0] dark:border-slate-800 text-xs text-[#475467] dark:text-slate-400 select-none">
            <div className="flex items-center gap-2">
              <span>Rows per page:</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
                className="bg-[#F9FAFB] dark:bg-slate-800 border border-[#D0D5DD] dark:border-slate-700 rounded-lg px-2 py-1 text-xs font-semibold text-[#0F172A] dark:text-white outline-none cursor-pointer"
              >
                <option value={15}>15</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
              <span className="ml-2 font-medium">
                Showing {filteredRows.length === 0 ? 0 : (page - 1) * pageSize + 1} &ndash;{" "}
                {Math.min(page * pageSize, filteredRows.length)} of {filteredRows.length.toLocaleString()} announcements
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setPage(1)}
                disabled={page <= 1}
                aria-label="First page"
                className="w-8 h-8 rounded-lg border border-[#D0D5DD] dark:border-slate-700 bg-white dark:bg-slate-800 grid place-items-center text-[#475467] dark:text-slate-300 hover:bg-[#F9FAFB] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                <ChevronsLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                aria-label="Previous page"
                className="w-8 h-8 rounded-lg border border-[#D0D5DD] dark:border-slate-700 bg-white dark:bg-slate-800 grid place-items-center text-[#475467] dark:text-slate-300 hover:bg-[#F9FAFB] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <span className="px-3 py-1 font-semibold text-[#0F172A] dark:text-white tabular-nums">
                Page {page} of {totalPages}
              </span>

              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                aria-label="Next page"
                className="w-8 h-8 rounded-lg border border-[#D0D5DD] dark:border-slate-700 bg-white dark:bg-slate-800 grid place-items-center text-[#475467] dark:text-slate-300 hover:bg-[#F9FAFB] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <button
                onClick={() => setPage(totalPages)}
                disabled={page >= totalPages}
                aria-label="Last page"
                className="w-8 h-8 rounded-lg border border-[#D0D5DD] dark:border-slate-700 bg-white dark:bg-slate-800 grid place-items-center text-[#475467] dark:text-slate-300 hover:bg-[#F9FAFB] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                <ChevronsRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
