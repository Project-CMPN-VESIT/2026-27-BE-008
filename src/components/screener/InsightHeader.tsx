"use client";

import React from "react";
import { Bookmark, Sparkles, Filter as FilterIcon, Info } from "lucide-react";

interface InsightHeaderProps {
  resultCount: number;
  presets: Array<{ name: string; ast: any }>;
  activePresetIndex: number;
  onPresetChange: (idx: number) => void;
  isLoading: boolean;
  onRunScreen: () => void;
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
  insights,
  onFilterHighQuality,
  onFilterValue,
  onSaveScreen
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
    <div className="flex flex-col gap-4 mb-4">
      {/* Top section */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
            Discovery Screener <Sparkles className="w-5 h-5 text-blue-500" />
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Build institutional-grade equity screens with zero code.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800/50 p-1 rounded-lg border border-slate-200 dark:border-slate-800">
            <span className="text-xs font-semibold text-slate-500 px-2 uppercase tracking-wider">
              Mode
            </span>
            <select
              className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-sm font-medium rounded-md px-3 py-1.5 shadow-sm focus:ring-2 focus:ring-blue-500 outline-none transition-shadow w-48"
              value={activePresetIndex}
              onChange={(e) => onPresetChange(Number(e.target.value))}
            >
              {presets.map((p, i) => (
                <option key={i} value={i}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          
          <button 
            onClick={() => setIsSaveModalOpen(true)}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors shadow-sm text-slate-700 dark:text-slate-300"
          >
            <Bookmark className="w-4 h-4 text-slate-400" />
            Save Screen
          </button>
        </div>
      </div>

      {isSaveModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl w-full max-w-md p-6">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">Save Custom Screen</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
              Save your current filter parameters to your persistent watchlist.
            </p>
            <input 
              type="text" 
              placeholder="e.g., High Growth Tech Gems" 
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none mb-6"
              value={screenName}
              onChange={e => setScreenName(e.target.value)}
              autoFocus
            />
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setIsSaveModalOpen(false)}
                className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={handleSave}
                disabled={!screenName.trim() || isSaving}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg text-sm font-bold shadow-md transition-colors"
              >
                {isSaving ? "Saving..." : "Save Screen"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Insight Summary Banner */}
      <div className="flex items-center gap-6 bg-gradient-to-r from-blue-50/50 to-slate-50 dark:from-slate-900 dark:to-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm">
        <div className="flex flex-col border-r border-slate-200 dark:border-slate-800 pr-6">
          <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            Companies Matched
          </span>
          <div className="text-3xl font-black text-slate-900 dark:text-white mt-1 tracking-tight">
            {isLoading ? "..." : resultCount}
          </div>
        </div>
        
        <div className="flex flex-col flex-1">
          <div className="flex items-center justify-between text-[11px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider mb-2">
            <span className="flex items-center gap-1.5"><Info className="w-3.5 h-3.5" /> Cohort Analysis</span>
            {insights?.topPerformer && (
              <span className="text-emerald-600 dark:text-emerald-400 normal-case tracking-normal font-medium bg-emerald-50 dark:bg-emerald-900/20 px-2 py-0.5 rounded">
                Top Performer: <strong className="font-bold">{insights.topPerformer.symbol}</strong> ({insights.topPerformer.roe.toFixed(1)}% ROE)
              </span>
            )}
          </div>
          
          {insights && !isLoading ? (
            <div className="flex items-center gap-4">
              <div className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 px-3 py-1.5 rounded-lg flex items-center gap-2">
                <span className="text-xs text-slate-500">Median P/E:</span>
                <span className="text-sm font-bold text-slate-900 dark:text-white">{insights.medianPE?.toFixed(2) || "—"}</span>
              </div>
              <button 
                onClick={onFilterHighQuality}
                className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/50 hover:border-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 px-3 py-1.5 rounded-lg flex items-center gap-2 transition-colors"
                title="Click to filter by ROE > 15%"
              >
                <span className="text-xs text-emerald-600 dark:text-emerald-500 font-medium">High Quality:</span>
                <span className="text-sm font-bold text-emerald-700 dark:text-emerald-400">{insights.highRoeCount} stocks</span>
                <span className="text-xs text-emerald-600/70 dark:text-emerald-500/70">(ROE {'>'} 15%)</span>
              </button>
              <button 
                onClick={onFilterValue}
                className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/50 hover:border-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/50 px-3 py-1.5 rounded-lg flex items-center gap-2 transition-colors"
                title="Click to filter by P/E < 20 & ROE > 15%"
              >
                <span className="text-xs text-blue-600 dark:text-blue-500 font-medium">Value Plays:</span>
                <span className="text-sm font-bold text-blue-700 dark:text-blue-400">{insights.undervaluedCount} stocks</span>
              </button>
            </div>
          ) : (
             <div className="text-sm font-medium text-slate-400 italic">
               {isLoading ? "Analyzing cohort metrics..." : "Run screen to generate insights."}
             </div>
          )}
        </div>
        
        <div>
           <button
            onClick={onRunScreen}
            disabled={isLoading}
            className={`flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg font-bold text-sm shadow-sm transition-all ${
              isLoading 
                ? "bg-slate-300 dark:bg-slate-800 cursor-not-allowed text-slate-500 dark:text-slate-400" 
                : "bg-blue-600 hover:bg-blue-700 hover:shadow-md text-white active:scale-95 border border-blue-500"
            }`}
          >
            {isLoading ? (
              <>
                <svg className="animate-spin -ml-1 mr-2 h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Evaluating...
              </>
            ) : (
              <>
                <FilterIcon className="w-4 h-4" /> Run Screen
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
