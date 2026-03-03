"use client";

import { ThemeToggle } from "./theme-toggle";
import { Bell, Search } from "lucide-react";

export function TopBar() {
  return (
    <header className="sticky top-0 z-30 h-14 flex items-center justify-end gap-3 px-6 border-b border-slate-300 dark:border-slate-800 bg-white/80 dark:bg-slate-950/80 backdrop-blur-md">
      {/* Search */}
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-400 hover:text-slate-500 dark:hover:text-slate-300 cursor-pointer transition-colors">
        <Search className="w-3.5 h-3.5" />
        <span className="text-xs font-medium">Search...</span>
        <kbd className="ml-4 text-[10px] px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400 font-mono">⌘K</kbd>
      </div>

      {/* Notifications */}
      <button className="relative p-2 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors border border-slate-300 dark:border-slate-700">
        <Bell className="w-4 h-4 text-slate-500 dark:text-slate-400" />
        <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-red-500 ring-2 ring-white dark:ring-slate-950" />
      </button>

      {/* Theme Toggle */}
      <ThemeToggle />
    </header>
  );
}
