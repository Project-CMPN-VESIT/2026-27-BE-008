"use client";

import React from "react";
import { X, ArrowRightLeft, TrendingUp } from "lucide-react";

interface ComparePanelProps {
  selectedSymbols: string[];
  onClear: () => void;
  onCompare: () => void;
}

import { useRouter } from "next/navigation";

export function ComparePanel({ selectedSymbols, onClear }: { selectedSymbols: string[], onClear: () => void }) {
  const router = useRouter();

  if (selectedSymbols.length === 0) return null;

  const handleCompare = () => {
    router.push(`/compare?symbols=${selectedSymbols.join(',')}`);
  };

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-10 fade-in duration-300">
      <div className="bg-slate-900 dark:bg-slate-800 text-white rounded-2xl shadow-2xl border border-slate-700 dark:border-slate-600 p-4 flex items-center gap-6 min-w-[400px]">
        
        <div className="flex flex-col flex-1">
          <span className="text-xs text-slate-400 font-medium uppercase tracking-wider">Ready for Comparison</span>
          <div className="text-base font-bold flex items-center gap-2 mt-0.5">
            {selectedSymbols.length} {selectedSymbols.length === 1 ? 'Company' : 'Companies'} Selected
          </div>
          <div className="flex items-center gap-1.5 mt-2 overflow-hidden max-w-[300px]">
            {selectedSymbols.slice(0, 3).map(sym => (
              <span key={sym} className="text-[10px] font-mono bg-slate-800 dark:bg-slate-900 border border-slate-700 px-2 py-1 rounded truncate">
                {sym}
              </span>
            ))}
            {selectedSymbols.length > 3 && (
              <span className="text-[10px] text-slate-400 font-medium ml-1">+{selectedSymbols.length - 3} more</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 border-l border-slate-700 pl-6">
          <button 
            onClick={onClear}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
            title="Clear Selection"
          >
            <X className="w-5 h-5" />
          </button>
          
          <button 
            onClick={handleCompare}
            disabled={selectedSymbols.length < 2}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm transition-all shadow-lg ${
              selectedSymbols.length < 2 
                ? "bg-slate-800 text-slate-500 cursor-not-allowed" 
                : "bg-blue-600 hover:bg-blue-500 text-white active:scale-95"
            }`}
          >
            {selectedSymbols.length < 2 ? (
              <>Select at least 2</>
            ) : (
              <>
                <ArrowRightLeft className="w-4 h-4" /> Compare
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
