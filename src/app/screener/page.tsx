"use client";

import React, { useState, useEffect } from "react";
import { InsightHeader } from "@/components/screener/InsightHeader";
import { QueryBuilder } from "@/components/screener/QueryBuilder";
import { ResultsTable } from "@/components/screener/ResultsTable";
import { ComparePanel } from "@/components/screener/ComparePanel";
import { useAuth } from "@/lib/auth-context";
import { screenerApiUrl } from "@/lib/screener-api";

type ScreenResult = {
  symbol: string;
  metrics: Record<string, number | null>;
  explanation: any;
};

const DEFAULT_PRESETS = [
  {
    name: "All Stocks",
    ast: { AND: [] },
  },
  {
    name: "Value Plays (P/E < 20)",
    ast: { AND: [{ field: "pe_ttm", op: "<", value: 20 }, { field: "market_cap", op: ">", value: 1000000000 }] },
  },
  {
    name: "Premium Bluechips",
    ast: { AND: [{ field: "market_cap", op: ">", value: 500000000000 }, { field: "pe_ttm", op: ">", value: 20 }] },
  },
  {
    name: "Debt-Free Cash Cows",
    ast: { AND: [{ field: "debt_equity", op: "<", value: 0.5 }, { field: "dividend_yield", op: ">", value: 1 }] },
  },
  {
    name: "High ROE Compounders",
    ast: { AND: [{ field: "roe", op: ">", value: 15 }] },
  },
];

export default function ScreenerPage() {
  const { user } = useAuth();

  const [results, setResults] = useState<ScreenResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedSymbols, setSelectedSymbols] = useState<string[]>([]);
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);

  const [presets, setPresets] = useState<{ name: string; ast: any }[]>(DEFAULT_PRESETS);
  const [activePresetIndex, setActivePresetIndex] = useState<number>(0);
  const [queryAst, setQueryAst] = useState<any>(DEFAULT_PRESETS[0].ast);

  // Fetch saved screens
  useEffect(() => {
    if (!user) return;
    const fetchScreens = async () => {
      try {
        const res = await fetch(screenerApiUrl(`/api/v1/screener/screens?user_id=${user.id}`));
        const data = await res.json();
        if (data.success && data.screens) {
          const userScreens = data.screens.map((s: any) => ({ name: s.name, ast: s.query_ast }));
          setPresets([...DEFAULT_PRESETS, ...userScreens]);
        }
      } catch (err) {
        console.error("Failed to load screens", err);
      }
    };
    fetchScreens();
  }, [user]);

  const handleSaveScreen = async (name: string) => {
    if (!user) {
      alert("You must be logged in to save a screen.");
      return;
    }

    try {
      const res = await fetch(screenerApiUrl("/api/v1/screener/screens"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          query_ast: queryAst,
          user_id: user.id,
        }),
      });
      const data = await res.json();
      if (data.success) {
        const newScreen = { name, ast: queryAst };
        const newPresets = [...presets, newScreen];
        setPresets(newPresets);
        setActivePresetIndex(newPresets.length - 1);
        alert(`Screen "${name}" saved successfully!`);
      } else {
        throw new Error(data.detail || "Failed to save screen");
      }
    } catch (err: any) {
      alert(err.message);
    }
  };

  const runScreen = async () => {
    setIsLoading(true);
    setError("");
    try {
      const res = await fetch(screenerApiUrl("/api/v1/screener/run"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query_ast: queryAst, limit: 100 }),
      });
      if (!res.ok) throw new Error("Failed to fetch screen results");
      const data = await res.json();
      setResults(data.results || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Cohort Analysis
  const getCohortInsights = () => {
    if (!results.length) return null;

    const validPEs = results
      .map((r) => r.metrics?.pe_ttm)
      .filter((pe): pe is number => pe !== null && pe !== undefined && pe > 0)
      .sort((a, b) => a - b);
    const medianPE = validPEs.length > 0 ? validPEs[Math.floor(validPEs.length / 2)] : null;

    const highRoeCount = results.filter((r) => (r.metrics?.roe || 0) > 15).length;
    const undervaluedCount = results.filter(
      (r) => (r.metrics?.pe_ttm || 999) < 20 && (r.metrics?.roe || 0) > 15
    ).length;

    let topPerformer = null;
    const sortedByRoe = [...results]
      .filter((r) => r.metrics?.roe !== null && r.metrics?.roe !== undefined)
      .sort((a, b) => (b.metrics.roe || 0) - (a.metrics.roe || 0));
    if (sortedByRoe.length > 0) {
      topPerformer = { symbol: sortedByRoe[0].symbol.replace(/\.NS$/, ""), roe: sortedByRoe[0].metrics.roe as number };
    }

    return { medianPE, highRoeCount, undervaluedCount, topPerformer };
  };

  const handleFilterHighQuality = () => {
    setQueryAst({
      AND: [{ field: "roe", op: ">", value: 15 }],
    });
    setIsFiltersOpen(true);
  };

  const handleFilterValue = () => {
    setQueryAst({
      AND: [
        { field: "pe_ttm", op: "<", value: 20 },
        { field: "roe", op: ">", value: 15 },
      ],
    });
    setIsFiltersOpen(true);
  };

  // Auto-run on mount or preset switch
  useEffect(() => {
    runScreen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePresetIndex]);

  return (
    <div className="flex flex-col h-[calc(100vh-56px)] p-4 bg-slate-50 dark:bg-slate-950 font-sans overflow-hidden">
      <div className="max-w-[1680px] mx-auto w-full flex flex-col h-full relative">
        <InsightHeader
          resultCount={results.length}
          presets={presets}
          activePresetIndex={activePresetIndex}
          onPresetChange={(idx) => {
            setActivePresetIndex(idx);
            setQueryAst(presets[idx].ast);
          }}
          isLoading={isLoading}
          onRunScreen={runScreen}
          filterCount={queryAst?.AND?.length || 0}
          isFiltersOpen={isFiltersOpen}
          onToggleFilters={() => setIsFiltersOpen((prev) => !prev)}
          insights={getCohortInsights()}
          onFilterHighQuality={handleFilterHighQuality}
          onFilterValue={handleFilterValue}
          onSaveScreen={handleSaveScreen}
        />

        <QueryBuilder
          queryAst={queryAst}
          setQueryAst={setQueryAst}
          isOpen={isFiltersOpen}
          onClose={() => setIsFiltersOpen(false)}
        />

        {error && (
          <div className="p-2.5 mb-2 text-xs text-red-700 bg-red-100 rounded-lg dark:bg-red-900/30 dark:text-red-400 border border-red-200 dark:border-red-800 shrink-0">
            <span className="font-bold">Screening Error:</span> {error}
          </div>
        )}

        <ResultsTable
          results={results}
          isLoading={isLoading}
          selectedSymbols={selectedSymbols}
          onSelectionChange={setSelectedSymbols}
        />

        <ComparePanel selectedSymbols={selectedSymbols} onClear={() => setSelectedSymbols([])} />
      </div>
    </div>
  );
}
