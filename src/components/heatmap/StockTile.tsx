"use client";

import React, { useMemo } from "react";
import { HeatmapQuote } from "@/hooks/useHeatmapData";
import Link from "next/link";

interface StockTileProps {
  symbol: string;
  companyName: string;
  quote: HeatmapQuote | null;
  weight?: number | null;
  marketCap?: number | null;
  totalMarketCap?: number;
  totalWeight?: number;
}

export const StockTile: React.FC<StockTileProps> = ({
  symbol,
  companyName,
  quote,
  weight,
  marketCap,
  totalMarketCap,
  totalWeight,
  isStale = false,
}) => {
  const pChange = quote?.pChange ?? 0;
  
  // Calculate sizing
  const flexBasis = useMemo(() => {
    // 1. If official index weight exists
    if (weight !== undefined && weight !== null && totalWeight) {
      return `${Math.max(2, (weight / totalWeight) * 100)}%`;
    }
    // 2. Else if live market cap exists
    if (marketCap !== undefined && marketCap !== null && totalMarketCap) {
      return `${Math.max(2, (marketCap / totalMarketCap) * 100)}%`;
    }
    // 3. Else Equal Fallback
    return "1"; // flex-grow: 1 (equal fallback)
  }, [weight, marketCap, totalMarketCap, totalWeight]);

  // Dynamic background color and text color based on % change
  const theme = useMemo(() => {
    if (!quote) return { bg: "#cbd5e1", textClass: "text-slate-500", darkBg: "#1e293b" }; // No data yet (slate-300 / slate-800)

    if (pChange > 0) {
      if (pChange > 3) return { bg: "#059669", textClass: "text-white", darkBg: "#059669" }; // emerald-600
      if (pChange > 1) return { bg: "#10b981", textClass: "text-white", darkBg: "#10b981" }; // emerald-500
      return { bg: "#34d399", textClass: "text-emerald-950 dark:text-emerald-50", darkBg: "#059669" }; // emerald-400 / 600
    } else if (pChange < 0) {
      if (pChange < -3) return { bg: "#e11d48", textClass: "text-white", darkBg: "#e11d48" }; // rose-600
      if (pChange < -1) return { bg: "#f43f5e", textClass: "text-white", darkBg: "#f43f5e" }; // rose-500
      return { bg: "#fb7185", textClass: "text-rose-950 dark:text-rose-50", darkBg: "#e11d48" }; // rose-400 / 600
    }
    return { bg: "#94a3b8", textClass: "text-slate-800 dark:text-slate-200", darkBg: "#334155" }; // neutral (slate-400 / slate-700)
  }, [pChange, quote]);

  // Is this a big tile? Grid makes them equal width, but we can show extra data.
  const isLarge = true; 
  const tileId = `tile-${symbol.replace(/[^a-zA-Z0-9]/g, '-')}`;

  return (
    <Link
      id={tileId}
      href={`/chart?symbol=${symbol}&marketId=NSE:${symbol.replace(/[-&]/g, '_')}`}
      className={`relative flex flex-col p-2 border border-slate-300/50 dark:border-slate-900/50 overflow-hidden hover:brightness-110 transition-colors shadow-sm rounded-sm min-h-[96px] h-full ${theme.textClass}`}
      style={{
        backgroundColor: "var(--tile-bg)", 
      }}
      title={`${companyName} (${symbol})\nLTP: ₹${quote?.ltp?.toFixed(2) ?? "-"}\nChange: ${pChange.toFixed(2)}%`}
    >
      <style>{`
        :root:where(.dark, .dark *) #${tileId} {
          --tile-bg: ${theme.darkBg};
        }
        #${tileId} {
          --tile-bg: ${theme.bg};
        }
      `}</style>
      <div className="flex justify-between items-start w-full">
        <span className="font-bold text-sm truncate pr-2">{symbol}</span>
        {!quote && <span className="text-[10px] bg-rose-900/30 px-1 rounded">No Data</span>}
      </div>
      
      <div className="mt-auto">
        <div className="text-sm font-semibold">
          {quote ? `₹${quote.ltp?.toFixed(2)}` : "-"}
        </div>
        <div className="text-xs font-medium opacity-90">
          {quote ? `${pChange > 0 ? "+" : ""}${pChange.toFixed(2)}%` : "-"}
        </div>
      </div>
      
      {isLarge && quote?.volume && (
        <div className="text-[10px] mt-1 truncate opacity-75">
          Vol: {(quote.volume / 1000000).toFixed(2)}M
        </div>
      )}
      
    </Link>
  );
};
