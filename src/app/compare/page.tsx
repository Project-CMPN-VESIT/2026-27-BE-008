"use client";

import React, { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, TrendingUp, AlertTriangle, Crown, TrendingDown } from "lucide-react";
import { screenerApiUrl } from "@/lib/screener-api";

type CompanyMetrics = {
  symbol: string;
  metrics: Record<string, number | null>;
};

// Direction: 1 = higher is better, -1 = lower is better, 0 = neutral
const METRIC_DIRECTION: Record<string, number> = {
  current_price: 0,
  market_cap: 0,
  pe_ttm: -1,
  pb: -1,
  dividend_yield: 1,
  roe: 1,
  roce: 1,
  sales_growth_5y: 1,
  profit_growth_5y: 1,
  debt_equity: -1,
  current_ratio: 1,
  interest_coverage: 1,
};

function CompareContent() {
  const searchParams = useSearchParams();
  const symbolsParam = searchParams.get("symbols");
  const symbols = symbolsParam ? symbolsParam.split(",") : [];

  const [data, setData] = useState<CompanyMetrics[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (symbols.length === 0) {
      setIsLoading(false);
      return;
    }

    const fetchCompareData = async () => {
      try {
        const res = await fetch(screenerApiUrl("/api/v1/screener/run"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query_ast: { field: "symbol", op: "IN", value: symbols },
            limit: 10
          })
        });
        const result = await res.json();
        if (result.success) {
          const orderedData = symbols.map(s => result.results.find((r: any) => r.symbol === s)).filter(Boolean);
          setData(orderedData);
        }
      } catch (err) {
        console.error("Failed to fetch compare data", err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchCompareData();
  }, [symbolsParam]);

  const formatValue = (key: string, value: number | null) => {
    if (value === null || value === undefined) return <span className="text-slate-400" title="Awaiting XBRL data">—</span>;
    if (key === "market_cap") return `₹${(value / 10000000).toFixed(1)} Cr`;
    if (["roe", "roce", "dividend_yield", "sales_growth_5y", "profit_growth_5y"].includes(key)) return `${value.toFixed(1)}%`;
    if (key === "current_price") return `₹${value.toFixed(2)}`;
    return value.toFixed(2);
  };

  const getBestWorstIndex = (metricId: string): { bestIdx: number | null; worstIdx: number | null } => {
    const direction = METRIC_DIRECTION[metricId];
    if (direction === 0 || data.length < 2) return { bestIdx: null, worstIdx: null };

    const validEntries = data
      .map((c, idx) => ({ idx, val: c.metrics[metricId] }))
      .filter(e => e.val !== null && e.val !== undefined) as { idx: number; val: number }[];

    if (validEntries.length < 2) return { bestIdx: null, worstIdx: null };

    const sorted = [...validEntries].sort((a, b) => direction === 1 ? b.val - a.val : a.val - b.val);
    return { bestIdx: sorted[0].idx, worstIdx: sorted[sorted.length - 1].idx };
  };

  const metricGroups = [
    {
      group: "Valuation",
      metrics: [
        { id: "current_price", label: "Current Price" },
        { id: "market_cap", label: "Market Cap" },
        { id: "pe_ttm", label: "P/E Ratio (TTM)" },
        { id: "pb", label: "P/B Ratio" },
        { id: "dividend_yield", label: "Dividend Yield" },
      ]
    },
    {
      group: "Profitability & Growth",
      metrics: [
        { id: "roe", label: "Return on Equity (ROE)" },
        { id: "roce", label: "Return on Cap Emp (ROCE)" },
        { id: "sales_growth_5y", label: "5Y Sales Growth" },
        { id: "profit_growth_5y", label: "5Y Profit Growth" },
      ]
    },
    {
      group: "Financial Health",
      metrics: [
        { id: "debt_equity", label: "Debt to Equity" },
        { id: "current_ratio", label: "Current Ratio" },
        { id: "interest_coverage", label: "Interest Coverage" },
      ]
    }
  ];

  const handleExportCSV = () => {
    if (!data.length) return;
    const headers = ["Metric", ...data.map(c => c.symbol)];
    const csvRows = [headers.join(",")];
    metricGroups.forEach(group => {
      csvRows.push([`"${group.group}"`, ...Array(data.length).fill("")].join(","));
      group.metrics.forEach(metric => {
        const rowData = [
          `"${metric.label}"`,
          ...data.map(c => {
            const val = c.metrics[metric.id];
            return val !== null && val !== undefined ? val : "";
          })
        ];
        csvRows.push(rowData.join(","));
      });
    });
    const blob = new Blob([csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `peer_comparison_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen p-8 flex items-center justify-center ml-64 pt-20">
        <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full"></div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="min-h-screen p-8 ml-64 pt-20">
        <Link href="/screener" className="text-blue-500 flex items-center gap-2 hover:underline mb-8">
          <ArrowLeft className="w-4 h-4" /> Back to Screener
        </Link>
        <div className="text-center p-12 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold">No companies selected</h2>
          <p className="text-slate-500 mt-2">Please select companies from the screener to compare.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 pt-20 ml-64">
      <div className="max-w-[1400px] mx-auto space-y-6">
        
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <Link href="/screener" className="text-blue-600 dark:text-blue-400 flex items-center gap-2 hover:underline mb-4 font-medium text-sm">
              <ArrowLeft className="w-4 h-4" /> Back to Screener
            </Link>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-3">
              Peer Comparison <TrendingUp className="w-6 h-6 text-blue-500" />
            </h1>
            <p className="text-slate-500 mt-1">Head-to-head financial matrix for {data.length} selected equities.</p>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-3 px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-xs text-slate-500">
              <span className="flex items-center gap-1"><Crown className="w-3.5 h-3.5 text-emerald-500" /> Best</span>
              <span className="flex items-center gap-1"><TrendingDown className="w-3.5 h-3.5 text-rose-500" /> Worst</span>
            </div>
            <button 
              onClick={handleExportCSV}
              className="px-4 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-sm font-bold shadow-sm hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            >
              Export CSV
            </button>
            <button className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-bold shadow-md transition-colors border border-blue-500">
              Save Comparison
            </button>
          </div>
        </div>

        {/* Matrix Table */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-950/80 border-b border-slate-200 dark:border-slate-800">
                  <th className="py-5 px-6 font-bold text-slate-500 uppercase tracking-wider w-64 border-r border-slate-200 dark:border-slate-800">
                    Key Metrics
                  </th>
                  {data.map(c => (
                    <th key={c.symbol} className="py-5 px-6 text-center border-r border-slate-200 dark:border-slate-800 last:border-0 min-w-[180px]">
                      <Link href={`/company/${c.symbol}`} className="text-lg font-black text-blue-600 dark:text-blue-400 hover:underline block">
                        {c.symbol}
                      </Link>
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1 block">NSE</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {metricGroups.map((group) => (
                  <React.Fragment key={group.group}>
                    <tr className="bg-slate-100/50 dark:bg-slate-800/30 border-b border-slate-200 dark:border-slate-800">
                      <td colSpan={data.length + 1} className="py-3 px-6 font-bold text-slate-900 dark:text-white uppercase tracking-wider text-xs">
                        {group.group}
                      </td>
                    </tr>
                    
                    {group.metrics.map((metric) => {
                      const { bestIdx, worstIdx } = getBestWorstIndex(metric.id);

                      return (
                        <tr key={metric.id} className="border-b border-slate-100 dark:border-slate-800/50 hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors">
                          <td className="py-4 px-6 font-medium text-slate-700 dark:text-slate-300 border-r border-slate-100 dark:border-slate-800">
                            {metric.label}
                          </td>
                          
                          {data.map((c, colIdx) => {
                            const val = c.metrics[metric.id];
                            const isBest = bestIdx === colIdx;
                            const isWorst = worstIdx === colIdx;

                            let cellBg = "";
                            let textClass = "text-slate-900 dark:text-slate-100 font-medium";

                            if (isBest) {
                              cellBg = "bg-emerald-50/60 dark:bg-emerald-950/30";
                              textClass = "text-emerald-700 dark:text-emerald-400 font-bold";
                            } else if (isWorst) {
                              cellBg = "bg-rose-50/60 dark:bg-rose-950/30";
                              textClass = "text-rose-700 dark:text-rose-400 font-semibold";
                            }

                            return (
                              <td
                                key={`${c.symbol}-${metric.id}`}
                                className={`py-4 px-6 text-center border-r border-slate-100 dark:border-slate-800 last:border-0 font-mono text-[13px] ${cellBg} transition-colors`}
                              >
                                <div className="flex items-center justify-center gap-1.5">
                                  {isBest && <Crown className="w-3 h-3 text-emerald-500 shrink-0" />}
                                  {isWorst && <TrendingDown className="w-3 h-3 text-rose-500 shrink-0" />}
                                  <span className={textClass}>
                                    {formatValue(metric.id, val)}
                                  </span>
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ComparePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-900 p-8 text-white">Loading comparison...</div>}>
      <CompareContent />
    </Suspense>
  );
}
