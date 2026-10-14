"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Sparkles,
  Shield,
  Search,
  BarChart3,
  AlertTriangle,
  Users,
  Newspaper,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Zap,
  Activity,
  Map,
  Flame,
  Layers,
  Trophy
} from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { authenticatedFetch } from "@/lib/authenticated-fetch";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/cyro", label: "CYRO", icon: Sparkles },
  { href: "/regulatory", label: "SEBI Shield", icon: Shield },
  { href: "/screener", label: "Screener", icon: Search },
  { href: "/news-feed", label: "News Feed", icon: Newspaper },
  { href: "/heatmap", label: "Heatmap", icon: Map },
  { href: "/baskets", label: "AI Baskets", icon: Layers },
  { href: "/invest-like", label: "Invest Like", icon: Trophy },
  { href: "/results-calendar", label: "Results Calendar", icon: CalendarDays },
  { href: "/paper-trading", label: "Paper Trading", icon: Activity },
  { href: "/nifty-shorts", label: "Nifty Shorts", icon: Flame },
];

export function Sidebar() {
  const pathname = usePathname();
  const { user } = useAuth();
  const [preferencesUid, setPreferencesUid] = useState("");
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    let active = true;
    setPreferencesUid("");
    if (!user) return () => { active = false; };
    void authenticatedFetch("/api/user/preferences")
      .then((response) => response.json())
      .then(({ preferences }) => {
        if (!active) return;
        if (typeof preferences?.sidebarCollapsed === "boolean") setCollapsed(preferences.sidebarCollapsed);
        else setCollapsed(window.localStorage.getItem(`finpilot-sidebar-collapsed:${user.id}`) === "1");
      })
      .catch(() => undefined)
      .finally(() => { if (active) setPreferencesUid(user.id); });
    return () => { active = false; };
  }, [user?.id]);

  useEffect(() => {
    document.body.classList.toggle("sidebar-collapsed", collapsed);
    if (user) window.localStorage.setItem(`finpilot-sidebar-collapsed:${user.id}`, collapsed ? "1" : "0");
    if (user && preferencesUid === user.id) {
      void authenticatedFetch("/api/user/preferences", {
        method: "PUT", body: JSON.stringify({ preferences: { sidebarCollapsed: collapsed } }),
      }).catch(() => undefined);
    }
    return () => {
      document.body.classList.remove("sidebar-collapsed");
    };
  }, [collapsed, user?.id, preferencesUid]);

  return (
    <aside
      className={`fixed left-0 top-0 h-screen z-40 flex flex-col transition-all duration-300 ${
        collapsed ? "w-[68px]" : "w-60"
      } bg-white dark:bg-slate-950 border-r border-slate-300 dark:border-slate-800`}
    >
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 h-14 border-b border-slate-300 dark:border-slate-800 shrink-0">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center shrink-0">
          <Zap className="w-4.5 h-4.5 text-white" />
        </div>
        {!collapsed && (
          <div className="flex flex-col">
            <span className="text-sm font-bold text-slate-900 dark:text-white tracking-tight">
              FinPilot
            </span>
            <span className="text-[10px] text-slate-500 dark:text-slate-400 -mt-0.5 font-medium">
              EQUITY RESEARCH
            </span>
          </div>
        )}
      </div>

      {/* Nav Items */}
      <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`group flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
                isActive
                  ? "bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-100 dark:border-blue-500/20"
                  : "text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-slate-200 border border-transparent"
              }`}
              title={collapsed ? item.label : undefined}
            >
              <item.icon
                className={`w-[18px] h-[18px] shrink-0 ${
                  isActive
                    ? "text-blue-600 dark:text-blue-400"
                    : "text-slate-400 dark:text-slate-500 group-hover:text-slate-600 dark:group-hover:text-slate-300"
                }`}
              />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Bottom section */}
      <div className="p-3 border-t border-slate-300 dark:border-slate-800 shrink-0 flex justify-center">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors border border-slate-300 dark:border-slate-700"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? (
            <ChevronRight className="w-4 h-4 text-slate-500" />
          ) : (
            <ChevronLeft className="w-4 h-4 text-slate-500" />
          )}
        </button>
      </div>
    </aside>
  );
}
