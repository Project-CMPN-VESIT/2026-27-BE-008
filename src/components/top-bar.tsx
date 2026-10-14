"use client";

import { ThemeToggle } from "./theme-toggle";
import { Bell, Search } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import Link from "next/link";
import { useEffect, useState } from "react";
import { authenticatedFetch } from "@/lib/authenticated-fetch";

export function TopBar() {
  const { user, signOut } = useAuth();
  const [displayName, setDisplayName] = useState("");
  useEffect(() => {
    let active = true;
    setDisplayName(user?.name ?? "");
    if (!user) return () => { active = false; };
    void authenticatedFetch("/api/user/profile")
      .then((response) => response.json())
      .then(({ profile }) => { if (active && profile?.display_name) setDisplayName(profile.display_name); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [user?.id, user?.name]);
  return (
    <header className="sticky top-0 z-30 h-14 flex items-center justify-end gap-3 px-6 border-b border-slate-300 dark:border-slate-800 bg-white/80 dark:bg-slate-950/80 backdrop-blur-md">


      {/* Notifications */}
      <button className="relative p-2 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors border border-slate-300 dark:border-slate-700">
        <Bell className="w-4 h-4 text-slate-500 dark:text-slate-400" />
        <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-red-500 ring-2 ring-white dark:ring-slate-950" />
      </button>

      {/* Theme Toggle */}
      <ThemeToggle />
      <div className="flex items-center gap-2 border-l border-slate-200 pl-3 dark:border-slate-700">
        <Link href="/profile" className="max-w-40 truncate text-sm text-slate-600 hover:text-blue-600 dark:text-slate-300" title={user?.email}>{displayName}</Link>
        <button onClick={() => void signOut()} className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">Sign out</button>
      </div>
    </header>
  );
}
