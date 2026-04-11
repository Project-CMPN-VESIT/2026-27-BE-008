"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, ExternalLink, RefreshCw, Search } from "lucide-react";

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

const parseResultDate = (value: string) => {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const formatDate = (value: string) => {
  const parsed = parseResultDate(value);
  if (!parsed) {
    return value || "--";
  }

  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(parsed));
};

export default function ResultsCalendarPage() {
  const [rows, setRows] = useState<ResultCalendarItem[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string>("");

  const fetchCalendar = useCallback(async (background = false) => {
    if (background) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    setError(null);

    try {
      const response = await fetch("/api/results-calendar", { cache: "no-store" });
      const payload: ResultCalendarResponse = await response.json();

      if (!response.ok) {
        throw new Error(payload.detail || "Failed to fetch results calendar");
      }

      setRows(Array.isArray(payload.results) ? payload.results : []);
      setLastUpdatedAt(payload.fetchedAt || new Date().toISOString());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load results calendar");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchCalendar(false);

    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      fetchCalendar(true);
    }, POLL_MS);

    return () => clearInterval(timer);
  }, [fetchCalendar]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return rows;
    }

    return rows.filter((row) => {
      const text = `${row.securityCode} ${row.shortName} ${row.companyName} ${row.resultDate}`.toLowerCase();
      return text.includes(query);
    });
  }, [rows, search]);

  const stats = useMemo(() => {
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const tomorrowStart = todayStart + 24 * 60 * 60 * 1000;

    let todayCount = 0;
    let upcomingCount = 0;

    for (const row of rows) {
      const ts = parseResultDate(row.resultDate);
      if (!ts) {
        continue;
      }

      if (ts >= todayStart && ts < tomorrowStart) {
        todayCount += 1;
      }

      if (ts >= todayStart) {
        upcomingCount += 1;
      }
    }

    return {
      total: rows.length,
      today: todayCount,
      upcoming: upcomingCount,
    };
  }, [rows]);

  return (
    <div className="min-h-screen bg-grid-pattern p-6 space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-sky-500 shadow-lg shadow-indigo-500/20">
            <CalendarDays className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Results Calendar</h1>
            <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
              Upcoming company results from BSE calendar feed
            </p>
          </div>
        </div>

        <button
          onClick={() => fetchCalendar(true)}
          disabled={loading || refreshing}
          className={`inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 ${
            loading || refreshing ? "cursor-not-allowed opacity-60" : ""
          }`}
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          {refreshing ? "Refreshing..." : "Refresh Calendar"}
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-300 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total Companies</div>
          <div className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{stats.total}</div>
        </div>
        <div className="rounded-xl border border-blue-200 bg-white p-4 shadow-sm dark:border-blue-500/20 dark:bg-slate-900">
          <div className="text-xs font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400">Today</div>
          <div className="mt-1 text-2xl font-bold text-blue-600 dark:text-blue-400">{stats.today}</div>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-white p-4 shadow-sm dark:border-emerald-500/20 dark:bg-slate-900">
          <div className="text-xs font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">Upcoming</div>
          <div className="mt-1 text-2xl font-bold text-emerald-600 dark:text-emerald-400">{stats.upcoming}</div>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <Search className="h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search code, short name, company"
            className="w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:text-white"
          />
        </div>

        <div className="text-xs text-slate-500 dark:text-slate-400">
          Last updated: {lastUpdatedAt ? new Date(lastUpdatedAt).toLocaleString("en-IN") : "--"}
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-slate-300 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">BSE Result Announcements</div>
          <div className="text-xs text-slate-500 dark:text-slate-400">Showing {filteredRows.length} rows</div>
        </div>

        {loading ? (
          <div className="px-4 py-8 text-sm text-slate-500">Loading results calendar...</div>
        ) : filteredRows.length === 0 ? (
          <div className="px-4 py-8 text-sm text-slate-500">No results found.</div>
        ) : (
          <div className="max-h-[68vh] overflow-auto">
            <table className="w-full border-collapse text-left">
              <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-900">
                <tr className="border-b border-slate-200 dark:border-slate-800">
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Security Code</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Short Name</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Company</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Result Date</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">BSE Link</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {filteredRows.map((row) => (
                  <tr key={`${row.securityCode}-${row.resultDate}-${row.shortName}`} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                    <td className="px-4 py-3 text-xs font-semibold text-slate-700 dark:text-slate-200">
                      {row.securityCode || "--"}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-700 dark:text-slate-200">{row.shortName || "--"}</td>
                    <td className="px-4 py-3 text-sm text-slate-700 dark:text-slate-200">{row.companyName || "--"}</td>
                    <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">{formatDate(row.resultDate)}</td>
                    <td className="px-4 py-3 text-xs">
                      {row.url ? (
                        <a
                          href={row.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-blue-600 hover:underline dark:text-blue-400"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          Open
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
