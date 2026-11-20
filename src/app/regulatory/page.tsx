"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Shield,
  Search,
  RefreshCw,
  Play,
  ArrowDown,
  ArrowUp,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Users,
  Building2,
  FileWarning,
  ShieldAlert,
} from "lucide-react";

interface ScrapedEntity {
  id: number;
  source_id: string;
  name: string;
  din_number?: string;
  pan_number?: string;
  cin_number?: string;
  date_of_publish?: string;
  link_to_circular?: string;
  issuing_body?: string;
  circular_number?: string;
  status?: string;
  action_type?: string;
}

const parseDateToUnix = (dateStr?: string | null): number => {
  if (!dateStr || dateStr === "N/A" || dateStr === "null" || dateStr === "undefined") {
    return 0;
  }
  const trimmed = dateStr.trim();
  const parsed = Date.parse(trimmed);
  if (!isNaN(parsed)) return parsed;

  const parts = trimmed.split(/[-/.]/);
  if (parts.length === 3) {
    if (parts[2].length === 4) {
      const day = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const year = parseInt(parts[2], 10);
      const d = new Date(year, month, day);
      if (!isNaN(d.getTime())) return d.getTime();
    } else if (parts[0].length === 4) {
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      const d = new Date(year, month, day);
      if (!isNaN(d.getTime())) return d.getTime();
    }
  }
  return 0;
};

const formatDisplayDate = (dateStr?: string | null): string => {
  if (!dateStr || dateStr === "N/A" || dateStr === "null" || dateStr === "undefined") {
    return "—";
  }
  const timestamp = parseDateToUnix(dateStr);
  if (!timestamp) return dateStr;
  const d = new Date(timestamp);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const day = d.getDate();
  const month = months[d.getMonth()];
  const year = d.getFullYear();
  return `${day} ${month} ${year}`;
};

const getEntityIdentifier = (item: ScrapedEntity): { type: string; val: string } => {
  if (item.din_number && item.din_number !== "null" && item.din_number !== "undefined") {
    return { type: "DIN", val: item.din_number };
  }
  if (item.pan_number && item.pan_number !== "null" && item.pan_number !== "undefined") {
    return { type: "PAN", val: item.pan_number };
  }
  if (item.cin_number && item.cin_number !== "null" && item.cin_number !== "undefined") {
    return { type: "CIN", val: item.cin_number };
  }
  if (item.circular_number && item.circular_number !== "null" && item.circular_number !== "undefined") {
    return { type: "REF", val: item.circular_number };
  }

  // Extract from circular link
  if (item.link_to_circular) {
    // NSE circular pattern: /INVG76139.zip, /CML76137.pdf, /CMPT76138.pdf
    const nseMatch = item.link_to_circular.match(/\/([A-Z0-9_-]{4,25})\.(pdf|zip|html)$/i);
    if (nseMatch && nseMatch[1]) {
      return { type: "REF", val: nseMatch[1] };
    }
    // RBI notification pattern: Id=12922
    const rbiMatch = item.link_to_circular.match(/[?&]Id=(\d+)/i);
    if (rbiMatch && rbiMatch[1]) {
      return { type: "REF", val: `RBI-${rbiMatch[1]}` };
    }
    // SEBI order pattern: _104110.html
    const sebiMatch = item.link_to_circular.match(/_(\d+)\.html$/i);
    if (sebiMatch && sebiMatch[1]) {
      return { type: "REF", val: `SEBI-${sebiMatch[1]}` };
    }
  }

  return { type: "REF", val: `ACT-${item.id}` };
};

