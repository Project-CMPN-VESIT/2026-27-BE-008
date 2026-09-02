"use client";

import React from "react";
import { Bookmark, Sparkles, Filter as FilterIcon, Info, SlidersHorizontal, RefreshCw, Layers } from "lucide-react";

interface InsightHeaderProps {
  resultCount: number;
  presets: Array<{ name: string; ast: any }>;
  activePresetIndex: number;
  onPresetChange: (idx: number) => void;
  isLoading: boolean;
  onRunScreen: () => void;
  filterCount: number;
  isFiltersOpen: boolean;
  onToggleFilters: () => void;
  insights: {
    medianPE: number | null;
    highRoeCount: number;
    undervaluedCount: number;
    topPerformer?: { symbol: string; roe: number } | null;
  } | null;
  onFilterHighQuality?: () => void;
  onFilterValue?: () => void;
  onSaveScreen?: (name: string) => Promise<void>;
}

export function InsightHeader({
  resultCount,
  presets,
  activePresetIndex,
  onPresetChange,
  isLoading,
  onRunScreen,
  filterCount,
  isFiltersOpen,
  onToggleFilters,
  insights,
  onFilterHighQuality,
  onFilterValue,
  onSaveScreen,
}: InsightHeaderProps) {
  const [isSaveModalOpen, setIsSaveModalOpen] = React.useState(false);
  const [screenName, setScreenName] = React.useState("");
  const [isSaving, setIsSaving] = React.useState(false);

  const handleSave = async () => {
    if (!screenName.trim() || !onSaveScreen) return;
    setIsSaving(true);
    await onSaveScreen(screenName.trim());
    setIsSaving(false);
    setIsSaveModalOpen(false);
    setScreenName("");
  };

  return (
    <div className="flex flex-col gap-2.5 mb-3 shrink-0">
      {/* Primary Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl px-4 py-3 shadow-sm">
        {/* Left: Brand & Preset Pills */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-2 mr-1">
            <div className="w-8 h-8 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-sm shadow-blue-500/20">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-slate-900 dark:text-white leading-tight">
                Stock Screener
              </h1>
            </div>
          </div>

          <div className="h-5 w-px bg-slate-200 dark:bg-slate-800 hidden md:block" />

          {/* Quick Preset Pills for instant 1-click switching */}
          <div className="flex flex-wrap items-center gap-1.5">
            {presets.slice(0, 5).map((p, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => onPresetChange(idx)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  activePresetIndex === idx
                    ? "bg-blue-600 text-white shadow-sm"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
                }`}
              >
                {p.name}
              </button>
            ))}

            {presets.length > 5 && (
              <select
                className="bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold rounded-xl px-2.5 py-1.5 text-slate-700 dark:text-slate-300 outline-none"
                value={activePresetIndex >= 5 ? activePresetIndex : ""}
                onChange={(e) => onPresetChange(Number(e.target.value))}
              >
                <option value="" disabled>
                  More Screens...
                </option>
                {presets.slice(5).map((p, i) => (
                  <option key={i + 5} value={i + 5}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* Right: Counters & Action Buttons */}
        <div className="flex items-center gap-2">
          {/* Matched Count */}
          <div className="flex items-center gap-1 px-3 py-1.5 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/50 rounded-xl text-xs font-bold text-blue-700 dark:text-blue-400">
            <span>{isLoading ? "..." : resultCount}</span>
            <span className="text-blue-500/80 font-medium">stocks</span>
          </div>

          {/* Filter Toggle */}
          <button
            type="button"
            onClick={onToggleFilters}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${
              isFiltersOpen
                ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                : "bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100"
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>Custom Filters</span>
            {filterCount > 0 && (
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${isFiltersOpen ? "bg-white/20 text-white" : "bg-blue-500/10 text-blue-600 dark:text-blue-400"}`}>
                {filterCount}
              </span>
            )}
          </button>

          {/* Save Screen */}
          <button
            type="button"
            onClick={() => setIsSaveModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-100 text-slate-700 dark:text-slate-300 transition-colors"
          >
            <Bookmark className="w-3.5 h-3.5 text-slate-400" />
            <span className="hidden sm:inline">Save</span>
          </button>

          {/* Refresh/Run Button */}
          <button
            type="button"
            onClick={onRunScreen}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl font-bold text-xs bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white shadow-sm transition-all active:scale-95"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
            <span>{isLoading ? "Screening..." : "Scan"}</span>
          </button>
        </div>
      </div>

      {/* Cohort Insight Summary Ribbon */}
      {insights && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 bg-slate-100/90 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-xl text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
              <Info className="w-3 h-3 text-blue-500" /> Market Cohort:
            </span>

            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-700 dark:text-slate-300">
              <span className="text-slate-400 font-medium">Median P/E:</span>
              <strong className="font-bold">{insights.medianPE ? insights.medianPE.toFixed(1) : "—"}</strong>
            </div>

            <button
              type="button"
              onClick={onFilterHighQuality}
              className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 hover:bg-emerald-100 rounded-lg text-emerald-700 dark:text-emerald-400 transition-colors font-bold cursor-pointer"
              title="Click to filter for ROE > 15%"
            >
              <span>High Quality (ROE &gt; 15%):</span>
              <strong>{insights.highRoeCount} stocks</strong>
            </button>

            <button
              type="button"
              onClick={onFilterValue}
              className="flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800/60 hover:bg-blue-100 rounded-lg text-blue-700 dark:text-blue-400 transition-colors font-bold cursor-pointer"
              title="Click to filter for P/E < 20 & ROE > 15%"
            >
              <span>Value Plays:</span>
              <strong>{insights.undervaluedCount} stocks</strong>
            </button>
          </div>

          {insights.topPerformer && (
            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
              Top ROE: <strong className="text-emerald-600 dark:text-emerald-400 font-bold">{insights.topPerformer.symbol}</strong> ({insights.topPerformer.roe.toFixed(1)}%)
            </div>
          )}
        </div>
      )}

      {/* Save Screen Modal */}
      {isSaveModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl w-full max-w-md p-5">
            <h3 className="text-base font-bold text-slate-900 dark:text-white mb-1">Save Custom Screen</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
              Save your current filter conditions to your custom screens list.
            </p>
            <input
              type="text"
              placeholder="e.g. Compounders with High ROE"
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none mb-4"
              value={screenName}
              onChange={(e) => setScreenName(e.target.value)}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsSaveModalOpen(false)}
                className="px-3.5 py-1.5 text-xs font-bold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={!screenName.trim() || isSaving}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-xl text-xs font-bold shadow transition-colors"
              >
                {isSaving ? "Saving..." : "Save Screen"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
