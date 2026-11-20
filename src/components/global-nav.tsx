"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useAdmin } from "@/lib/admin-context";
import { authenticatedFetch } from "@/lib/authenticated-fetch";
import { ThemeToggle } from "@/components/theme-toggle";
import { CyroBotIcon } from "@/components/cyro-bot-icon";
import {
  Bell,
  LogOut,
  User as UserIcon,
  Menu,
  X,
  ShieldCheck,
  ExternalLink,
  Film,
  Newspaper,
  FileText,
  CheckCheck,
} from "lucide-react";
import {
  subscribeToUserAlerts,
  markAlertRead,
  markAllAlertsRead,
  type StockAlert,
} from "@/lib/alerts/alertsService";
import { timeAgo } from "@/lib/alerts/timeAgo";
import { formatNumber, formatSigned, useMarketOverview } from "@/lib/use-market-overview";

interface NavLinkItem {
  href: string;
  label: string;
  matchPrefix?: string;
  exact?: boolean;
}

// Exactly the 7 buttons present in the user navbar
const USER_NAV_LINKS: NavLinkItem[] = [
  { href: "/home", label: "Home", matchPrefix: "/home" },
  { href: "/screener", label: "Screener", matchPrefix: "/screener" },
  { href: "/cyro", label: "CYRO AI", matchPrefix: "/cyro" },
  { href: "/portfolio", label: "My Portfolio", matchPrefix: "/portfolio" },
  { href: "/heatmap", label: "Heatmap", matchPrefix: "/heatmap" },
  { href: "/baskets", label: "AI Baskets", matchPrefix: "/baskets" },
  { href: "/paper-trading", label: "Paper Trading", matchPrefix: "/paper-trading" },
];

// Admin navigation options specified by user requirements
const ADMIN_NAV_LINKS: NavLinkItem[] = [
  { href: "/admin", label: "Admin Home", exact: true },
  { href: "/admin/users", label: "User Activity", matchPrefix: "/admin/users" },
  { href: "/regulatory", label: "SEBI Shield", matchPrefix: "/regulatory" },
  { href: "/news-feed", label: "News Feed", matchPrefix: "/news-feed" },
  { href: "/results-calendar", label: "Results Calendar", matchPrefix: "/results-calendar" },
  { href: "/nifty-shorts", label: "Nifty Shorts", matchPrefix: "/nifty-shorts" },
];

function ShortsNavButton() {
  return (
    <Link
      href="/shorts"
      title="Nifty Shorts"
      aria-label="Nifty Shorts"
      style={{ textDecoration: "none" }}
      className="flex items-center gap-1.5 h-[38px] px-3 rounded-xl border border-slate-200/90 dark:border-slate-700 bg-[#eef2f6] dark:bg-[#1e2638] hover:bg-[#e2e8f0] dark:hover:bg-[#263147] text-slate-800 dark:text-slate-100 transition-colors shrink-0 cursor-pointer shadow-2xs font-bold text-[13px]"
    >
      <Film className="w-4 h-4 text-slate-700 dark:text-slate-300 shrink-0" />
      <span className="font-bold text-slate-900 dark:text-white">Shorts</span>
    </Link>
  );
}