export default function RegulatoryPage() {
  const [entities, setEntities] = useState<ScrapedEntity[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterSource, setFilterSource] = useState<string>("all");
  const [sortOrder, setSortOrder] = useState<"desc" | "asc">("desc");
  const [isLoading, setIsLoading] = useState(false);
  const [isRunningPipeline, setIsRunningPipeline] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pagination for fluid table performance
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const fetchEntities = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/regulatory/entities?page_size=5000", { cache: "no-store" });
      if (!response.ok) throw new Error("Failed to fetch entities");
      const data = await response.json();
      setEntities(data.entities || []);
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to connect to Scraper API");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const runPipeline = async () => {
    setIsRunningPipeline(true);
    setError(null);
    try {
      const response = await fetch("/api/regulatory/pipeline", {
        method: "POST",
      });
      if (!response.ok) throw new Error("Failed to run pipeline");
      await fetchEntities();
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to run pipeline");
    } finally {
      setIsRunningPipeline(false);
    }
  };

  useEffect(() => {
    fetchEntities();
  }, [fetchEntities]);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, filterSource]);

  const filteredEntities = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return entities
      .filter((e) => {
        const matchesFilter = filterSource === "all" || e.source_id === filterSource;
        if (!matchesFilter) return false;
        if (!q) return true;
        const ident = getEntityIdentifier(e);
        const context = `${e.name} ${ident.val} ${e.din_number || ""} ${e.pan_number || ""} ${e.cin_number || ""} ${e.issuing_body || ""} ${e.circular_number || ""}`.toLowerCase();
        return context.includes(q);
      })
      .sort((a, b) => {
        const timeA = parseDateToUnix(a.date_of_publish);
        const timeB = parseDateToUnix(b.date_of_publish);
        if (timeA !== timeB) {
          return sortOrder === "desc" ? timeB - timeA : timeA - timeB;
        }
        return sortOrder === "desc" ? (b.id ?? 0) - (a.id ?? 0) : (a.id ?? 0) - (b.id ?? 0);
      });
  }, [entities, searchQuery, filterSource, sortOrder]);

  const totalPages = Math.max(1, Math.ceil(filteredEntities.length / pageSize));
  const paginatedEntities = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredEntities.slice(start, start + pageSize);
  }, [filteredEntities, page, pageSize]);

  const stats = useMemo(() => {
    return {
      total: entities.length,
      sebi: entities.filter((e) => e.source_id === "sebi_orders").length,
      nse: entities.filter((e) => e.source_id === "nse_circulars").length,
      bse: entities.filter((e) => e.source_id === "bse_notices").length,
      nse_bse: entities.filter((e) => e.source_id === "nse_circulars" || e.source_id === "bse_notices").length,
      rbi: entities.filter((e) => e.source_id === "rbi_standalone_circulars").length,
    };
  }, [entities]);

  const sourceTabs = [
    { id: "all", label: "All Sources", count: stats.total },
    { id: "sebi_orders", label: "SEBI Orders", count: stats.sebi },
    { id: "nse_circulars", label: "NSE Circulars", count: stats.nse },
    { id: "bse_notices", label: "BSE Notices", count: stats.bse },
    { id: "rbi_standalone_circulars", label: "RBI Actions", count: stats.rbi },
  ];

  const getSourceBadge = (sourceId: string) => {
    switch (sourceId) {
      case "sebi_orders":
        return {
          label: "SEBI Orders",
          bg: "#FEF3F2",
          text: "#B42318",
          dot: "#D92D20",
          darkBg: "rgba(254, 243, 242, 0.15)",
          darkText: "#F97066",
        };
      case "nse_circulars":
        return {
          label: "NSE Circulars",
          bg: "#EFF4FF",
          text: "#1849A9",
          dot: "#2E6BFF",
          darkBg: "rgba(239, 244, 255, 0.15)",
          darkText: "#84ADFF",
        };
      case "bse_notices":
        return {
          label: "BSE Notices",
          bg: "#ECFDF3",
          text: "#067647",
          dot: "#12B76A",
          darkBg: "rgba(236, 253, 243, 0.15)",
          darkText: "#6CE9A6",
        };
      case "rbi_standalone_circulars":
        return {
          label: "RBI Actions",
          bg: "#FFFAEB",
          text: "#B54708",
          dot: "#DC6803",
          darkBg: "rgba(255, 250, 235, 0.15)",
          darkText: "#FDB022",
        };
      default:
        return {
          label: sourceId.replace(/_/g, " ").toUpperCase(),
          bg: "#F2F4F7",
          text: "#344054",
          dot: "#667085",
          darkBg: "rgba(242, 244, 247, 0.15)",
          darkText: "#98A2B3",
        };
    }
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
            <span
              className="w-[52px] h-[52px] rounded-[14px] bg-[#ECFDF3] dark:bg-emerald-950/40 text-[#067647] dark:text-emerald-400 border border-[#ABEFC6] dark:border-emerald-800/60 grid place-items-center shrink-0 shadow-xs"
            >
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6l7-3z" />
                <path d="M9 12l2 2 4-4" />
              </svg>
            </span>
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="m-0 text-[28px] font-bold tracking-[-0.02em] text-[#0F172A] dark:text-white">
                  SEBI Regulatory Shield
                </h1>
                <span className="px-2.5 py-1 border border-[#D0D5DD] dark:border-slate-700 rounded-full bg-white dark:bg-slate-800 text-[11px] font-semibold tracking-[0.1em] text-[#475467] dark:text-slate-300">
                  INDIA ONLY
                </span>
              </div>
              <p className="mt-1.5 mb-0 text-[14.5px] text-[#475467] dark:text-slate-400">
                Strictly monitoring SEBI, NSE, BSE, and RBI actions with source provenance
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={fetchEntities}
              disabled={isLoading || isRunningPipeline}
              className={`inline-flex items-center gap-2 h-11 px-[18px] rounded-xl border border-[#D0D5DD] dark:border-slate-700 bg-white dark:bg-slate-900 text-[#0F172A] dark:text-slate-200 text-sm font-semibold hover:bg-[#F9FAFB] dark:hover:bg-slate-800 transition-colors shadow-2xs ${
                isLoading || isRunningPipeline ? "opacity-60 cursor-not-allowed" : "cursor-pointer"
              }`}
            >
              <svg
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={isLoading ? "animate-spin" : ""}
                aria-hidden="true"
              >
                <path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7" />
              </svg>
              <span>{isLoading ? "Refreshing..." : "Refresh Feed"}</span>
            </button>

            <button
              onClick={runPipeline}
              disabled={isLoading || isRunningPipeline}
              className={`inline-flex items-center gap-2 h-11 px-[18px] rounded-xl border border-[#1F5EFF] bg-[#1F5EFF] text-white text-sm font-semibold hover:bg-blue-600 transition-colors shadow-sm ${
                isLoading || isRunningPipeline ? "opacity-60 cursor-not-allowed" : "cursor-pointer"
              }`}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M7 4l13 8-13 8V4z" />
              </svg>
              <span>{isRunningPipeline ? "Running Pipeline..." : "Run Pipeline"}</span>
            </button>
          </div>
        </div>

        {error && (
          <div className="p-4 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* ─── 4 KPI Stat Cards (Compact Height & Black Border on Active) ─── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          
          {/* Card 1: Total Actions */}
          <div
            onClick={() => setFilterSource("all")}
            className={`bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 cursor-pointer transition-all ${
              filterSource === "all"
                ? "border-2 border-[#0F172A] dark:border-white shadow-md ring-1 ring-[#0F172A]/10"
                : "border-2 border-[#E5E8EE] dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-600 shadow-[0_1px_2px_rgba(16,24,40,0.04)]"
            }`}
          >
            <div className="flex justify-between items-center">
              <span className="text-xs font-semibold tracking-[0.07em] uppercase text-[#475467] dark:text-slate-400">
                Total Actions
              </span>
              <span className="w-8 h-8 rounded-lg bg-[#F2F4F7] dark:bg-slate-800 text-[#344054] dark:text-slate-300 grid place-items-center">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <circle cx="9" cy="8" r="3.2" />
                  <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 5.2a3 3 0 010 5.6M18 14.3c1.8.8 3 2.6 3 4.7" />
                </svg>
              </span>
            </div>
            <div className="mt-2 text-[30px] font-bold tracking-[-0.02em] leading-tight tabular-nums text-[#0F172A] dark:text-white">
              {stats.total.toLocaleString()}
            </div>
            <div className="mt-0.5 text-xs text-[#667085] dark:text-slate-400">
              Regulatory records tracked
            </div>
          </div>

          {/* Card 2: SEBI Actions */}
          <div
            onClick={() => setFilterSource("sebi_orders")}
            className={`bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 cursor-pointer transition-all ${
              filterSource === "sebi_orders"
                ? "border-2 border-[#0F172A] dark:border-white shadow-md ring-1 ring-[#0F172A]/10"
                : "border-2 border-[#E5E8EE] dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-600 shadow-[0_1px_2px_rgba(16,24,40,0.04)]"
            }`}
          >
            <div className="flex justify-between items-center">
              <span className="text-xs font-semibold tracking-[0.07em] uppercase text-[#B42318] dark:text-rose-400">
                SEBI Actions
              </span>
              <span className="w-8 h-8 rounded-lg bg-[#FEF3F2] dark:bg-rose-950/40 text-[#B42318] dark:text-rose-400 grid place-items-center">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6l7-3zM12 8.5v4M12 15.5h.01" />
                </svg>
              </span>
            </div>
            <div className="mt-2 text-[30px] font-bold tracking-[-0.02em] leading-tight tabular-nums text-[#0F172A] dark:text-white">
              {stats.sebi.toLocaleString()}
            </div>
            <div className="mt-0.5 text-xs text-[#667085] dark:text-slate-400">
              Debarred / Banned / Penalized
            </div>
          </div>

          {/* Card 3: Exchange Surveillance */}
          <div
            onClick={() => setFilterSource("nse_circulars")}
            className={`bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 cursor-pointer transition-all ${
              filterSource === "nse_circulars" || filterSource === "bse_notices"
                ? "border-2 border-[#0F172A] dark:border-white shadow-md ring-1 ring-[#0F172A]/10"
                : "border-2 border-[#E5E8EE] dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-600 shadow-[0_1px_2px_rgba(16,24,40,0.04)]"
            }`}
          >
            <div className="flex justify-between items-center">
              <span className="text-xs font-semibold tracking-[0.07em] uppercase text-[#1849A9] dark:text-blue-400">
                Exchange Surveillance
              </span>
              <span className="w-8 h-8 rounded-lg bg-[#EFF4FF] dark:bg-blue-950/40 text-[#1849A9] dark:text-blue-400 grid place-items-center">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d="M4 21V5l8-2v18M12 8h8v13M2 21h20M8 9h1M8 13h1M8 17h1M16 12h1M16 16h1" />
                </svg>
              </span>
            </div>
            <div className="mt-2 text-[30px] font-bold tracking-[-0.02em] leading-tight tabular-nums text-[#0F172A] dark:text-white">
              {stats.nse_bse.toLocaleString()}
            </div>
            <div className="mt-0.5 text-xs text-[#667085] dark:text-slate-400">
              NSE / BSE Restrictions
            </div>
          </div>

          {/* Card 4: RBI Actions */}
          <div
            onClick={() => setFilterSource("rbi_standalone_circulars")}
            className={`bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 cursor-pointer transition-all ${
              filterSource === "rbi_standalone_circulars"
                ? "border-2 border-[#0F172A] dark:border-white shadow-md ring-1 ring-[#0F172A]/10"
                : "border-2 border-[#E5E8EE] dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-600 shadow-[0_1px_2px_rgba(16,24,40,0.04)]"
            }`}
          >
            <div className="flex justify-between items-center">
              <span className="text-xs font-semibold tracking-[0.07em] uppercase text-[#B54708] dark:text-amber-400">
                RBI Actions
              </span>
              <span className="w-8 h-8 rounded-lg bg-[#FFFAEB] dark:bg-amber-950/40 text-[#B54708] dark:text-amber-400 grid place-items-center">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d="M12 3l10 18H2L12 3zM12 10v5M12 18h.01" />
                </svg>
              </span>
            </div>
            <div className="mt-2 text-[30px] font-bold tracking-[-0.02em] leading-tight tabular-nums text-[#0F172A] dark:text-white">
              {stats.rbi.toLocaleString()}
            </div>
            <div className="mt-0.5 text-xs text-[#667085] dark:text-slate-400">
              Banking &amp; NBFC Circulars
            </div>
          </div>
        </div>

        {/* ─── Search Bar & Segmented Source Filters ─── */}
        <div className="flex flex-wrap gap-4 items-center justify-between">
          <label className="flex items-center gap-2.5 h-12 px-4 bg-white dark:bg-slate-900 border border-[#D0D5DD] dark:border-slate-700 rounded-xl flex-1 max-w-[460px] text-[#667085] focus-within:border-[#1F5EFF] focus-within:ring-3 focus-within:ring-[#D1E0FF] transition-all">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
            <input
              type="search"
              placeholder="Search entity, DIN, PAN, or circular..."
              aria-label="Search entity, DIN, PAN, or circular"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="border-0 outline-none flex-1 min-w-0 bg-transparent text-sm text-[#0F172A] dark:text-white placeholder:text-[#667085]"
            />
          </label>

          <div className="flex flex-wrap gap-3 items-center">
            {/* Source Filter Buttons (Black border on each box, solid black when active) */}
            <div className="flex flex-wrap items-center gap-2 sm:gap-2.5" role="group" aria-label="Filter by source">
              {sourceTabs.map((tab) => {
                const active = filterSource === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setFilterSource(tab.id)}
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
              onClick={() => setSortOrder((prev) => (prev === "desc" ? "asc" : "desc"))}
              className="inline-flex items-center gap-2 h-11 px-4 rounded-xl border border-black dark:border-slate-400 bg-white dark:bg-slate-900 text-black dark:text-slate-200 text-[13.5px] font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer shadow-2xs"
            >
              <span>Date</span>
              {sortOrder === "desc" ? (
                <ArrowDown className="w-4 h-4 text-black dark:text-slate-200" strokeWidth={1.8} />
              ) : (
                <ArrowUp className="w-4 h-4 text-black dark:text-slate-200" strokeWidth={1.8} />
              )}
            </button>
          </div>
        </div>

        {/* ─── Data Table matching HTML & Mockup Exactly ─── */}
        <div className="bg-white dark:bg-slate-900 border border-[#E5E8EE] dark:border-slate-800 rounded-2xl shadow-[0_1px_2px_rgba(16,24,40,0.04)] overflow-hidden">
          <div className="overflow-x-auto">
            <div className="min-w-[960px]">
              
              {/* Header Columns */}
              <div
                className="grid gap-4 items-center px-6 h-12 bg-[#F9FAFB] dark:bg-slate-800/60 text-[11.5px] font-semibold tracking-[0.07em] uppercase text-[#667085] dark:text-slate-400 select-none"
                style={{ gridTemplateColumns: "minmax(280px, 3.2fr) 1.3fr 1.5fr 1.3fr 1.0fr 64px" }}
              >
                <span>Entity &amp; Regulatory Context</span>
                <span>Authority</span>
                <span>Action &amp; Status</span>
                <span>Identifiers</span>
                <span>Publish Date</span>
                <span className="text-right">Order</span>
              </div>

              {/* Data Rows */}
              {isLoading ? (
                <div className="px-6 py-16 text-center text-sm text-[#667085] flex flex-col items-center justify-center gap-2">
                  <RefreshCw className="w-5 h-5 animate-spin text-[#1F5EFF]" />
                  <span>Loading regulatory feed...</span>
                </div>
              ) : paginatedEntities.length === 0 ? (
                <div className="px-6 py-16 text-center text-sm text-[#667085]">
                  No matching regulatory actions found.
                </div>
              ) : (
                paginatedEntities.map((item) => {
                  const badge = getSourceBadge(item.source_id);
                  const link = item.link_to_circular;
                  const ident = getEntityIdentifier(item);

                  return (
                    <div
                      key={`${item.id}-${item.source_id}-${item.circular_number}`}
                      className="grid gap-4 items-center px-6 min-h-[64px] border-t border-[#EAECF0] dark:border-slate-800 hover:bg-[#F9FAFB] dark:hover:bg-slate-800/40 transition-colors group"
                      style={{ gridTemplateColumns: "minmax(280px, 3.2fr) 1.3fr 1.5fr 1.3fr 1.0fr 64px" }}
                    >
                      {/* Entity & Context (without Body field) */}
                      <div className="py-3">
                        <a
                          href={link || "#"}
                          target="_blank"
                          rel="noreferrer"
                          className="block text-[14.5px] font-semibold leading-[1.35] text-[#0F172A] dark:text-white group-hover:text-[#1F5EFF] dark:group-hover:text-blue-400 transition-colors"
                        >
                          {item.name}
                        </a>
                      </div>

                      {/* Authority */}
                      <div>
                        <span
                          className="inline-flex items-center gap-1.5 h-[26px] px-2.5 rounded-full text-xs font-semibold whitespace-nowrap"
                          style={{ background: badge.bg, color: badge.text }}
                        >
                          <i className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: badge.dot }} />
                          {badge.label}
                        </span>
                      </div>

                      {/* Action & Status */}
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[13px] font-semibold text-[#344054] dark:text-slate-300">
                          {item.action_type || "Regulatory Action"}
                        </span>
                        <span
                          className="inline-flex items-center gap-1.5 h-[26px] px-2.5 rounded-full text-xs font-semibold whitespace-nowrap"
                          style={
                            item.status === "ACTIVE"
                              ? { background: "#FEF3F2", color: "#B42318" }
                              : { background: "#F2F4F7", color: "#344054" }
                          }
                        >
                          <i
                            className="w-1.5 h-1.5 rounded-full inline-block"
                            style={{ background: item.status === "ACTIVE" ? "#D92D20" : "#667085" }}
                          />
                          {item.status || "ACTIVE"}
                        </span>
                      </div>

                      {/* Identifiers */}
                      <div className="text-[12.5px] font-mono whitespace-nowrap overflow-hidden text-ellipsis">
                        <span className="text-[10px] font-sans font-semibold text-[#667085] dark:text-slate-400 mr-1 uppercase">
                          {ident.type}:
                        </span>
                        <span className="font-semibold text-[#0F172A] dark:text-slate-200">
                          {ident.val}
                        </span>
                      </div>

                      {/* Publish Date */}
                      <div className="text-[13.5px] font-medium text-[#344054] dark:text-slate-300 whitespace-nowrap tabular-nums">
                        {formatDisplayDate(item.date_of_publish)}
                      </div>

                      {/* Order Button */}
                      <div className="flex justify-end">
                        <a
                          href={link || "#"}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Open order: ${item.name}`}
                          className="w-11 h-11 grid place-items-center rounded-xl border border-[#E5E8EE] dark:border-slate-700 bg-white dark:bg-slate-800 text-[#475467] dark:text-slate-300 hover:bg-[#F2F4F7] dark:hover:bg-slate-700 hover:text-[#0F172A] transition-colors"
                        >
                          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5" />
                          </svg>
                        </a>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* ─── Clean Pagination Footer ─── */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-6 py-4 border-t border-[#EAECF0] dark:border-slate-800 bg-[#F9FAFB] dark:bg-slate-800/40 text-[13px] text-[#475467] dark:text-slate-400">
            <div className="flex items-center gap-2">
              <span>Rows per page:</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
                className="h-8 px-2 rounded-lg border border-[#D0D5DD] dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-[#0F172A] dark:text-slate-200 outline-none cursor-pointer"
              >
                <option value={15}>15</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
              <span className="ml-2 font-mono tabular-nums text-xs">
                {Math.min(filteredEntities.length, (page - 1) * pageSize + 1)}–
                {Math.min(filteredEntities.length, page * pageSize)} of {filteredEntities.length.toLocaleString()}
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setPage(1)}
                disabled={page <= 1}
                className="w-8 h-8 grid place-items-center rounded-lg border border-[#D0D5DD] dark:border-slate-700 bg-white dark:bg-slate-900 text-[#475467] dark:text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-[#F2F4F7] dark:hover:bg-slate-800 transition-colors"
                title="First Page"
              >
                <ChevronsLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="w-8 h-8 grid place-items-center rounded-lg border border-[#D0D5DD] dark:border-slate-700 bg-white dark:bg-slate-900 text-[#475467] dark:text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-[#F2F4F7] dark:hover:bg-slate-800 transition-colors"
                title="Previous Page"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="px-3 font-semibold text-[#0F172A] dark:text-white tabular-nums text-xs">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="w-8 h-8 grid place-items-center rounded-lg border border-[#D0D5DD] dark:border-slate-700 bg-white dark:bg-slate-900 text-[#475467] dark:text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-[#F2F4F7] dark:hover:bg-slate-800 transition-colors"
                title="Next Page"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <button
                onClick={() => setPage(totalPages)}
                disabled={page >= totalPages}
                className="w-8 h-8 grid place-items-center rounded-lg border border-[#D0D5DD] dark:border-slate-700 bg-white dark:bg-slate-900 text-[#475467] dark:text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-[#F2F4F7] dark:hover:bg-slate-800 transition-colors"
                title="Last Page"
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
