"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FileText, Filter, Newspaper, RefreshCw, Search } from "lucide-react";

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
const SOURCE_FILTERS: SourceFilter[] = ["ALL", "NSE", "BSE"];
const NSE_SEGMENT_OPTIONS = ["EQUITIES", "SME", "DEBT", "MF"] as const;

const formatDate = (value: string | null) => {
  if (!value) {
    return "--";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(date);
};

export default function NewsFeedPage() {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("ALL");
  const [detailFilter, setDetailFilter] = useState("ALL");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchNews = useCallback(
    async (isBackgroundRefresh = false) => {
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
    },
    []
  );

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
      if (String(item.source || "").toUpperCase() !== "BSE") {
        continue;
      }

      const value = String(item.category || "").trim();
      if (value) {
        categories.add(value);
      }
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
        if (!normalized) {
          continue;
        }
        if (!values.has(normalized)) {
          values.set(normalized, value);
        }
      }
    }

    return [{ value: "ALL", label: "All" }, ...Array.from(values.values()).map((value) => ({ value, label: value }))];
  }, [sourceFilter, bseCategoryOptions]);

  useEffect(() => {
    const exists = detailOptions.some((option) => option.value === detailFilter);
    if (!exists) {
      setDetailFilter("ALL");
    }
  }, [detailOptions, detailFilter]);

  const filteredNews = useMemo(() => {
    const query = search.trim().toLowerCase();
    const normalizedDetail = detailFilter.trim().toUpperCase();

    return news.filter((item) => {
      const normalizedSource = (item.source || "").trim().toUpperCase();
      const normalizedNseIndex = (item.nse_index || "").trim().toUpperCase();
      const normalizedCategory = (item.category || "").trim().toUpperCase();

      const matchesSource = sourceFilter === "ALL" || normalizedSource === sourceFilter;
      if (!matchesSource) {
        return false;
      }

      if (
        normalizedDetail !== "ALL" &&
        !(
          (normalizedSource === "NSE" && normalizedNseIndex === normalizedDetail) ||
          (normalizedSource === "BSE" && normalizedCategory === normalizedDetail)
        )
      ) {
        return false;
      }

      if (!query) {
        return true;
      }

      const text = `${item.symbol || ""} ${item.company || ""} ${item.subject || ""} ${item.category || ""} ${
        item.nse_index || ""
      }`.toLowerCase();
      return text.includes(query);
    });
  }, [news, search, sourceFilter, detailFilter]);

  const stats = useMemo(() => {
    const total = news.length;
    const nse = news.filter((item) => item.source?.toUpperCase() === "NSE").length;
    const bse = news.filter((item) => item.source?.toUpperCase() === "BSE").length;

    return { total, nse, bse };
  }, [news]);

  return (
    <div className="min-h-screen bg-grid-pattern p-6 space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 shadow-lg shadow-blue-500/20">
            <Newspaper className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">News Feed</h1>
            <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
              Live corporate announcements from NSE and BSE
            </p>
          </div>
        </div>

        <button
          onClick={() => fetchNews(true)}
          disabled={loading || refreshing}
          className={`inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 ${
            loading || refreshing ? "cursor-not-allowed opacity-60" : ""
          }`}
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          {refreshing ? "Refreshing..." : "Refresh Feed"}
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-300 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total Announcements</div>
          <div className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{stats.total}</div>
        </div>
        <div className="rounded-xl border border-blue-200 bg-white p-4 shadow-sm dark:border-blue-500/20 dark:bg-slate-900">
          <div className="text-xs font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400">NSE</div>
          <div className="mt-1 text-2xl font-bold text-blue-600 dark:text-blue-400">{stats.nse}</div>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-white p-4 shadow-sm dark:border-emerald-500/20 dark:bg-slate-900">
          <div className="text-xs font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">BSE</div>
          <div className="mt-1 text-2xl font-bold text-emerald-600 dark:text-emerald-400">{stats.bse}</div>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex flex-1 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <Search className="h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search symbol, company, subject, category"
            className="w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:text-white"
          />
        </div>

        <div className="inline-flex items-center gap-2">
          {SOURCE_FILTERS.map((source) => (
            <button
              key={source}
              onClick={() => setSourceFilter(source)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                sourceFilter === source
                  ? "border-slate-800 bg-slate-800 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900"
                  : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
              }`}
            >
              {source}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-2.5 py-1.5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <Filter className="h-4 w-4 text-slate-500" />
          <select
            value={detailFilter}
            onChange={(event) => setDetailFilter(event.target.value)}
            className="h-7 min-w-[140px] bg-transparent px-1 text-xs font-semibold text-slate-700 outline-none dark:text-slate-200"
            aria-label="Filter announcements"
          >
            {detailOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-slate-300 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Announcements</div>
          <div className="text-xs text-slate-500 dark:text-slate-400">Showing {filteredNews.length} rows</div>
        </div>

        {loading ? (
          <div className="px-4 py-8 text-sm text-slate-500">Loading announcements...</div>
        ) : filteredNews.length === 0 ? (
          <div className="px-4 py-8 text-sm text-slate-500">No announcements found.</div>
        ) : (
          <div className="max-h-[68vh] overflow-auto">
            <table className="w-full border-collapse text-left">
              <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-900">
                <tr className="border-b border-slate-200 dark:border-slate-800">
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Source</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Segment / Category</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Symbol</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Company</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Subject</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Category</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Announced At</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Attachment</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {filteredNews.map((item) => (
                  <tr key={`${item.id}-${item.content_hash}`} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                    <td className="px-4 py-3 text-xs font-semibold">
                      <span
                        className={`inline-flex rounded-md px-2 py-1 ${
                          item.source?.toUpperCase() === "NSE"
                            ? "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300"
                            : "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300"
                        }`}
                      >
                        {(item.source || "--").toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">
                      {item.source?.toUpperCase() === "NSE" ? item.nse_index || "--" : item.category || "--"}
                    </td>
                    <td className="px-4 py-3 text-xs font-medium text-slate-700 dark:text-slate-200">{item.symbol || "--"}</td>
                    <td className="px-4 py-3 text-sm text-slate-700 dark:text-slate-200">{item.company || "--"}</td>
                    <td className="px-4 py-3 text-sm text-slate-700 dark:text-slate-200">{item.subject || "--"}</td>
                    <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">{item.category || "--"}</td>
                    <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">{formatDate(item.announced_at)}</td>
                    <td className="px-4 py-3 text-xs">
                      {item.pdf_url ? (
                        <a
                          href={item.pdf_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-blue-600 hover:underline dark:text-blue-400"
                        >
                          <FileText className="h-3.5 w-3.5" />
                          Open PDF
                        </a>
                      ) : (
                        <span className="text-slate-400">--</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
