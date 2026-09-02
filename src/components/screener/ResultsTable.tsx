"use client";

import React, { useRef, useState, useMemo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowUpDown, Search, BarChart3, Zap, AlertTriangle, HelpCircle } from "lucide-react";
import Link from "next/link";

interface ResultsTableProps {
  results: any[];
  isLoading: boolean;
  selectedSymbols: string[];
  onSelectionChange: (symbols: string[]) => void;
}

type SortField = "symbol" | "current_price" | "market_cap" | "pe_ttm" | "pb" | "roe" | "roce" | "debt_equity" | "dividend_yield";

export function ResultsTable({ results, isLoading, selectedSymbols, onSelectionChange }: ResultsTableProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<SortField>("market_cap");
  const [sortAsc, setSortAsc] = useState(false);

  // Client-side quick search & sorting
  const processedResults = useMemo(() => {
    let list = [...results];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((r) => r.symbol.toLowerCase().includes(q));
    }

    list.sort((a, b) => {
      let valA = sortField === "symbol" ? a.symbol : (a.metrics?.[sortField] ?? -Infinity);
      let valB = sortField === "symbol" ? b.symbol : (b.metrics?.[sortField] ?? -Infinity);

      if (valA === null || valA === undefined) valA = -Infinity;
      if (valB === null || valB === undefined) valB = -Infinity;

      if (typeof valA === "string") {
        return sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      return sortAsc ? valA - valB : valB - valA;
    });

    return list;
  }, [results, searchQuery, sortField, sortAsc]);

  const virtualizer = useVirtualizer({
    count: processedResults.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 44, // Dense row height
    overscan: 12,
  });

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortAsc((prev) => !prev);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  const formatNumber = (val: number | null | undefined, type: "currency" | "percent" | "ratio" = "ratio") => {
    if (val === null || val === undefined) {
      return <span className="text-slate-300 dark:text-slate-600">—</span>;
    }
    if (type === "percent") return `${val.toFixed(2)}%`;
    if (type === "currency") return `₹${(val / 10000000).toLocaleString("en-IN", { maximumFractionDigits: 1 })} Cr`;
    return val.toFixed(2);
  };

  const cleanSymbol = (sym: string) => sym.replace(/\.NS$/, "");

  const toggleSelection = (symbol: string) => {
    if (selectedSymbols.includes(symbol)) {
      onSelectionChange(selectedSymbols.filter((s) => s !== symbol));
    } else {
      onSelectionChange([...selectedSymbols, symbol]);
    }
  };

  const toggleAll = () => {
    if (selectedSymbols.length === processedResults.length) {
      onSelectionChange([]);
    } else {
      onSelectionChange(processedResults.map((r) => r.symbol));
    }
  };

  // 12 column layout
  const gridTemplate = "36px 36px minmax(140px, 1.8fr) minmax(90px, 1fr) minmax(120px, 1.3fr) minmax(75px, 0.8fr) minmax(75px, 0.8fr) minmax(80px, 0.9fr) minmax(80px, 0.9fr) minmax(80px, 0.9fr) minmax(85px, 0.9fr) 110px";

  return (
    <div className="flex-1 min-h-0 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm flex flex-col overflow-hidden">
      {/* Table Header Controls */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 text-xs shrink-0">
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search results..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg pl-8 pr-3 py-1 text-xs outline-none focus:ring-1 focus:ring-blue-500 w-44"
            />
          </div>
          <span className="text-[11px] text-slate-400 font-medium hidden sm:inline">
            Showing {processedResults.length} stocks
          </span>
        </div>

        <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
          <span>Sort: <strong className="text-slate-800 dark:text-slate-200 uppercase">{sortField.replace("_", " ")}</strong> ({sortAsc ? "Asc" : "Desc"})</span>
        </div>
      </div>

      {/* Column Headers */}
      <div
        className="grid border-b border-slate-200 dark:border-slate-800 bg-slate-100/70 dark:bg-slate-950 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 shrink-0 select-none"
        style={{ gridTemplateColumns: gridTemplate }}
      >
        <div className="px-2 py-2 flex items-center justify-center">
          <input
            type="checkbox"
            className="w-3.5 h-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
            checked={selectedSymbols.length > 0 && selectedSymbols.length === processedResults.length}
            onChange={toggleAll}
          />
        </div>
        <div className="px-1 py-2 text-center text-slate-400">#</div>

        {[
          { id: "symbol", label: "Stock", align: "left" },
          { id: "current_price", label: "Price", align: "right" },
          { id: "market_cap", label: "Market Cap", align: "right" },
          { id: "pe_ttm", label: "P/E", align: "right" },
          { id: "pb", label: "P/B", align: "right" },
          { id: "roe", label: "ROE", align: "right" },
          { id: "roce", label: "ROCE", align: "right" },
          { id: "debt_equity", label: "Debt/Eq", align: "right" },
          { id: "dividend_yield", label: "Div %", align: "right" },
        ].map((col) => (
          <div
            key={col.id}
            onClick={() => handleSort(col.id as SortField)}
            className={`px-2 py-2 flex items-center gap-1 cursor-pointer hover:bg-slate-200/60 dark:hover:bg-slate-800/80 transition-colors ${
              col.align === "right" ? "justify-end" : "justify-start"
            } ${sortField === col.id ? "text-blue-600 dark:text-blue-400" : ""}`}
            title={`Sort by ${col.label}`}
          >
            <span>{col.label}</span>
            <ArrowUpDown className="w-2.5 h-2.5 opacity-60" />
          </div>
        ))}

        <div className="px-2 py-2 text-right pr-3">Actions</div>
      </div>

      {/* Virtual Table Body */}
      {isLoading ? (
        <div className="flex-1 flex flex-col items-center justify-center text-slate-400 py-16">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-3" />
          <span className="text-xs font-semibold">Running screener engine...</span>
        </div>
      ) : processedResults.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-slate-400 py-16">
          <AlertTriangle className="w-8 h-8 text-slate-400 mb-2" />
          <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">No stocks matched this criteria.</p>
          <p className="text-xs text-slate-400 mt-0.5">Try adjusting or removing filters in the query builder above.</p>
        </div>
      ) : (
        <div ref={parentRef} className="flex-1 min-h-0 overflow-y-auto relative custom-scrollbar">
          <div style={{ height: `${virtualizer.getTotalSize()}px`, width: "100%", position: "relative" }}>
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const item = processedResults[virtualItem.index];
              const m = item.metrics || {};
              const isSelected = selectedSymbols.includes(item.symbol);
              const ticker = cleanSymbol(item.symbol);

              return (
                <div
                  key={virtualItem.key}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: `${virtualItem.size}px`,
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                  className={`border-b transition-colors text-xs group ${
                    isSelected
                      ? "bg-blue-50/70 dark:bg-blue-950/30 border-blue-200 dark:border-blue-900/60"
                      : "border-slate-100 dark:border-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                  }`}
                >
                  <div className="w-full h-full grid items-center" style={{ gridTemplateColumns: gridTemplate }}>
                    {/* Checkbox */}
                    <div className="px-2 flex items-center justify-center">
                      <input
                        type="checkbox"
                        className="w-3.5 h-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                        checked={isSelected}
                        onChange={() => toggleSelection(item.symbol)}
                      />
                    </div>

                    {/* Row Index */}
                    <div className="px-1 text-center text-[11px] font-medium text-slate-400">
                      {virtualItem.index + 1}
                    </div>

                    {/* Stock Symbol */}
                    <div className="px-2 font-bold text-slate-900 dark:text-white truncate flex items-center gap-1.5">
                      <Link
                        href={`/chart?symbol=NSE:${ticker}`}
                        className="hover:text-blue-600 dark:hover:text-blue-400 hover:underline flex items-center gap-1 truncate"
                        title={`Open chart for ${ticker}`}
                      >
                        <span>{ticker}</span>
                      </Link>
                    </div>

                    {/* Price */}
                    <div className="px-2 text-right font-bold text-slate-900 dark:text-slate-100">
                      {m.current_price ? `₹${m.current_price.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}
                    </div>

                    {/* Market Cap */}
                    <div className="px-2 text-right font-medium text-slate-700 dark:text-slate-300">
                      {formatNumber(m.market_cap, "currency")}
                    </div>

                    {/* P/E */}
                    <div className="px-2 text-right font-semibold text-slate-700 dark:text-slate-300">
                      {formatNumber(m.pe_ttm)}
                    </div>

                    {/* P/B */}
                    <div className="px-2 text-right font-medium text-slate-700 dark:text-slate-300">
                      {formatNumber(m.pb)}
                    </div>

                    {/* ROE */}
                    <div className={`px-2 text-right font-bold ${(m.roe ?? 0) > 15 ? "text-emerald-600 dark:text-emerald-400" : "text-slate-700 dark:text-slate-300"}`}>
                      {formatNumber(m.roe, "percent")}
                    </div>

                    {/* ROCE */}
                    <div className="px-2 text-right font-medium text-slate-400">
                      {formatNumber(m.roce, "percent")}
                    </div>

                    {/* Debt / Eq */}
                    <div className={`px-2 text-right font-medium ${(m.debt_equity ?? 0) > 1.2 ? "text-red-500 font-bold" : "text-slate-700 dark:text-slate-300"}`}>
                      {formatNumber(m.debt_equity)}
                    </div>

                    {/* Dividend Yield */}
                    <div className="px-2 text-right font-medium text-slate-700 dark:text-slate-300">
                      {formatNumber(m.dividend_yield, "percent")}
                    </div>

                    {/* Quick Action Buttons */}
                    <div className="px-2 flex items-center justify-end gap-1.5 pr-3">
                      <Link
                        href={`/chart?symbol=NSE:${ticker}`}
                        className="p-1 rounded bg-slate-100 dark:bg-slate-800 hover:bg-blue-50 dark:hover:bg-blue-900/40 text-slate-600 dark:text-slate-300 hover:text-blue-600 transition-colors"
                        title="Interactive Chart"
                      >
                        <BarChart3 className="w-3.5 h-3.5" />
                      </Link>
                      <Link
                        href={`/cyro`}
                        className="p-1 rounded bg-slate-100 dark:bg-slate-800 hover:bg-violet-50 dark:hover:bg-violet-900/40 text-slate-600 dark:text-slate-300 hover:text-violet-600 transition-colors"
                        title="Analyze in CYRO"
                      >
                        <Zap className="w-3.5 h-3.5" />
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