export function GlobalNav() {
  const market = useMarketOverview();
  const tickerItems = (market?.indices ?? []).map((i) => ({
    name: i.name,
    val: formatNumber(i.value),
    pct: `${formatSigned(i.pct)}%`,
    up: i.pct >= 0,
  }));
  const pathname = usePathname();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { isAdmin, adminUser, logoutAdmin } = useAdmin();
  const [displayName, setDisplayName] = useState("");
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // ── Alerts state ──────────────────────────────────────────────────────────
  const [alerts, setAlerts] = useState<StockAlert[]>([]);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const alertsRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const inAdminMode = isAdmin || pathname.startsWith("/admin");
  const navLinks = inAdminMode ? ADMIN_NAV_LINKS : USER_NAV_LINKS;

  const unreadCount = alerts.filter((a) => !a.read).length;

  // Sync display name for regular user
  useEffect(() => {
    let active = true;
    if (inAdminMode) {
      setDisplayName("System Admin");
      return () => { active = false; };
    }

    setDisplayName(user?.name ?? "");
    if (!user) return () => { active = false; };
    void authenticatedFetch("/api/user/profile")
      .then((res) => res.json())
      .then(({ profile }) => {
        if (active && profile?.display_name) setDisplayName(profile.display_name);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [user?.id, user?.name, inAdminMode]);

  // Close menus on route change
  useEffect(() => {
    setUserMenuOpen(false);
    setMobileMenuOpen(false);
  }, [pathname]);

  // ── Real-time Firestore subscription for alerts ────────────────────────────
  useEffect(() => {
    if (!user?.id || inAdminMode) return;
    const unsub = subscribeToUserAlerts(user.id, setAlerts);
    return unsub;
  }, [user?.id, inAdminMode]);

  // ── Periodic news polling to generate new alerts (every 90 seconds) ────────
  useEffect(() => {
    if (!user?.id || inAdminMode) return;
    const poll = () => {
      authenticatedFetch("/api/alerts/check").catch(() => undefined);
    };
    poll(); // immediate first call
    const interval = setInterval(poll, 90_000);
    return () => clearInterval(interval);
  }, [user?.id, inAdminMode]);

  // ── Close dropdowns when clicking outside ────────────────────────────────
  useEffect(() => {
    if (!alertsOpen && !userMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (alertsOpen && alertsRef.current && !alertsRef.current.contains(e.target as Node)) {
        setAlertsOpen(false);
      }
      if (userMenuOpen && userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [alertsOpen, userMenuOpen]);

  const isLinkActive = (item: NavLinkItem) => {
    if (inAdminMode) {
      if (item.exact || item.href === "/admin") {
        return pathname === "/admin";
      }
      return pathname.startsWith(item.matchPrefix || item.href);
    }
    if (item.href === "/home") {
      return pathname === "/home" || pathname === "/";
    }
    return pathname.startsWith(item.matchPrefix || item.href);
  };

  return (
    <div className="w-full shrink-0 z-40 sticky top-0 flex flex-col font-sans select-none">
      {/* ─────────────────────────────────────────────────────────────
          1. CLEAN TOP NAVBAR (Full Width, Centered Links, Minimal Profile)
      ───────────────────────────────────────────────────────────── */}
      <header
        style={{ minHeight: "70px", maxHeight: "70px" }}
        className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 transition-all h-[70px] flex items-center w-full shadow-2xs relative z-30"
      >
        <div className="w-full px-4 sm:px-6 lg:px-10 flex items-center justify-between">
          {/* Logo on far left */}
          <Link
            href={inAdminMode ? "/admin" : "/home"}
            style={{ textDecoration: "none" }}
            className="flex items-center group shrink-0 mr-4 sm:mr-6"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/finpilot-brand-logo-transparent.webp"
              alt="FinPilot"
              width={160}
              height={34}
              style={{ height: "34px", width: "auto" }}
              className="h-[34px] w-auto object-contain transition-transform group-hover:scale-[1.02]"
            />
          </Link>

          {/* Centered Navigation */}
          <div className="hidden lg:flex items-center">
            <nav className="flex items-center space-x-1.5 bg-slate-50/90 dark:bg-slate-800/80 px-3 py-1.5 rounded-full border border-slate-200/90 dark:border-slate-700/80 shadow-2xs">
              {navLinks.map((link) => {
                const active = isLinkActive(link);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    style={{ textDecoration: "none" }}
                    className={`text-[13px] font-medium px-3.5 py-1.5 rounded-full transition-all duration-150 whitespace-nowrap ${
                      active
                        ? "bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-400 font-semibold shadow-xs border border-slate-200/80 dark:border-slate-700"
                        : "text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/50 dark:hover:bg-slate-700/50"
                    }`}
                  >
                    {link.label}
                  </Link>
                );
              })}
            </nav>

            {/* In User Mode: Standalone Ask CYRO Button + Nifty Shorts Button */}
            {!inAdminMode && (
              <div className="flex items-center gap-2.5 ml-3.5 shrink-0">
                <Link
                  href="/cyro"
                  style={{ textDecoration: "none" }}
                  className="cyro-nav-btn shrink-0"
                >
                  <CyroBotIcon className="w-5.5 h-5.5 object-contain shrink-0" />
                  <span>Ask CYRO</span>
                </Link>

                <ShortsNavButton />
              </div>
            )}
          </div>

          {/* Right Controls */}
          <div className="flex items-center space-x-3 shrink-0">
            {/* Admin Status Pill Badge (Visible in Admin Mode) */}
            {inAdminMode && (
              <div className="hidden md:inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold tracking-wider uppercase bg-blue-50 dark:bg-blue-950/70 text-[#1E3A8A] dark:text-blue-400 border border-blue-200 dark:border-blue-800/70 shadow-2xs">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                ADMIN CONSOLE
              </div>
            )}

            {/* Mobile Hamburger Menu Toggle */}
            <button
              onClick={() => setMobileMenuOpen((prev) => !prev)}
              className="lg:hidden p-2 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors border border-slate-200 dark:border-slate-700"
              aria-label="Toggle navigation menu"
            >
              {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </button>

            {/* Notification Bell — real-time portfolio alerts */}
            {user && !inAdminMode && (
              <div className="relative" ref={alertsRef}>
                <button
                  onClick={() => setAlertsOpen((prev) => !prev)}
                  className="relative p-2 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors border border-slate-200 dark:border-slate-700"
                  title="Portfolio Alerts"
                  aria-expanded={alertsOpen}
                >
                  <Bell className="w-4 h-4" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center px-1 ring-2 ring-white dark:ring-slate-900 shadow-sm animate-in zoom-in-50 duration-200 select-none pointer-events-none">
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                  )}
                </button>

                {alertsOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setAlertsOpen(false)} />
                    <div className="absolute right-0 top-full mt-2 w-84 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-100">
                      {/* Header */}
                      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800">
                        <div className="flex items-center gap-1.5">
                          <Bell className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                          <span className="text-xs font-bold text-slate-900 dark:text-white">Portfolio Alerts</span>
                          {unreadCount > 0 && (
                            <span className="ml-1.5 px-2 py-0.5 rounded-full bg-rose-500 text-white text-[10px] font-bold shadow-xs">
                              {unreadCount}
                            </span>
                          )}
                        </div>
                        {unreadCount > 0 && (
                          <button
                            onClick={() => user?.id && void markAllAlertsRead(user.id)}
                            className="flex items-center gap-1 text-[11px] text-blue-600 dark:text-blue-400 hover:text-blue-700 font-medium transition-colors"
                            title="Mark all as read"
                          >
                            <CheckCheck className="w-3 h-3" />
                            Mark all read
                          </button>
                        )}
                      </div>

                      {/* Alert list */}
                      <div className="max-h-[340px] overflow-y-auto divide-y divide-slate-50 dark:divide-slate-800/60">
                        {alerts.length === 0 ? (
                          <div className="flex flex-col items-center justify-center py-10 gap-2 text-slate-400 dark:text-slate-500">
                            <Bell className="w-6 h-6 opacity-30" />
                            <p className="text-xs">No alerts yet for your portfolio stocks</p>
                          </div>
                        ) : (
                          alerts.slice(0, 30).map((alert) => (
                            <button
                              key={alert.id}
                              onClick={() => {
                                if (!alert.read && user?.id) void markAlertRead(user.id, alert.id);
                                const target = alert.url;
                                if (target) {
                                  if (/^https?:\/\//i.test(target)) window.open(target, "_blank", "noopener,noreferrer");
                                  else if (target.startsWith("/")) router.push(target);
                                }
                              }}
                              className={`w-full text-left px-4 py-3 flex gap-3 transition-colors group ${
                                alert.read
                                  ? "bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                                  : "bg-blue-50/60 dark:bg-blue-950/20 hover:bg-blue-50 dark:hover:bg-blue-950/30"
                              }`}
                            >
                              {/* Icon */}
                              <div className={`mt-0.5 w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
                                alert.type === "regulatory"
                                  ? "bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400"
                                  : "bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400"
                              }`}>
                                {alert.type === "regulatory"
                                  ? <FileText className="w-3 h-3" />
                                  : <Newspaper className="w-3 h-3" />
                                }
                              </div>
                              {/* Content */}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5 mb-0.5">
                                  <span className="text-[11px] font-bold text-slate-900 dark:text-white">
                                    {alert.stock}
                                  </span>
                                  {!alert.read && (
                                    <span className="w-2 h-2 rounded-full bg-blue-600 dark:bg-blue-400 shrink-0" />
                                  )}
                                </div>
                                <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-snug line-clamp-2">
                                  {alert.headline}
                                </p>
                                <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">
                                  {timeAgo(alert.timestamp)}
                                  {alert.source && ` · ${alert.source}`}
                                </p>
                              </div>
                            </button>
                          ))
                        )}
                      </div>

                      {/* Footer */}
                      <div className="px-4 py-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
                        <p className="text-[10px] text-slate-400 dark:text-slate-500">
                          Portfolio &amp; paper trading
                        </p>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              void authenticatedFetch("/api/alerts/trigger-test", {
                                method: "POST",
                                body: JSON.stringify({ action: "trigger" }),
                              }).finally(() => {
                                window.dispatchEvent(new CustomEvent("finpilot:alerts_updated"));
                              });
                            }}
                            className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700"
                          >
                            Test alert
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              void authenticatedFetch("/api/alerts/trigger-test", {
                                method: "POST",
                                body: JSON.stringify({ action: "remove" }),
                              }).finally(() => {
                                window.dispatchEvent(new CustomEvent("finpilot:alerts_updated"));
                              });
                            }}
                            className="text-[10px] font-semibold text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                          >
                            Clear tests
                          </button>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Bell for admin or non-logged-in (static, clean bell) */}
            {(!user || inAdminMode) && (
              <button
                className="relative p-2 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors border border-slate-200 dark:border-slate-700"
                title="Notifications"
              >
                <Bell className="w-4 h-4" />
              </button>
            )}

            {/* Theme Toggle */}
            <ThemeToggle />

            {/* Admin Profile Dropdown */}
            {inAdminMode ? (
              <div className="relative">
                <button
                  onClick={() => setUserMenuOpen((prev) => !prev)}
                  className="w-9 h-9 rounded-full bg-[#1E3A8A] dark:bg-blue-600 hover:bg-[#172554] dark:hover:bg-blue-500 text-white flex items-center justify-center font-bold text-xs uppercase shadow-sm transition-transform active:scale-95 cursor-pointer ring-2 ring-blue-200 dark:ring-blue-900/60"
                  title="System Administrator"
                  aria-expanded={userMenuOpen}
                >
                  <ShieldCheck className="w-4 h-4" />
                </button>

                {userMenuOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setUserMenuOpen(false)}
                    />
                    <div className="absolute right-0 top-full mt-2 w-60 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xl p-2 z-50 divide-y divide-slate-100 dark:divide-slate-800 animate-in fade-in zoom-in-95 duration-100">
                      <div className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-emerald-500" />
                          <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                            {adminUser?.displayName || "System Administrator"}
                          </p>
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                          {adminUser?.email || "admin@finpilot.internal"}
                        </p>
                      </div>

                      <div className="py-1">
                        <Link
                          href="/admin"
                          onClick={() => setUserMenuOpen(false)}
                          style={{ textDecoration: "none" }}
                          className="flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                        >
                          <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
                          <span>Admin Dashboard</span>
                        </Link>
                        <Link
                          href="/admin/users"
                          onClick={() => setUserMenuOpen(false)}
                          style={{ textDecoration: "none" }}
                          className="flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                        >
                          <UserIcon className="w-3.5 h-3.5 text-slate-500" />
                          <span>User Activity &amp; IP</span>
                        </Link>
                        <Link
                          href="/home?preview=user"
                          onClick={() => setUserMenuOpen(false)}
                          style={{ textDecoration: "none" }}
                          className="flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                        >
                          <ExternalLink className="w-3.5 h-3.5 text-slate-500" />
                          <span>Switch to User View</span>
                        </Link>
                      </div>

                      <div className="pt-1">
                        <button
                          onClick={() => {
                            setUserMenuOpen(false);
                            logoutAdmin();
                          }}
                          className="w-full flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors text-left cursor-pointer"
                        >
                          <LogOut className="w-3.5 h-3.5" />
                          <span>Sign out of Admin</span>
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            ) : (
              /* Regular User Avatar with Dropdown */
              user && (
                <div className="relative" ref={userMenuRef}>
                  <button
                    onClick={() => setUserMenuOpen((prev) => !prev)}
                    className="w-9 h-9 rounded-full bg-blue-50 dark:bg-blue-950/50 hover:bg-blue-100 dark:hover:bg-blue-900/60 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 flex items-center justify-center font-bold text-xs uppercase shadow-2xs transition-transform active:scale-95 cursor-pointer"
                    title="Account"
                    aria-expanded={userMenuOpen}
                  >
                    {displayName ? (
                      displayName.slice(0, 2).toUpperCase()
                    ) : (
                      <UserIcon className="w-4 h-4 text-blue-600" />
                    )}
                  </button>

                  {/* Dropdown Menu */}
                  {userMenuOpen && (
                    <>
                      <div
                        className="fixed inset-0 z-40"
                        onClick={() => setUserMenuOpen(false)}
                      />
                      <div className="absolute right-0 top-full mt-2 w-56 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xl p-2 z-50 divide-y divide-slate-100 dark:divide-slate-800 animate-in fade-in zoom-in-95 duration-100">
                        <div className="px-3 py-2">
                          <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                            {displayName || "FinPilot Investor"}
                          </p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                            {user.email}
                          </p>
                        </div>

                        <div className="py-1">
                          <Link
                            href="/profile"
                            onClick={() => setUserMenuOpen(false)}
                            style={{ textDecoration: "none" }}
                            className="flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                          >
                            <UserIcon className="w-3.5 h-3.5 text-slate-500" />
                            <span>Profile &amp; Settings</span>
                          </Link>
                        </div>

                        <div className="pt-1">
                          <button
                            onClick={() => {
                              setUserMenuOpen(false);
                              void signOut();
                            }}
                            className="w-full flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors text-left cursor-pointer"
                          >
                            <LogOut className="w-3.5 h-3.5" />
                            <span>Sign out</span>
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )
            )}
          </div>
        </div>

        {/* Mobile Navigation Drawer */}
        {mobileMenuOpen && (
          <div className="lg:hidden border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 flex flex-col gap-1 shadow-lg animate-in slide-in-from-top-2 duration-150">
            {navLinks.map((link) => {
              const active = isLinkActive(link);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  style={{ textDecoration: "none" }}
                  className={`text-xs font-semibold px-3 py-2 rounded-xl transition-colors ${
                    active
                      ? "bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 font-bold"
                      : "text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}

            {!inAdminMode && (
              <div className="flex items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800 mt-1">
                <Link
                  href="/cyro"
                  style={{ textDecoration: "none" }}
                  className="cyro-nav-btn flex-1 justify-center py-2 text-xs"
                >
                  <CyroBotIcon className="w-4 h-4 object-contain" />
                  <span>Ask CYRO</span>
                </Link>
                <ShortsNavButton />
              </div>
            )}
          </div>
        )}
      </header>

      {/* ─────────────────────────────────────────────────────────────
          2. CONTINUOUS MOVING INDICES TICKER MARQUEE (ALL PAGES)
      ───────────────────────────────────────────────────────────── */}
      <div
        style={{
          minHeight: "36px",
          maxHeight: "36px",
          height: "36px",
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          whiteSpace: "nowrap",
          backgroundColor: "#0a0f1d",
        }}
        className="w-full bg-[#0a0f1d] border-b border-slate-800 overflow-hidden select-none shrink-0 shadow-xs relative z-10"
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
          className="flex items-center space-x-11 whitespace-nowrap animate-marquee"
        >
          {tickerItems.length === 0 && (
            <span className="text-xs font-mono text-slate-500 px-6">Loading live market data…</span>
          )}
          {[...tickerItems, ...tickerItems, ...tickerItems].map((idx, index) => (
            <div
              key={index}
              style={{
                display: "inline-flex",
                alignItems: "center",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
              className="inline-flex items-center space-x-3 text-xs font-mono"
            >
              <span className="font-semibold text-slate-300 tracking-tight">
                {idx.name}
              </span>
              <span className="text-white font-bold tracking-tight">
                {idx.val}
              </span>
              <span
                className={`font-semibold text-[11px] ${
                  idx.up ? "text-emerald-400" : "text-rose-400"
                }`}
              >
                {idx.up ? "▲ " : "▼ "}
                {idx.pct}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
