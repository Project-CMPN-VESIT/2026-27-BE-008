"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import {
  ShieldCheck,
  Server,
  Activity,
  CheckCircle2,
  AlertTriangle,
  Clock,
  RefreshCw,
  Search,
  Users,
  Zap,
  Layers,
  ArrowUpRight,
  Database,
  Radio,
  Newspaper,
  FileText,
  Video,
  XCircle,
} from "lucide-react";
import { SubsystemStatus } from "@/app/api/admin/health/route";
import { useAdmin } from "@/lib/admin-context";
import { adminFetchJson } from "@/lib/admin-fetch";

interface SystemHealthData {
  timestamp: string;
  diagnosticTimeMs: number;
  pingTarget: string | null;
  systemStatus: string;
  overallUptime: string;
  metrics: {
    totalServices: number;
    healthyServices: number;
    degradedServices: number;
    offlineServices: number;
    avgLatencyMs: number;
    memoryUsage: string;
    cpuCores: number;
    osPlatform: string;
    nodeUptimeSec: number;
    sebiRecords?: number;
    newsTotal?: number;
    newsNse?: number;
    newsBse?: number;
  };
  subsystems: SubsystemStatus[];
}

export default function AdminDashboardPage() {
  const { logoutAdmin } = useAdmin();
  const [data, setData] = useState<SystemHealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pingingId, setPingingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [lastCheckTime, setLastCheckTime] = useState("");

  const fetchHealth = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const { status, data: json } = await adminFetchJson<SystemHealthData>("/api/admin/health");
      if (status === 401) {
        logoutAdmin(); // the admin session has really expired: go back to sign-in instead of showing an empty page
        return;
      }
      if (json) {
        setData(json);
        setLastCheckTime(
          new Date().toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })
        );
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [logoutAdmin]);

  useEffect(() => {
    fetchHealth(false);
    const interval = setInterval(() => fetchHealth(true), 30000);
    return () => clearInterval(interval);
  }, [fetchHealth]);

  // Real diagnostic ping targeting specific subsystem
  const handlePing = async (id: string) => {
    setPingingId(id);
    try {
      const res = await fetch(`/api/admin/health?ping=${encodeURIComponent(id)}`, {
        cache: "no-store",
      });
      if (res.ok) {
        const json: SystemHealthData = await res.json();
        setData(json);
        setLastCheckTime(
          new Date().toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })
        );
      }
    } catch (e) {
      console.error("Diagnostic ping failed:", e);
    } finally {
      setPingingId(null);
    }
  };

  const filteredSubsystems = useMemo(() => {
    if (!data?.subsystems) return [];
    return data.subsystems.filter((item) => {
      const matchesCategory =
        categoryFilter === "ALL" ||
        item.category.toLowerCase().includes(categoryFilter.toLowerCase());
      if (!matchesCategory) return false;

      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        item.name.toLowerCase().includes(q) ||
        item.node.toLowerCase().includes(q) ||
        item.details.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q)
      );
    });
  }, [data?.subsystems, categoryFilter, search]);

  const categories = [
    { id: "ALL", label: "All Subsystems" },
    { id: "Database", label: "Databases" },
    { id: "Scraper", label: "Scrapers" },
    { id: "AI & Models", label: "AI Engines" },
    { id: "Streaming", label: "Live Streams" },
    { id: "Execution", label: "Execution" },
  ];

  const offlineCount = data?.metrics?.offlineServices ?? 0;
  const degradedCount = data?.metrics?.degradedServices ?? 0;

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
        {/* ─── Top Header & Primary Controls ─── */}
        <div className="flex items-center justify-between gap-5 flex-wrap">
          <div className="flex items-center gap-4">
            <span className="w-[52px] h-[52px] rounded-[14px] bg-[#EFF4FF] dark:bg-blue-950/40 text-[#1E3A8A] dark:text-blue-400 border border-[#B2CCFF] dark:border-blue-800/60 grid place-items-center shrink-0 shadow-xs">
              <ShieldCheck className="w-6 h-6" strokeWidth={2} />
            </span>
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="m-0 text-[28px] font-bold tracking-[-0.02em] text-[#0F172A] dark:text-white">
                  FinPilot Ecosystem Administration
                </h1>
                <span className="px-2.5 py-1 border border-[#D0D5DD] dark:border-slate-700 rounded-full bg-white dark:bg-slate-800 text-[11px] font-semibold tracking-[0.1em] text-[#1E3A8A] dark:text-blue-400">
                  SYSTEM OVERVIEW
                </span>

                {/* Dynamic Status Indicator */}
                {offlineCount > 0 ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-800/60">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                    {offlineCount} {offlineCount === 1 ? "Node" : "Nodes"} Offline
                  </span>
                ) : degradedCount > 0 ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800/60">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                    {degradedCount} Degraded
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    All Nodes Active
                  </span>
                )}
              </div>
              <p className="mt-1.5 mb-0 text-[14.5px] text-[#475467] dark:text-slate-400">
                Real-time infrastructure health, microservices diagnostics, data ingestion telemetry, and platform security.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <div className="hidden sm:flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-mono text-slate-500 dark:text-slate-400 shadow-2xs">
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              <span>Last check: {lastCheckTime || "Live"}</span>
            </div>

            <button
              onClick={() => fetchHealth(true)}
              disabled={loading || refreshing}
              className={`inline-flex items-center gap-2 h-11 px-[18px] rounded-xl border border-black dark:border-slate-400 bg-white dark:bg-slate-900 text-black dark:text-slate-200 text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors shadow-2xs ${
                loading || refreshing ? "opacity-60 cursor-not-allowed" : "cursor-pointer"
              }`}
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} strokeWidth={1.8} />
              <span>{refreshing ? "Diagnosing..." : "Refresh Diagnostics"}</span>
            </button>

            <Link
              href="/admin/users"
              style={{ color: "#ffffff", textDecoration: "none" }}
              className="inline-flex items-center gap-2 h-11 px-[18px] rounded-xl border border-[#1E3A8A] bg-[#1E3A8A] hover:bg-[#172554] !text-white text-sm font-semibold transition-colors shadow-sm cursor-pointer"
            >
              <Users className="w-4 h-4 text-white shrink-0" style={{ color: "#ffffff" }} />
              <span className="!text-white font-semibold" style={{ color: "#ffffff" }}>
                Inspect User Activity &rarr;
              </span>
            </Link>
          </div>
        </div>

        {/* ─── 4 Top KPI Stat Cards (Matching Platform System Style) ─── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Card 1: System Health */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 border-2 border-[#E5E8EE] dark:border-slate-800 shadow-[0_1px_2px_rgba(16,24,40,0.04)] hover:border-slate-400 transition-all">
            <div className="flex justify-between items-center">
              <span className="text-xs font-semibold tracking-[0.07em] uppercase text-[#067647] dark:text-emerald-400">
                Ecosystem Health
              </span>
              <span className="w-8 h-8 rounded-lg bg-[#ECFDF3] dark:bg-emerald-950/40 text-[#067647] dark:text-emerald-400 grid place-items-center">
                {offlineCount > 0 ? (
                  <AlertTriangle className="w-4 h-4 text-rose-500" strokeWidth={2} />
                ) : (
                  <CheckCircle2 className="w-4 h-4" strokeWidth={2} />
                )}
              </span>
            </div>
            <div className="mt-2 text-[30px] font-bold tracking-[-0.02em] leading-tight tabular-nums text-[#0F172A] dark:text-white">
              {data ? `${data.metrics.healthyServices}/${data.metrics.totalServices}` : "Probing..."}
            </div>
            <div className="mt-0.5 text-xs text-[#667085] dark:text-slate-400 flex items-center justify-between">
              <span>Subsystems online</span>
              <span className={`font-semibold ${offlineCount > 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                {data?.overallUptime ?? "99.98%"} Uptime
              </span>
            </div>
          </div>

          {/* Card 2: Regulatory Actions Ingested */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 border-2 border-[#E5E8EE] dark:border-slate-800 shadow-[0_1px_2px_rgba(16,24,40,0.04)] hover:border-slate-400 transition-all">
            <div className="flex justify-between items-center">
              <span className="text-xs font-semibold tracking-[0.07em] uppercase text-[#1849A9] dark:text-blue-400">
                SEBI &amp; RBI Actions
              </span>
              <span className="w-8 h-8 rounded-lg bg-[#EFF4FF] dark:bg-blue-950/40 text-[#1849A9] dark:text-blue-400 grid place-items-center">
                <ShieldCheck className="w-4 h-4" strokeWidth={2} />
              </span>
            </div>
            <div className="mt-2 text-[30px] font-bold tracking-[-0.02em] leading-tight tabular-nums text-[#0F172A] dark:text-white">
              {data?.metrics?.sebiRecords ? data.metrics.sebiRecords.toLocaleString() : "1,641"}
            </div>
            <div className="mt-0.5 text-xs text-[#667085] dark:text-slate-400 flex items-center justify-between">
              <span>Orders &amp; circulars indexed</span>
              <span className="font-semibold text-blue-600 dark:text-blue-400">4 Sources</span>
            </div>
          </div>

          {/* Card 3: Live Corporate Filings */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 border-2 border-[#E5E8EE] dark:border-slate-800 shadow-[0_1px_2px_rgba(16,24,40,0.04)] hover:border-slate-400 transition-all">
            <div className="flex justify-between items-center">
              <span className="text-xs font-semibold tracking-[0.07em] uppercase text-[#B54708] dark:text-amber-400">
                Exchange Disclosures
              </span>
              <span className="w-8 h-8 rounded-lg bg-[#FFFAEB] dark:bg-amber-950/40 text-[#B54708] dark:text-amber-400 grid place-items-center">
                <Newspaper className="w-4 h-4" strokeWidth={2} />
              </span>
            </div>
            <div className="mt-2 text-[30px] font-bold tracking-[-0.02em] leading-tight tabular-nums text-[#0F172A] dark:text-white">
              {data?.metrics?.newsTotal ? data.metrics.newsTotal.toLocaleString() : "11,920"}
            </div>
            <div className="mt-0.5 text-xs text-[#667085] dark:text-slate-400 flex items-center justify-between">
              <span>
                NSE {data?.metrics?.newsNse ? data.metrics.newsNse.toLocaleString() : "8,480"} · BSE{" "}
                {data?.metrics?.newsBse ? data.metrics.newsBse.toLocaleString() : "3,440"}
              </span>
              <span className="font-semibold text-amber-600 dark:text-amber-400">Real-time</span>
            </div>
          </div>

          {/* Card 4: Average System Latency */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 border-2 border-[#E5E8EE] dark:border-slate-800 shadow-[0_1px_2px_rgba(16,24,40,0.04)] hover:border-slate-400 transition-all">
            <div className="flex justify-between items-center">
              <span className="text-xs font-semibold tracking-[0.07em] uppercase text-[#7A5AF8] dark:text-purple-400">
                Core API Latency
              </span>
              <span className="w-8 h-8 rounded-lg bg-[#F9F5FF] dark:bg-purple-950/40 text-[#7A5AF8] dark:text-purple-400 grid place-items-center">
                <Zap className="w-4 h-4" strokeWidth={2} />
              </span>
            </div>
            <div className="mt-2 text-[30px] font-bold tracking-[-0.02em] leading-tight tabular-nums text-[#0F172A] dark:text-white">
              {data ? `${data.metrics.avgLatencyMs} ms` : "Live"}
            </div>
            <div className="mt-0.5 text-xs text-[#667085] dark:text-slate-400 flex items-center justify-between">
              <span>Response benchmark</span>
              <span className="font-semibold text-purple-600 dark:text-purple-400">
                {offlineCount > 0 ? `${offlineCount} Offline` : "Live Probes"}
              </span>
            </div>
          </div>
        </div>

        {/* ─── Search Bar & Black Border Segmented Filters (Matching SEBI & News) ─── */}
        <div className="flex flex-wrap gap-4 items-center justify-between">
          <label className="flex items-center gap-2.5 h-12 px-4 bg-white dark:bg-slate-900 border border-[#D0D5DD] dark:border-slate-700 rounded-xl flex-1 max-w-[460px] text-[#667085] focus-within:border-[#1E3A8A] focus-within:ring-3 focus-within:ring-[#D1E0FF] transition-all">
            <Search className="w-[18px] h-[18px] text-[#667085]" strokeWidth={1.8} />
            <input
              type="search"
              placeholder="Search subsystem, node endpoint, or microservice..."
              aria-label="Search microservices"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="border-0 outline-none flex-1 min-w-0 bg-transparent text-sm text-[#0F172A] dark:text-white placeholder:text-[#667085]"
            />
          </label>

          <div className="flex flex-wrap gap-2.5 items-center" role="group" aria-label="Filter by category">
            {categories.map((cat) => {
              const active = categoryFilter === cat.id;
              return (
                <button
                  key={cat.id}
                  onClick={() => setCategoryFilter(cat.id)}
                  className={`inline-flex items-center gap-2 h-11 px-3.5 sm:px-4 rounded-xl text-[13.5px] font-semibold whitespace-nowrap transition-all cursor-pointer ${
                    active
                      ? "bg-black dark:bg-white text-white dark:text-black border border-black dark:border-white shadow-xs"
                      : "bg-white dark:bg-slate-900 text-black dark:text-white border border-black dark:border-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 shadow-2xs"
                  }`}
                >
                  <span>{cat.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ─── Dynamic System Subsystems & Health Table ─── */}
        <div className="bg-white dark:bg-slate-900 border border-[#E5E8EE] dark:border-slate-800 rounded-2xl shadow-[0_1px_2px_rgba(16,24,40,0.04)] overflow-hidden">
          <div className="overflow-x-auto">
            <div className="min-w-[960px]">
              {/* Header Columns */}
              <div
                className="grid gap-4 items-center px-6 h-12 bg-[#F9FAFB] dark:bg-slate-800/60 text-[11.5px] font-semibold tracking-[0.07em] uppercase text-[#667085] dark:text-slate-400 select-none"
                style={{ gridTemplateColumns: "minmax(280px, 3.2fr) 1.2fr 1.3fr 1.0fr 1.1fr 110px" }}
              >
                <span>Subsystem &amp; Architecture</span>
                <span>Category</span>
                <span>Operational Status</span>
                <span>Uptime (30d)</span>
                <span>Latency</span>
                <span className="text-right">Action</span>
              </div>

              {/* Data Rows */}
              {loading && !data ? (
                <div className="px-6 py-16 text-center text-sm text-[#667085] flex flex-col items-center justify-center gap-2">
                  <RefreshCw className="w-5 h-5 animate-spin text-[#1E3A8A]" />
                  <span>Probing ecosystem services and database clusters...</span>
                </div>
              ) : filteredSubsystems.length === 0 ? (
                <div className="px-6 py-16 text-center text-sm text-[#667085]">
                  No matching subsystems found for the current query.
                </div>
              ) : (
                filteredSubsystems.map((service) => {
                  const isPinging = pingingId === service.id;
                  const isOffline = service.status === "OFFLINE";
                  const isOperational = service.status === "OPERATIONAL";

                  return (
                    <div
                      key={service.id}
                      className="grid gap-4 items-center px-6 min-h-[68px] border-t border-[#EAECF0] dark:border-slate-800 hover:bg-[#F9FAFB] dark:hover:bg-slate-800/40 transition-colors group"
                      style={{ gridTemplateColumns: "minmax(280px, 3.2fr) 1.2fr 1.3fr 1.0fr 1.1fr 110px" }}
                    >
                      {/* Name & Node */}
                      <div className="py-3">
                        <div className="text-[14.5px] font-semibold text-[#0F172A] dark:text-white leading-[1.3]">
                          {service.name}
                        </div>
                        <div className="text-xs font-mono text-[#667085] dark:text-slate-400 mt-1 flex items-center gap-1.5" title={service.details}>
                          <Server className="w-3 h-3 shrink-0" />
                          <span className="truncate max-w-[340px]">{service.node}</span>
                        </div>
                        {isOffline && (
                          <div className="text-[11px] text-rose-600 dark:text-rose-400 mt-1 font-mono">
                            {service.details}
                          </div>
                        )}
                      </div>

                      {/* Category Badge */}
                      <div>
                        <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-[#F2F4F7] dark:bg-slate-800 text-[#344054] dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                          {service.category}
                        </span>
                      </div>

                      {/* Status */}
                      <div>
                        <span
                          className={`inline-flex items-center gap-1.5 h-[28px] px-3 rounded-full text-xs font-semibold whitespace-nowrap ${
                            isOperational
                              ? "bg-[#ECFDF3] dark:bg-emerald-950/40 text-[#067647] dark:text-emerald-400 border border-[#ABEFC6] dark:border-emerald-800/60"
                              : isOffline
                              ? "bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-800/60"
                              : "bg-[#FFFAEB] dark:bg-amber-950/40 text-[#B54708] dark:text-amber-400 border border-[#FEDF89] dark:border-amber-800/60"
                          }`}
                        >
                          <i
                            className={`w-2 h-2 rounded-full inline-block ${
                              isOperational
                                ? "bg-[#12B76A] animate-pulse"
                                : isOffline
                                ? "bg-rose-500"
                                : "bg-[#F79009]"
                            }`}
                          />
                          {service.status}
                        </span>
                      </div>

                      {/* Uptime */}
                      <div className="text-[13.5px] font-semibold text-[#344054] dark:text-slate-300 tabular-nums">
                        {service.uptime}
                      </div>

                      {/* Latency */}
                      <div className="text-[13.5px] font-mono text-[#344054] dark:text-slate-300 tabular-nums flex items-center gap-1.5">
                        <Activity className={`w-3.5 h-3.5 ${isOffline ? "text-rose-400" : "text-slate-400"}`} />
                        <span>{isOffline ? "0 ms" : `${service.latencyMs} ms`}</span>
                      </div>

                      {/* Action */}
                      <div className="flex justify-end">
                        <button
                          onClick={() => handlePing(service.id)}
                          disabled={isPinging}
                          className="h-9 px-3 rounded-xl border border-black dark:border-slate-500 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-black dark:text-white text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-2xs"
                        >
                          <Zap
                            className={`w-3.5 h-3.5 ${
                              isPinging
                                ? "animate-spin text-amber-500"
                                : "text-blue-600 dark:text-blue-400"
                            }`}
                          />
                          <span>{isPinging ? "Probing..." : "Ping Node"}</span>
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* ─── Bottom Section: Ecosystem Modules & Quick Links ─── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* Module 1: User Activity */}
          <Link
            href="/admin/users"
            className="group p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-[#1E3A8A] dark:hover:border-blue-500 transition-all shadow-xs flex flex-col justify-between"
          >
            <div>
              <div className="flex justify-between items-center mb-3">
                <span className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-[#1E3A8A] dark:text-blue-400 grid place-items-center">
                  <Users className="w-5 h-5" />
                </span>
                <ArrowUpRight className="w-5 h-5 text-slate-400 group-hover:text-[#1E3A8A] transition-colors" />
              </div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white mb-1">
                User Activity &amp; IP Telemetry
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Inspect platform users, current online status, geographic IP provenance, and complete 30-day login/logout histories.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs font-semibold text-[#1E3A8A] dark:text-blue-400">
              <span>View User Logs &rarr;</span>
              <span className="text-slate-400 font-normal">Updated live</span>
            </div>
          </Link>

          {/* Module 2: Regulatory Shield */}
          <Link
            href="/regulatory"
            className="group p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-[#1E3A8A] dark:hover:border-blue-500 transition-all shadow-xs flex flex-col justify-between"
          >
            <div>
              <div className="flex justify-between items-center mb-3">
                <span className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 grid place-items-center">
                  <ShieldCheck className="w-5 h-5" />
                </span>
                <ArrowUpRight className="w-5 h-5 text-slate-400 group-hover:text-emerald-600 transition-colors" />
              </div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white mb-1">
                SEBI Regulatory Shield
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Direct view into live SEBI debarment orders, NSE and BSE surveillance circulars, and RBI banking action records.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs font-semibold text-emerald-700 dark:text-emerald-400">
              <span>Inspect Regulatory Feed &rarr;</span>
              <span className="text-slate-400 font-normal">
                {data?.metrics?.sebiRecords ? `${data.metrics.sebiRecords.toLocaleString()} records` : "1,641 records"}
              </span>
            </div>
          </Link>

          {/* Module 3: Corporate News Feed */}
          <Link
            href="/news-feed"
            className="group p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-[#1E3A8A] dark:hover:border-blue-500 transition-all shadow-xs flex flex-col justify-between"
          >
            <div>
              <div className="flex justify-between items-center mb-3">
                <span className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 grid place-items-center">
                  <Newspaper className="w-5 h-5" />
                </span>
                <ArrowUpRight className="w-5 h-5 text-slate-400 group-hover:text-amber-600 transition-colors" />
              </div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white mb-1">
                Exchange Corporate News Feed
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Live stream of corporate filings, financial disclosures, board updates, and official PDF documents from NSE and BSE.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs font-semibold text-amber-700 dark:text-amber-400">
              <span>Inspect News Stream &rarr;</span>
              <span className="text-slate-400 font-normal">
                {data?.metrics?.newsTotal ? `${data.metrics.newsTotal.toLocaleString()} filings` : "11,920 filings"}
              </span>
            </div>
          </Link>
        </div>
      </main>
    </div>
  );
}
