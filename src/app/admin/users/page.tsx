"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Users,
  Search,
  RefreshCw,
  Globe,
  Monitor,
  Smartphone,
  Laptop,
  Clock,
  ShieldCheck,
  CheckCircle2,
  X,
  ExternalLink,
  ChevronRight,
  Filter,
  ArrowUpDown,
  Calendar,
  Lock,
  Download,
  Activity,
  MapPin,
  Wifi,
} from "lucide-react";
import { AdminUserData, UserSessionEvent } from "@/app/api/admin/users/route";
import { useAdmin } from "@/lib/admin-context";
import { adminFetchJson } from "@/lib/admin-fetch";

export default function AdminUsersPage() {
  const { logoutAdmin } = useAdmin();
  const [users, setUsers] = useState<AdminUserData[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<"ALL" | "ONLINE" | "PRO" | "ACTIVE_30D">("ALL");
  const [sortOrder, setSortOrder] = useState<"recent" | "logins">("recent");
  const [stats, setStats] = useState({
    totalUsers: 0,
    onlineNow: 0,
    totalLogins30d: 0,
    uniqueIps: 0,
  });

  // Selected user for 30-day session detail modal
  const [selectedUser, setSelectedUser] = useState<AdminUserData | null>(null);
  const [sessionModalFilter, setSessionModalFilter] = useState<"ALL" | "ACTIVE" | "COMPLETED">("ALL");
  const [sessionSearch, setSessionSearch] = useState("");

  const fetchUsers = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const { status, data: json } = await adminFetchJson<{ users?: AdminUserData[]; stats?: typeof stats }>("/api/admin/users");
      if (status === 401) {
        logoutAdmin(); // the admin session has really expired: go back to sign-in instead of showing an empty list
        return;
      }
      if (json) {
        setUsers(json.users || []);
        if (json.stats) setStats(json.stats);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [logoutAdmin]);

  useEffect(() => {
    fetchUsers(false);
    const interval = setInterval(() => fetchUsers(true), 45000);
    return () => clearInterval(interval);
  }, [fetchUsers]);

  // Filtered & sorted users
  const filteredUsers = useMemo(() => {
    return users
      .filter((u) => {
        if (filterType === "ONLINE" && u.status !== "ONLINE") return false;
        if (filterType === "PRO" && u.tier !== "Pro Trader" && u.tier !== "Institutional") return false;
        if (filterType === "ACTIVE_30D" && u.totalLogins30d < 15) return false;

        if (!search.trim()) return true;
        const q = search.toLowerCase();
        return (
          u.name.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q) ||
          u.currentIp.toLowerCase().includes(q) ||
          u.location.toLowerCase().includes(q) ||
          u.id.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        if (sortOrder === "logins") {
          return b.totalLogins30d - a.totalLogins30d;
        }
        return new Date(b.lastLoginAt).getTime() - new Date(a.lastLoginAt).getTime();
      });
  }, [users, filterType, search, sortOrder]);

  // Filtered sessions inside modal
  const modalSessions = useMemo(() => {
    if (!selectedUser) return [];
    return selectedUser.sessions.filter((s) => {
      if (sessionModalFilter === "ACTIVE" && s.status !== "ACTIVE") return false;
      if (sessionModalFilter === "COMPLETED" && s.status !== "COMPLETED") return false;

      if (!sessionSearch.trim()) return true;
      const q = sessionSearch.toLowerCase();
      return (
        s.ip.toLowerCase().includes(q) ||
        s.city.toLowerCase().includes(q) ||
        s.device.toLowerCase().includes(q) ||
        s.isp.toLowerCase().includes(q) ||
        s.authMethod.toLowerCase().includes(q)
      );
    });
  }, [selectedUser, sessionModalFilter, sessionSearch]);

  const formatDate = (isoStr: string) => {
    try {
      const d = new Date(isoStr);
      return d.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });
    } catch {
      return isoStr;
    }
  };

  const exportAuditCsv = () => {
    const rows = [
      ["User ID", "Name", "Email", "Tier", "Current Status", "Last IP", "Location", "Last Login", "30D Logins"],
      ...filteredUsers.map((u) => [
        u.id,
        u.name,
        u.email,
        u.tier,
        u.status,
        u.currentIp,
        u.location,
        u.lastLoginAt,
        u.totalLogins30d,
      ]),
    ];
    const csvContent = "data:text/csv;charset=utf-8," + rows.map((e) => e.join(",")).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `finpilot_user_activity_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
        {/* ─── Top Header & Controls ─── */}
        <div className="flex items-center justify-between gap-5 flex-wrap">
          <div className="flex items-center gap-4">
            <span className="w-[52px] h-[52px] rounded-[14px] bg-[#EFF4FF] dark:bg-blue-950/40 text-[#1E3A8A] dark:text-blue-400 border border-[#B2CCFF] dark:border-blue-800/60 grid place-items-center shrink-0 shadow-xs">
              <Users className="w-6 h-6" strokeWidth={2} />
            </span>
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="m-0 text-[28px] font-bold tracking-[-0.02em] text-[#0F172A] dark:text-white">
                  User Activity &amp; IP Telemetry
                </h1>
                <span className="px-2.5 py-1 border border-[#D0D5DD] dark:border-slate-700 rounded-full bg-white dark:bg-slate-800 text-[11px] font-semibold tracking-[0.1em] text-[#1E3A8A] dark:text-blue-400">
                  REAL-TIME SESSIONS
                </span>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  {stats.onlineNow} Online Now
                </span>
              </div>
              <p className="mt-1.5 mb-0 text-[14.5px] text-[#475467] dark:text-slate-400">
                Track registered platform investors, live IP provenance, geolocations, and complete 30-day login/logout history.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={exportAuditCsv}
              className="inline-flex items-center gap-2 h-11 px-4 rounded-xl border border-black dark:border-slate-400 bg-white dark:bg-slate-900 text-black dark:text-slate-200 text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors shadow-2xs cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>Export CSV</span>
            </button>

            <button
              onClick={() => fetchUsers(true)}
              disabled={loading || refreshing}
              className={`inline-flex items-center gap-2 h-11 px-[18px] rounded-xl border border-black dark:border-slate-400 bg-white dark:bg-slate-900 text-black dark:text-slate-200 text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors shadow-2xs ${
                loading || refreshing ? "opacity-60 cursor-not-allowed" : "cursor-pointer"
              }`}
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} strokeWidth={1.8} />
              <span>{refreshing ? "Updating..." : "Refresh Feed"}</span>
            </button>
          </div>
        </div>

        {/* ─── 4 Top KPI Stat Cards (Matching Platform System Style) ─── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Card 1: Total Users */}
          <div
            onClick={() => setFilterType("ALL")}
            className={`bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 cursor-pointer transition-all ${
              filterType === "ALL"
                ? "border-2 border-[#0F172A] dark:border-white shadow-md ring-1 ring-[#0F172A]/10"
                : "border-2 border-[#E5E8EE] dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-600 shadow-[0_1px_2px_rgba(16,24,40,0.04)]"
            }`}
          >
            <div className="flex justify-between items-center">
              <span className="text-xs font-semibold tracking-[0.07em] uppercase text-[#475467] dark:text-slate-400">
                Total Platform Users
              </span>
              <span className="w-8 h-8 rounded-lg bg-[#F2F4F7] dark:bg-slate-800 text-[#344054] dark:text-slate-300 grid place-items-center">
                <Users className="w-4 h-4" strokeWidth={1.8} />
              </span>
            </div>
            <div className="mt-2 text-[30px] font-bold tracking-[-0.02em] leading-tight tabular-nums text-[#0F172A] dark:text-white">
              {stats.totalUsers.toLocaleString()}
            </div>
            <div className="mt-0.5 text-xs text-[#667085] dark:text-slate-400">
              Registered investor accounts
            </div>
          </div>

          {/* Card 2: Online Sessions */}
          <div
            onClick={() => setFilterType("ONLINE")}
            className={`bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 cursor-pointer transition-all ${
              filterType === "ONLINE"
                ? "border-2 border-[#0F172A] dark:border-white shadow-md ring-1 ring-[#0F172A]/10"
                : "border-2 border-[#E5E8EE] dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-600 shadow-[0_1px_2px_rgba(16,24,40,0.04)]"
            }`}
          >
            <div className="flex justify-between items-center">
              <span className="text-xs font-semibold tracking-[0.07em] uppercase text-[#067647] dark:text-emerald-400">
                Active Sessions Now
              </span>
              <span className="w-8 h-8 rounded-lg bg-[#ECFDF3] dark:bg-emerald-950/40 text-[#067647] dark:text-emerald-400 grid place-items-center">
                <Activity className="w-4 h-4" strokeWidth={1.8} />
              </span>
            </div>
            <div className="mt-2 text-[30px] font-bold tracking-[-0.02em] leading-tight tabular-nums text-[#0F172A] dark:text-white">
              {stats.onlineNow}
            </div>
            <div className="mt-0.5 text-xs text-[#667085] dark:text-slate-400">
              Live connected traders
            </div>
          </div>

          {/* Card 3: 30D Total Logins */}
          <div
            onClick={() => setFilterType("ACTIVE_30D")}
            className={`bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 cursor-pointer transition-all ${
              filterType === "ACTIVE_30D"
                ? "border-2 border-[#0F172A] dark:border-white shadow-md ring-1 ring-[#0F172A]/10"
                : "border-2 border-[#E5E8EE] dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-600 shadow-[0_1px_2px_rgba(16,24,40,0.04)]"
            }`}
          >
            <div className="flex justify-between items-center">
              <span className="text-xs font-semibold tracking-[0.07em] uppercase text-[#1849A9] dark:text-blue-400">
                30-Day Logins Tracked
              </span>
              <span className="w-8 h-8 rounded-lg bg-[#EFF4FF] dark:bg-blue-950/40 text-[#1849A9] dark:text-blue-400 grid place-items-center">
                <Clock className="w-4 h-4" strokeWidth={1.8} />
              </span>
            </div>
            <div className="mt-2 text-[30px] font-bold tracking-[-0.02em] leading-tight tabular-nums text-[#0F172A] dark:text-white">
              {stats.totalLogins30d.toLocaleString()}
            </div>
            <div className="mt-0.5 text-xs text-[#667085] dark:text-slate-400">
              Authentication sessions past month
            </div>
          </div>

          {/* Card 4: Unique IPs */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 border-2 border-[#E5E8EE] dark:border-slate-800 shadow-[0_1px_2px_rgba(16,24,40,0.04)] hover:border-slate-400 transition-all">
            <div className="flex justify-between items-center">
              <span className="text-xs font-semibold tracking-[0.07em] uppercase text-[#B54708] dark:text-amber-400">
                Unique Geolocation IPs
              </span>
              <span className="w-8 h-8 rounded-lg bg-[#FFFAEB] dark:bg-amber-950/40 text-[#B54708] dark:text-amber-400 grid place-items-center">
                <Globe className="w-4 h-4" strokeWidth={1.8} />
              </span>
            </div>
            <div className="mt-2 text-[30px] font-bold tracking-[-0.02em] leading-tight tabular-nums text-[#0F172A] dark:text-white">
              {stats.uniqueIps}
            </div>
            <div className="mt-0.5 text-xs text-[#667085] dark:text-slate-400">
              Across Indian metro nodes &amp; ISPs
            </div>
          </div>
        </div>

        {/* ─── Search & Black Border Segmented Filters (Exact Match with SEBI Shield) ─── */}
        <div className="flex flex-wrap gap-4 items-center justify-between">
          <label className="flex items-center gap-2.5 h-12 px-4 bg-white dark:bg-slate-900 border border-[#D0D5DD] dark:border-slate-700 rounded-xl flex-1 max-w-[460px] text-[#667085] focus-within:border-[#1E3A8A] focus-within:ring-3 focus-within:ring-[#D1E0FF] transition-all">
            <Search className="w-[18px] h-[18px] text-[#667085]" strokeWidth={1.8} />
            <input
              type="search"
              placeholder="Search user name, email, IP address, or city..."
              aria-label="Search users"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="border-0 outline-none flex-1 min-w-0 bg-transparent text-sm text-[#0F172A] dark:text-white placeholder:text-[#667085]"
            />
          </label>

          <div className="flex flex-wrap gap-3 items-center">
            {/* Filter Buttons */}
            <div className="flex flex-wrap items-center gap-2 sm:gap-2.5" role="group" aria-label="Filter user activity">
              {[
                { id: "ALL" as const, label: "All Users", count: users.length },
                { id: "ONLINE" as const, label: "Online Now", count: stats.onlineNow },
                { id: "PRO" as const, label: "Pro & Institutional", count: users.filter((u) => u.tier !== "Free Investor").length },
                { id: "ACTIVE_30D" as const, label: "High Activity", count: users.filter((u) => u.totalLogins30d >= 15).length },
              ].map((tab) => {
                const active = filterType === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setFilterType(tab.id)}
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
                      {tab.count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Sort Toggle */}
            <button
              onClick={() => setSortOrder((prev) => (prev === "recent" ? "logins" : "recent"))}
              className="inline-flex items-center gap-2 h-11 px-4 rounded-xl border border-black dark:border-slate-400 bg-white dark:bg-slate-900 text-black dark:text-slate-200 text-[13.5px] font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer shadow-2xs"
            >
              <span>{sortOrder === "recent" ? "Sort: Recent" : "Sort: Total Logins"}</span>
              <ArrowUpDown className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* ─── Platform Users Data Table ─── */}
        <div className="bg-white dark:bg-slate-900 border border-[#E5E8EE] dark:border-slate-800 rounded-2xl shadow-[0_1px_2px_rgba(16,24,40,0.04)] overflow-hidden">
          <div className="overflow-x-auto">
            <div className="min-w-[980px]">
              {/* Header Columns */}
              <div
                className="grid gap-4 items-center px-6 h-12 bg-[#F9FAFB] dark:bg-slate-800/60 text-[11.5px] font-semibold tracking-[0.07em] uppercase text-[#667085] dark:text-slate-400 select-none"
                style={{ gridTemplateColumns: "minmax(280px, 3.0fr) 1.2fr 1.6fr 1.4fr 1.4fr 1.1fr 140px" }}
              >
                <span>User &amp; Identity</span>
                <span>Current Status</span>
                <span>Last Tracked IP &amp; Node</span>
                <span>Device &amp; OS</span>
                <span>Last Authentication</span>
                <span>30D Activity</span>
                <span className="text-right">History</span>
              </div>

              {/* Data Rows */}
              {loading && users.length === 0 ? (
                <div className="px-6 py-16 text-center text-sm text-[#667085] flex flex-col items-center justify-center gap-2">
                  <RefreshCw className="w-5 h-5 animate-spin text-[#1E3A8A]" />
                  <span>Loading user activity telemetry...</span>
                </div>
              ) : filteredUsers.length === 0 ? (
                <div className="px-6 py-16 text-center text-sm text-[#667085]">
                  No platform users match the current filter criteria.
                </div>
              ) : (
                filteredUsers.map((user) => {
                  const isOnline = user.status === "ONLINE";
                  const isIdle = user.status === "IDLE";

                  return (
                    <div
                      key={user.id}
                      onClick={() => setSelectedUser(user)}
                      className="grid gap-4 items-center px-6 min-h-[68px] border-t border-[#EAECF0] dark:border-slate-800 hover:bg-[#F9FAFB] dark:hover:bg-slate-800/40 transition-colors cursor-pointer group"
                      style={{ gridTemplateColumns: "minmax(280px, 3.0fr) 1.2fr 1.6fr 1.4fr 1.4fr 1.1fr 140px" }}
                    >
                      {/* User Profile Info */}
                      <div className="py-3 flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-950/80 text-[#1E3A8A] dark:text-blue-400 font-bold text-sm flex items-center justify-center shrink-0 border border-blue-200 dark:border-blue-800">
                          {user.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="text-[14.5px] font-semibold text-[#0F172A] dark:text-white leading-[1.3] truncate group-hover:text-[#1E3A8A] dark:group-hover:text-blue-400 transition-colors">
                            {user.name}
                          </div>
                          <div className="text-xs text-[#667085] dark:text-slate-400 truncate mt-0.5">
                            {user.email}
                          </div>
                        </div>
                      </div>

                      {/* Current Status */}
                      <div>
                        <span
                          className={`inline-flex items-center gap-1.5 h-[26px] px-2.5 rounded-full text-xs font-semibold whitespace-nowrap ${
                            isOnline
                              ? "bg-[#ECFDF3] dark:bg-emerald-950/40 text-[#067647] dark:text-emerald-400 border border-[#ABEFC6] dark:border-emerald-800/60"
                              : isIdle
                              ? "bg-[#FFFAEB] dark:bg-amber-950/40 text-[#B54708] dark:text-amber-400 border border-[#FEDF89] dark:border-amber-800/60"
                              : "bg-[#F2F4F7] dark:bg-slate-800 text-[#344054] dark:text-slate-400 border border-slate-200 dark:border-slate-700"
                          }`}
                        >
                          <i
                            className={`w-1.5 h-1.5 rounded-full inline-block ${
                              isOnline ? "bg-[#12B76A] animate-pulse" : isIdle ? "bg-[#F79009]" : "bg-[#98A2B3]"
                            }`}
                          />
                          {user.status}
                        </span>
                      </div>

                      {/* Last Known IP & Location */}
                      <div>
                        <div className="text-[13px] font-mono font-semibold text-[#0F172A] dark:text-white tabular-nums flex items-center gap-1.5">
                          <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span>{user.currentIp}</span>
                        </div>
                        <div className="text-xs text-[#667085] dark:text-slate-400 truncate mt-0.5">
                          {user.location}
                        </div>
                      </div>

                      {/* Device & Browser */}
                      <div>
                        <div className="text-[13px] font-medium text-[#0F172A] dark:text-slate-200 truncate flex items-center gap-1.5">
                          <Monitor className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span>{user.device}</span>
                        </div>
                        <div className="text-xs text-[#667085] dark:text-slate-400 truncate mt-0.5">
                          {user.browser}
                        </div>
                      </div>

                      {/* Last Authentication */}
                      <div className="text-[13px] font-medium text-[#344054] dark:text-slate-300 tabular-nums">
                        {formatDate(user.lastLoginAt)}
                      </div>

                      {/* 30D Activity */}
                      <div>
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                          <span className="font-bold text-[#0F172A] dark:text-white">{user.totalLogins30d}</span> logins
                        </span>
                      </div>

                      {/* Action Button */}
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedUser(user);
                          }}
                          className="h-9 px-3 rounded-xl border border-black dark:border-slate-500 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-black dark:text-white text-xs font-semibold transition-all flex items-center gap-1.5 shadow-2xs cursor-pointer"
                        >
                          <Clock className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                          <span>30D History</span>
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* ─── 30-Day Login & Logout Audit Modal ─── */}
        {selectedUser && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-md animate-in fade-in duration-150"
            onClick={() => setSelectedUser(null)}
          >
            <div
              className="relative w-full max-w-[880px] max-h-[85vh] bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-150"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Top Header */}
              <div className="p-6 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4 bg-[#F9FAFB] dark:bg-slate-800/50">
                <div className="flex items-center gap-3.5">
                  <div className="w-12 h-12 rounded-2xl bg-blue-100 dark:bg-blue-950 text-[#1E3A8A] dark:text-blue-400 font-bold text-base flex items-center justify-center border border-blue-200 dark:border-blue-800">
                    {selectedUser.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                        {selectedUser.name}
                      </h2>
                      <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                        {selectedUser.tier}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      {selectedUser.email} &bull; User ID: <span className="font-mono">{selectedUser.id}</span>
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => setSelectedUser(null)}
                  className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                  aria-label="Close modal"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Modal Stats Bar */}
              <div className="px-6 py-3.5 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between flex-wrap gap-4 text-xs">
                <div className="flex items-center gap-5">
                  <div>
                    <span className="text-slate-400">Total 30D Sessions:</span>{" "}
                    <span className="font-bold text-slate-900 dark:text-white">{selectedUser.sessions.length}</span>
                  </div>
                  <div>
                    <span className="text-slate-400">Average Duration:</span>{" "}
                    <span className="font-bold text-slate-900 dark:text-white">{selectedUser.avgSessionDuration}</span>
                  </div>
                  <div>
                    <span className="text-slate-400">Primary ISP:</span>{" "}
                    <span className="font-bold text-slate-900 dark:text-white">{selectedUser.isp}</span>
                  </div>
                </div>

                {/* Search within sessions */}
                <div className="flex items-center gap-2">
                  <input
                    type="search"
                    placeholder="Filter IP or device..."
                    value={sessionSearch}
                    onChange={(e) => setSessionSearch(e.target.value)}
                    className="h-8 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs outline-none focus:border-blue-500"
                  />
                  <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 p-0.5 bg-slate-100 dark:bg-slate-800">
                    {(["ALL", "ACTIVE", "COMPLETED"] as const).map((tab) => (
                      <button
                        key={tab}
                        onClick={() => setSessionModalFilter(tab)}
                        className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors cursor-pointer ${
                          sessionModalFilter === tab
                            ? "bg-white dark:bg-slate-900 text-black dark:text-white shadow-xs"
                            : "text-slate-500 hover:text-black dark:hover:text-white"
                        }`}
                      >
                        {tab}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* 30-Day Session History Table */}
              <div className="flex-1 overflow-y-auto p-6">
                <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-2xs">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800 text-[11px] font-bold tracking-wider uppercase text-slate-500 dark:text-slate-400 select-none">
                        <th className="py-3 px-4">Status &amp; Event</th>
                        <th className="py-3 px-4">Login Time (IST)</th>
                        <th className="py-3 px-4">Logout Time</th>
                        <th className="py-3 px-4">Duration</th>
                        <th className="py-3 px-4">IP Address &amp; Location</th>
                        <th className="py-3 px-4">Device &amp; Auth</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {modalSessions.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="py-8 text-center text-slate-400">
                            No session entries match the current filter.
                          </td>
                        </tr>
                      ) : (
                        modalSessions.map((sess) => {
                          const isActive = sess.status === "ACTIVE";
                          return (
                            <tr
                              key={sess.id}
                              className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                            >
                              <td className="py-3 px-4">
                                <span
                                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                                    isActive
                                      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400 border border-emerald-200"
                                      : sess.status === "TIMEOUT"
                                      ? "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400 border border-amber-200"
                                      : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-200"
                                  }`}
                                >
                                  <i
                                    className={`w-1.5 h-1.5 rounded-full inline-block ${
                                      isActive ? "bg-emerald-500 animate-pulse" : "bg-slate-400"
                                    }`}
                                  />
                                  {sess.status}
                                </span>
                              </td>
                              <td className="py-3 px-4 font-medium text-slate-800 dark:text-slate-200 tabular-nums">
                                {formatDate(sess.loginTime)}
                              </td>
                              <td className="py-3 px-4 text-slate-500 dark:text-slate-400 tabular-nums">
                                {sess.logoutTime ? formatDate(sess.logoutTime) : "— Still Connected —"}
                              </td>
                              <td className="py-3 px-4 font-semibold text-slate-700 dark:text-slate-300 tabular-nums">
                                {sess.duration}
                              </td>
                              <td className="py-3 px-4">
                                <div className="font-mono font-semibold text-slate-900 dark:text-white">
                                  {sess.ip}
                                </div>
                                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                                  {sess.city}, {sess.state}
                                </div>
                              </td>
                              <td className="py-3 px-4">
                                <div className="font-medium text-slate-700 dark:text-slate-300 truncate max-w-[170px]">
                                  {sess.device}
                                </div>
                                <div className="text-[11px] text-slate-400">
                                  {sess.authMethod}
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex items-center justify-between text-xs text-slate-400">
                <span>Security logs strictly retained for compliance auditing (30-day rolling window).</span>
                <button
                  onClick={() => setSelectedUser(null)}
                  className="px-4 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-semibold cursor-pointer"
                >
                  Close History
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

