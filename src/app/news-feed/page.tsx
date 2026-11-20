"use client";

import { useCallback, useEffect, useMemo, useState, useDeferredValue } from "react";
import {
  Newspaper,
  Search,
  RefreshCw,
  Filter,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Layers,
  Building2,
  Landmark,
  FileText,
  X,
  ArrowDown,
  ArrowUp,
} from "lucide-react";

type NewsItem = {
  id: number;
  source: "NSE" | "BSE" | string;
  nse_index: string | null;
  symbol: string;
  company: string | null;
  subject: string | null;
  category: string | null;
  announced_at: string | null;
  pdf_url: string | null;
  content_hash: string;
  fetched_at: string;
};

type NewsApiResponse = {
  count: number;
  results: NewsItem[];
};

type SourceFilter = "ALL" | "NSE" | "BSE";

const POLL_MS = 60000;
const NSE_SEGMENT_OPTIONS = ["EQUITIES", "SME", "DEBT", "MF"] as const;

const toTimestamp = (value: string | null | undefined): number => {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const DATE_FORMATTER = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
});

const formatDate = (value: string | null): string => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return DATE_FORMATTER.format(date);
};

export default function NewsFeedPage() {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("ALL");
  const [detailFilter, setDetailFilter] = useState("ALL");
  const [pdfOnlyFilter, setPdfOnlyFilter] = useState(false);
  const [sortOrder, setSortOrder] = useState<"desc" | "asc">("desc");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pagination for fluid table performance
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const fetchNews = useCallback(async (isBackgroundRefresh = false) => {
    if (isBackgroundRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const response = await fetch("/api/news", { cache: "no-store" });
      const payload: NewsApiResponse = await response.json();

      if (!response.ok) {
        const message =
          payload && typeof payload === "object" && "detail" in payload
            ? String((payload as { detail?: unknown }).detail || "Failed to fetch news feed")
            : "Failed to fetch news feed";
        throw new Error(message);
      }

      setNews(Array.isArray(payload.results) ? payload.results : []);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to load news";
      setError(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchNews(false);

    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      fetchNews(true);
    }, POLL_MS);

    return () => clearInterval(timer);
  }, [fetchNews]);

  const bseCategoryOptions = useMemo(() => {
    const categories = new Set<string>();
    for (const item of news) {
      if (String(item.source || "").toUpperCase() !== "BSE") continue;
      const value = String(item.category || "").trim();
      if (value) categories.add(value);
    }
    return Array.from(categories).sort((a, b) => a.localeCompare(b));
  }, [news]);

  const detailOptions = useMemo(() => {
    const values = new Map<string, string>();

    if (sourceFilter === "ALL" || sourceFilter === "NSE") {
      for (const value of NSE_SEGMENT_OPTIONS) {
        values.set(value.toUpperCase(), value);
      }
    }

    if (sourceFilter === "ALL" || sourceFilter === "BSE") {
      for (const value of bseCategoryOptions) {
        const normalized = value.trim().toUpperCase();
        if (normalized && !values.has(normalized)) {
          values.set(normalized, value);
        }
      }
    }

    return [
      { value: "ALL", label: "All Categories" },
      ...Array.from(values.values()).map((value) => ({ value, label: value })),
    ];
  }, [sourceFilter, bseCategoryOptions]);

  useEffect(() => {
    const exists = detailOptions.some((option) => option.value === detailFilter);
    if (!exists) {
      setDetailFilter("ALL");
    }
  }, [detailOptions, detailFilter]);

  useEffect(() => {
    setPage(1);
  }, [deferredSearch, sourceFilter, detailFilter, pdfOnlyFilter, sortOrder]);

  const stats = useMemo(() => {
    const total = news.length;
    const nse = news.filter((item) => item.source?.toUpperCase() === "NSE").length;
    const bse = news.filter((item) => item.source?.toUpperCase() === "BSE").length;
    const withPdf = news.filter((item) => Boolean(item.pdf_url)).length;
    return { total, nse, bse, withPdf };
  }, [news]);

  const filteredNews = useMemo(() => {
    const query = deferredSearch.trim().toLowerCase();
    const normalizedDetail = detailFilter.trim().toUpperCase();

    return news
      .filter((item) => {
        const normalizedSource = (item.source || "").trim().toUpperCase();
        const normalizedNseIndex = (item.nse_index || "").trim().toUpperCase();
        const normalizedCategory = (item.category || "").trim().toUpperCase();

        const matchesSource = sourceFilter === "ALL" || normalizedSource === sourceFilter;
        if (!matchesSource) return false;

        if (pdfOnlyFilter && !item.pdf_url) return false;

        if (
          normalizedDetail !== "ALL" &&
          !(
            (normalizedSource === "NSE" && normalizedNseIndex === normalizedDetail) ||
            (normalizedSource === "BSE" && normalizedCategory === normalizedDetail)
          )
        ) {
          return false;
        }

        if (!query) return true;

        const text = `${item.symbol || ""} ${item.company || ""} ${item.subject || ""} ${item.category || ""} ${
          item.nse_index || ""
        }`.toLowerCase();
        return text.includes(query);
      })
      .sort((a, b) => {
        const timeA = toTimestamp(a.announced_at) || toTimestamp(a.fetched_at);
        const timeB = toTimestamp(b.announced_at) || toTimestamp(b.fetched_at);
        if (timeA !== timeB) {
          return sortOrder === "desc" ? timeB - timeA : timeA - timeB;
        }
        return sortOrder === "desc" ? b.id - a.id : a.id - b.id;
      });
  }, [news, deferredSearch, sourceFilter, detailFilter, pdfOnlyFilter, sortOrder]);

  const totalPages = Math.max(1, Math.ceil(filteredNews.length / pageSize));
  const paginatedNews = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredNews.slice(start, start + pageSize);
  }, [filteredNews, page, pageSize]);

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
              <Newspaper className="w-6 h-6" strokeWidth={1.8} />
            </span>
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="m-0 text-[28px] font-bold tracking-[-0.02em] text-[#0F172A] dark:text-white">
                  News Feed
                </h1>
                <span className="px-2.5 py-1 border border-[#D0D5DD] dark:border-slate-700 rounded-full bg-white dark:bg-slate-800 text-[11px] font-semibold tracking-[0.1em] text-[#475467] dark:text-slate-300">
                  NSE &amp; BSE LIVE
                </span>
              </div>
              <p className="mt-1.5 mb-0 text-[14.5px] text-[#475467] dark:text-slate-400">
                Live corporate announcements, filings, and regulatory disclosures
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={() => fetchNews(true)}
              disabled={loading || refreshing}
              className={`inline-flex items-center gap-2 h-11 px-[18px] rounded-xl border border-[#D0D5DD] dark:border-slate-700 bg-white dark:bg-slate-900 text-[#0F172A] dark:text-slate-200 text-sm font-semibold hover:bg-[#F9FAFB] dark:hover:bg-slate-800 transition-colors shadow-2xs ${
                loading || refreshing ? "opacity-60 cursor-not-allowed" : "cursor-pointer"
              }`}
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} strokeWidth={1.8} />
              <span>{refreshing ? "Refreshing..." : "Refresh Feed"}</span>
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
          {/* Card 1: Total Announcements */}
          <div
            onClick={() => setSourceFilter("ALL")}
            className={`bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 cursor-pointer transition-all ${
              sourceFilter === "ALL"
                ? "border-2 border-[#0F172A] dark:border-white shadow-md ring-1 ring-[#0F172A]/10"
                : "border-2 border-[#E5E8EE] dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-600 shadow-[0_1px_2px_rgba(16,24,40,0.04)]"
            }`}
          >
            <div className="flex justify-between items-center">
              <span className="text-xs font-semibold tracking-[0.07em] uppercase text-[#475467] dark:text-slate-400">
                Total Filings
              </span>
              <span className="w-8 h-8 rounded-lg bg-[#F2F4F7] dark:bg-slate-800 text-[#344054] dark:text-slate-300 grid place-items-center">
                <Layers className="w-4 h-4" strokeWidth={1.8} />
              </span>
            </div>
            <div className="mt-2 text-[30px] font-bold tracking-[-0.02em] leading-tight tabular-nums text-[#0F172A] dark:text-white">
              {stats.total.toLocaleString()}
            </div>
            <div className="mt-0.5 text-xs text-[#667085] dark:text-slate-400">
              Announcements tracked across exchanges
            </div>
          </div>

          {/* Card 2: NSE Announcements */}
          <div
            onClick={() => setSourceFilter("NSE")}
            className={`bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 cursor-pointer transition-all ${
              sourceFilter === "NSE"
                ? "border-2 border-[#0F172A] dark:border-white shadow-md ring-1 ring-[#0F172A]/10"
                : "border-2 border-[#E5E8EE] dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-600 shadow-[0_1px_2px_rgba(16,24,40,0.04)]"
            }`}
          >
            <div className="flex justify-between items-center">
              <span className="text-xs font-semibold tracking-[0.07em] uppercase text-[#1849A9] dark:text-blue-400">
                NSE Filings
              </span>
              <span className="w-8 h-8 rounded-lg bg-[#EFF4FF] dark:bg-blue-950/40 text-[#1849A9] dark:text-blue-400 grid place-items-center">
                <Building2 className="w-4 h-4" strokeWidth={1.8} />
              </span>
            </div>
            <div className="mt-2 text-[30px] font-bold tracking-[-0.02em] leading-tight tabular-nums text-[#0F172A] dark:text-white">
              {stats.nse.toLocaleString()}
            </div>
            <div className="mt-0.5 text-xs text-[#667085] dark:text-slate-400">
              Equities, SME &amp; Debt disclosures
            </div>
          </div>

          {/* Card 3: BSE Announcements */}
          <div
            onClick={() => setSourceFilter("BSE")}
            className={`bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 cursor-pointer transition-all ${
              sourceFilter === "BSE"
                ? "border-2 border-[#0F172A] dark:border-white shadow-md ring-1 ring-[#0F172A]/10"
                : "border-2 border-[#E5E8EE] dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-600 shadow-[0_1px_2px_rgba(16,24,40,0.04)]"
            }`}
          >
            <div className="flex justify-between items-center">
              <span className="text-xs font-semibold tracking-[0.07em] uppercase text-[#067647] dark:text-emerald-400">
                BSE Filings
              </span>
              <span className="w-8 h-8 rounded-lg bg-[#ECFDF3] dark:bg-emerald-950/40 text-[#067647] dark:text-emerald-400 grid place-items-center">
                <Landmark className="w-4 h-4" strokeWidth={1.8} />
              </span>
            </div>
            <div className="mt-2 text-[30px] font-bold tracking-[-0.02em] leading-tight tabular-nums text-[#0F172A] dark:text-white">
              {stats.bse.toLocaleString()}
            </div>
            <div className="mt-0.5 text-xs text-[#667085] dark:text-slate-400">
              Exchange corporate actions &amp; notices
            </div>
          </div>
        </div>

        {/* ─── Search Bar & Segmented Filters (Matching Regulatory Shield) ─── */}
        <div className="flex flex-wrap gap-4 items-center justify-between">
          <label className="flex items-center gap-2.5 h-12 px-4 bg-white dark:bg-slate-900 border border-[#D0D5DD] dark:border-slate-700 rounded-xl flex-1 max-w-[460px] text-[#667085] focus-within:border-[#1F5EFF] focus-within:ring-3 focus-within:ring-[#D1E0FF] transition-all">
            <Search className="w-[18px] h-[18px] text-[#667085]" strokeWidth={1.8} />
            <input
              type="search"
              placeholder="Search symbol, company, subject, category..."
              aria-label="Search announcements"
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
            {/* Source Filter Buttons (Black border on each box, solid black when active) */}
            <div className="flex flex-wrap items-center gap-2 sm:gap-2.5" role="group" aria-label="Filter by source">
              {[
                { id: "ALL" as const, label: "All Sources", count: stats.total },
                { id: "NSE" as const, label: "NSE", count: stats.nse },
                { id: "BSE" as const, label: "BSE", count: stats.bse },
              ].map((tab) => {
                const active = sourceFilter === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setSourceFilter(tab.id)}
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

            {/* Category / Segment Dropdown (Fixed width so switching between NSE/BSE options does not resize the control) */}
            <div className="relative shrink-0">
              <label className="inline-flex items-center gap-2 h-11 w-[175px] shrink-0 px-3.5 rounded-xl border border-black dark:border-slate-400 bg-white dark:bg-slate-900 text-black dark:text-slate-200 text-[13.5px] font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer shadow-2xs">
                <Filter className="w-4 h-4 text-black dark:text-slate-200 shrink-0" strokeWidth={1.8} />
                <select
                  value={detailFilter}
                  onChange={(e) => setDetailFilter(e.target.value)}
                  className="w-full truncate bg-transparent border-0 outline-none text-[13.5px] font-semibold text-black dark:text-slate-200 cursor-pointer min-w-0"
                  aria-label="Filter by category"
                >
                  {detailOptions.map((opt) => (
                    <option key={opt.value} value={opt.value} className="bg-white dark:bg-slate-900 text-black dark:text-slate-200">
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
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

        {/* ─── Data Table matching Regulatory Shield Exactly ─── */}
        <div className="bg-white dark:bg-slate-900 border border-[#E5E8EE] dark:border-slate-800 rounded-2xl shadow-[0_1px_2px_rgba(16,24,40,0.04)] overflow-hidden">
          <div className="overflow-x-auto">
            <div className="min-w-[980px]">
              {/* Header Columns */}
              <div
                className="grid gap-4 items-center px-6 h-12 bg-[#F9FAFB] dark:bg-slate-800/60 text-[11.5px] font-semibold tracking-[0.07em] uppercase text-[#667085] dark:text-slate-400 select-none"
                style={{ gridTemplateColumns: "minmax(260px, 2.6fr) 1.0fr minmax(300px, 3.4fr) 1.2fr 1.3fr 64px" }}
              >
                <span>Company &amp; Symbol</span>
                <span>Exchange</span>
                <span>Announcement Subject</span>
                <span>Category / Segment</span>
                <span>Announced At</span>
                <span className="text-right">PDF</span>
              </div>

              {/* Data Rows */}
              {loading ? (
                <div className="px-6 py-16 text-center text-sm text-[#667085] flex flex-col items-center justify-center gap-2">
                  <RefreshCw className="w-5 h-5 animate-spin text-[#1F5EFF]" />
                  <span>Loading announcements...</span>
                </div>
              ) : paginatedNews.length === 0 ? (
                <div className="px-6 py-16 text-center text-sm text-[#667085]">
                  No matching corporate announcements found.
                </div>
              ) : (
                paginatedNews.map((item) => {
                  const isNse = item.source?.toUpperCase() === "NSE";
                  const segment = item.nse_index || item.category || "Equities";

                  return (
                    <div
                      key={`${item.id}-${item.content_hash}`}
                      className="grid gap-4 items-center px-6 min-h-[64px] border-t border-[#EAECF0] dark:border-slate-800 hover:bg-[#F9FAFB] dark:hover:bg-slate-800/40 transition-colors group"
                      style={{ gridTemplateColumns: "minmax(260px, 2.6fr) 1.0fr minmax(300px, 3.4fr) 1.2fr 1.3fr 64px" }}
                    >
                      {/* Company & Symbol */}
                      <div className="py-3 flex flex-col gap-1 min-w-0">
                        <span className="block text-[14.5px] font-semibold leading-[1.35] text-[#0F172A] dark:text-white truncate">
                          {item.company || item.symbol || "Listed Company"}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[11px] font-semibold text-[#1F5EFF] dark:text-blue-400 bg-[#EFF4FF] dark:bg-blue-950/60 px-2 py-0.5 rounded-md tracking-wider">
                            {item.symbol || "—"}
                          </span>
                        </div>
                      </div>

                      {/* Source Chip with Dot */}
                      <div>
                        <span
                          className="inline-flex items-center gap-1.5 h-[26px] px-2.5 rounded-full text-xs font-semibold whitespace-nowrap"
                          style={
                            isNse
                              ? { background: "#EFF4FF", color: "#1849A9" }
                              : { background: "#ECFDF3", color: "#067647" }
                          }
                        >
                          <i
                            className="w-1.5 h-1.5 rounded-full inline-block"
                            style={{ background: isNse ? "#2E6BFF" : "#12B76A" }}
                          />
                          {isNse ? "NSE" : "BSE"}
                        </span>
                      </div>

                      {/* Announcement Subject */}
                      <div className="py-3">
                        <span className="block text-[14px] font-medium leading-[1.4] text-[#0F172A] dark:text-slate-200">
                          {item.subject || "Corporate Announcement"}
                        </span>
                      </div>

                      {/* Category / Segment */}
                      <div className="text-[13px] text-[#475467] dark:text-slate-300">
                        <span className="inline-block px-2.5 py-1 rounded-full text-xs font-medium bg-[#F2F4F7] dark:bg-slate-800 text-[#344054] dark:text-slate-300">
                          {segment}
                        </span>
                      </div>

                      {/* Announced At */}
                      <div className="text-[13px] font-medium text-[#344054] dark:text-slate-300 whitespace-nowrap tabular-nums">
                        {formatDate(item.announced_at)}
                      </div>

                      {/* PDF Document Button */}
                      <div className="flex justify-end">
                        {item.pdf_url ? (
                          <a
                            href={item.pdf_url}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`Open announcement document: ${item.symbol}`}
                            className="w-11 h-11 grid place-items-center rounded-xl border border-[#E5E8EE] dark:border-slate-700 bg-white dark:bg-slate-800 text-[#475467] dark:text-slate-300 hover:bg-[#F2F4F7] dark:hover:bg-slate-700 hover:text-[#0F172A] transition-colors"
                          >
                            <ExternalLink className="w-4 h-4" strokeWidth={1.8} />
                          </a>
                        ) : (
                          <span className="w-11 h-11 grid place-items-center text-[#98A2B3] dark:text-slate-600 font-mono text-sm">
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

          {/* ─── Pagination Footer ─── */}
          <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-4 border-t border-[#EAECF0] dark:border-slate-800 text-sm text-[#475467] dark:text-slate-400 bg-white dark:bg-slate-900">
            <div className="flex items-center gap-2">
              <span>Rows per page:</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
                className="h-8 px-2 rounded-lg border border-[#D0D5DD] dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold text-[#0F172A] dark:text-white outline-none cursor-pointer"
              >
                <option value={15}>15</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
              <span className="ml-2 font-mono tabular-nums text-xs">
                {Math.min(filteredNews.length, (page - 1) * pageSize + 1)}–
                {Math.min(filteredNews.length, page * pageSize)} of {filteredNews.length.toLocaleString()}
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
