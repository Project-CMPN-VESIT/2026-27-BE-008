"use client";

import React, { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDownAZ, HelpCircle, AlertTriangle } from "lucide-react";
import Link from "next/link";

interface ResultsTableProps {
  results: any[];
  isLoading: boolean;
  selectedSymbols: string[];
  onSelectionChange: (symbols: string[]) => void;
}

export function ResultsTable({ results, isLoading, selectedSymbols, onSelectionChange }: ResultsTableProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: results.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 48, // Dense row height
    overscan: 10,
  });

  const formatNumber = (val: number | null | undefined, type: 'currency' | 'percent' | 'ratio' = 'ratio') => {
    if (val === null || val === undefined) {
      return (
        <span 
          className="text-slate-300 dark:text-slate-700/50 cursor-help" 
          title="Awaiting verified XBRL filing data"
        >
          —
        </span>
      );
    }
    if (type === 'percent') return `${val.toFixed(2)}%`;
    if (type === 'currency') return `₹${(val / 10000000).toLocaleString('en-IN', { maximumFractionDigits: 2 })} Cr`;
    return val.toFixed(2);
  };

  const getMetricColor = (field: string, val: number | null | undefined) => {
    if (val === null || val === undefined) return "";
    if (field === "roe" && val > 15) return "text-emerald-600 dark:text-emerald-400 font-medium";
    if (field === "debt_equity" && val > 1) return "text-red-600 dark:text-red-400 font-medium";
    return "";
  };

  const toggleSelection = (symbol: string) => {
    if (selectedSymbols.includes(symbol)) {
      onSelectionChange(selectedSymbols.filter(s => s !== symbol));
    } else {
      onSelectionChange([...selectedSymbols, symbol]);
    }
  };

  const toggleAll = () => {
    if (selectedSymbols.length === results.length) {
      onSelectionChange([]);
    } else {
      onSelectionChange(results.map(r => r.symbol));
    }
  };

  if (isLoading) {
    return (
      <div className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center text-slate-400">
          <svg className="animate-spin h-8 w-8 text-blue-500 mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span className="font-medium text-sm">Evaluating Screen AST...</span>
        </div>
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center text-slate-400">
           <AlertTriangle className="w-12 h-12 mb-3 text-slate-300 dark:text-slate-600" />
           <p className="font-medium">No companies matched this strict criteria.</p>
           <p className="text-sm mt-1">Try loosening the parameters in the Query Builder.</p>
        </div>
      </div>
    );
  }

  // Grid template: Checkbox(40px), Rank(40px), Company(2fr), Price(1fr), MC(1.5fr), PE(1fr), PB(1fr), ROE(1fr), ROCE(1fr), D/E(1fr), Div(1fr), SalesGr(1fr)
  const gridTemplate = "40px 40px minmax(180px, 2fr) minmax(100px, 1fr) minmax(130px, 1.5fr) minmax(80px, 1fr) minmax(80px, 1fr) minmax(90px, 1fr) minmax(90px, 1fr) minmax(100px, 1fr) minmax(100px, 1fr) minmax(100px, 1fr)";

  return (
    <div className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm flex flex-col overflow-hidden">
      
      {/* Header */}
      <div 
        className="grid border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/80 backdrop-blur-sm sticky top-0 z-10"
        style={{ gridTemplateColumns: gridTemplate }}
      >
        <div className="px-3 py-3 flex items-center justify-center">
          <input 
            type="checkbox" 
            className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
            checked={results.length > 0 && selectedSymbols.length === results.length}
            onChange={toggleAll}
          />
        </div>
        <div className="px-1 py-3 text-[11px] font-bold tracking-wider text-slate-500 dark:text-slate-400 uppercase flex items-center justify-center" title="Rank">
          #
        </div>
        {[
          { id: "symbol", label: "Company", align: "left" },
          { id: "current_price", label: "Price", align: "right" },
          { id: "market_cap", label: "Market Cap", align: "right" },
          { id: "pe_ttm", label: "P/E", align: "right" },
          { id: "pb", label: "P/B", align: "right" },
          { id: "roe", label: "ROE", align: "right" },
          { id: "roce", label: "ROCE", align: "right", missing: true },
          { id: "debt_equity", label: "Debt/Eq", align: "right" },
          { id: "dividend_yield", label: "Div Yield", align: "right" },
          { id: "sales_growth_5y", label: "5Y Sales", align: "right", missing: true }
        ].map(col => (
          <div 
            key={col.id} 
            className={`px-3 py-3 text-[11px] font-bold tracking-wider text-slate-500 dark:text-slate-400 uppercase flex items-center gap-1 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors ${col.align === 'right' ? 'justify-end' : ''}`}
            title={col.missing ? "Data unavailable from current source (Yahoo Finance)" : `Sort by ${col.label}`}
          >
            {col.label}
            {col.missing && <HelpCircle className="w-3 h-3 text-amber-500" />}
          </div>
        ))}
      </div>

      {/* Body */}
      <div ref={parentRef} className="flex-1 overflow-auto relative custom-scrollbar">
        <div style={{ height: `${virtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const item = results[virtualItem.index];
            const m = item.metrics;
            const isSelected = selectedSymbols.includes(item.symbol);
            
            return (
              <div
                key={virtualItem.key}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${virtualItem.size}px`,
                  transform: `translateY(${virtualItem.start}px)`,
                }}
                className={`grid px-0 border-b transition-colors items-center text-[12.5px] group ${
                  isSelected 
                    ? "bg-blue-50/50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800/50" 
                    : "border-slate-100 dark:border-slate-800/40 hover:bg-slate-50 dark:hover:bg-slate-800/80"
                }`}
              >
                {/* Wrap grid items in a div with the matching template */}
                <div className="w-full h-full grid" style={{ gridTemplateColumns: gridTemplate }}>
                  
                  <div className="px-3 py-2.5 flex items-center justify-center">
                    <input 
                      type="checkbox" 
                      className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                      checked={isSelected}
                      onChange={() => toggleSelection(item.symbol)}
                    />
                  </div>
                  
                  <div className="px-1 py-2.5 flex items-center justify-center text-xs font-medium text-slate-400 dark:text-slate-500">
                    {virtualItem.index + 1}
                  </div>
                  
                  <div className="px-3 py-2.5 font-bold text-blue-600 dark:text-blue-400 truncate flex items-center">
                    <Link href={`/company/${item.symbol}`} className="hover:underline flex items-center gap-2">
                      {item.symbol}
                    </Link>
                  </div>
                  
                  <div className="px-3 py-2.5 text-right font-mono text-slate-800 dark:text-slate-200">
                    {m.current_price ? `₹${m.current_price.toFixed(2)}` : <span className="text-slate-300 dark:text-slate-700/50 cursor-help" title="Awaiting verified XBRL filing data">—</span>}
                  </div>
                  
                  <div className="px-3 py-2.5 text-right font-mono text-slate-900 dark:text-white font-medium">
                    {formatNumber(m.market_cap, 'currency')}
                  </div>
                  
                  <div className="px-3 py-2.5 text-right font-mono text-slate-700 dark:text-slate-300">
                    {formatNumber(m.pe_ttm)}
                  </div>
                  
                  <div className="px-3 py-2.5 text-right font-mono text-slate-500 dark:text-slate-400">
                    {formatNumber(m.pb)}
                  </div>
                  
                  <div className={`px-3 py-2.5 text-right font-mono ${getMetricColor('roe', m.roe)}`}>
                    {formatNumber(m.roe, 'percent')}
                  </div>
                  
                  <div className="px-3 py-2.5 text-right font-mono text-slate-400 dark:text-slate-600">
                    {formatNumber(m.roce, 'percent')}
                  </div>
                  
                  <div className={`px-3 py-2.5 text-right font-mono ${getMetricColor('debt_equity', m.debt_equity)}`}>
                    {formatNumber(m.debt_equity)}
                  </div>
                  
                  <div className="px-3 py-2.5 text-right font-mono text-slate-600 dark:text-slate-400">
                    {formatNumber(m.dividend_yield, 'percent')}
                  </div>
                  
                  <div className="px-3 py-2.5 text-right font-mono text-slate-400 dark:text-slate-600 pr-4">
                    {formatNumber(m.sales_growth_5y, 'percent')}
                  </div>
                  
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
