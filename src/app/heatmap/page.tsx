"use client";

import React, { useState, useEffect, useMemo } from "react";
import { StaticIndexProvider } from "@/lib/indexDataProvider";
import { IndexRecord, IndexConstituent } from "@/lib/indexMaster";
import { useHeatmapData } from "@/hooks/useHeatmapData";
import { StockTile } from "@/components/heatmap/StockTile";
import { RefreshCw } from "lucide-react";
import stockMasterData from "@/data/heatmap/stockMaster.json";

const provider = new StaticIndexProvider();

// TradingView uses underscores instead of hyphens or ampersands for Indian symbols
const getTvSymbol = (symbol: string) => `NSE:${symbol.replace(/[-&]/g, '_')}`;

type FilterType = "ALL" | "GAINERS" | "LOSERS";
type SortType = "CHANGE_DESC" | "CHANGE_ASC" | "MCAP_DESC" | "VOL_DESC";

export default function HeatmapPage() {
  const [indices, setIndices] = useState<IndexRecord[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>("Broad Market");
  const [selectedIndex, setSelectedIndex] = useState<string | null>(null);
  const [constituents, setConstituents] = useState<IndexConstituent[]>([]);
  
  // Drill-down / Filters
  const [selectedSector, setSelectedSector] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<FilterType>("ALL");
  const [sortType, setSortType] = useState<SortType>("CHANGE_DESC");
  
  // Streaming state
  const [isLive, setIsLive] = useState<boolean>(true);
  
  // Last update time
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  // Initialize
  useEffect(() => {
    provider.getIndices().then(data => {
      setIndices(data);
      const defaultIndex = data.find(i => i.index_symbol === "Nifty 50");
      if (defaultIndex) {
        setSelectedIndex(defaultIndex.index_id);
      }
    });
  }, []);

  // Fetch constituents when index changes
  useEffect(() => {
    if (selectedIndex) {
      provider.getConstituents(selectedIndex).then(data => {
        setConstituents(data);
        // Reset sector when changing index
        setSelectedSector("ALL");
      });
    } else {
      setConstituents([]);
    }
  }, [selectedIndex]);

  const activeSymbols = useMemo(() => constituents.map(c => getTvSymbol(c.stock_symbol)), [constituents]);
  const { quotes: liveQuotes, refresh, isRefreshing } = useHeatmapData(activeSymbols, isLive);

  // Update timestamp when quotes change
  useEffect(() => {
    if (Object.keys(liveQuotes).length > 0) {
      setLastUpdate(new Date());
    }
  }, [liveQuotes]);

  // Merge static and live data
  const mergedData = useMemo(() => {
    return constituents.map(c => {
      const live = liveQuotes[getTvSymbol(c.stock_symbol)] || null;
      const staticStock = (stockMasterData as any[]).find(s => s.stock_symbol === c.stock_symbol);
      
      // Determine actual market cap (live takes precedence over static if we had it, but tv gives marketCap in packet)
      const mCap = live?.marketCap ?? null;
      
      return {
        ...c,
        live,
        sector: staticStock?.sector || "Unknown",
        companyName: staticStock?.company_name || c.stock_symbol,
        mCap
      };
    });
  }, [constituents, liveQuotes]);

  // Derived Sectors for the current index
  const availableSectors = useMemo(() => {
    const sectors = new Set<string>();
    mergedData.forEach(d => sectors.add(d.sector));
    return Array.from(sectors).sort();
  }, [mergedData]);

  // Filter & Sort
  const displayData = useMemo(() => {
    let result = mergedData;

    // Sector Filter
    if (selectedSector !== "ALL") {
      result = result.filter(d => d.sector === selectedSector);
    }

    // Search
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(d => 
        d.stock_symbol.toLowerCase().includes(q) || 
        d.companyName.toLowerCase().includes(q)
      );
    }

    // Gainers/Losers
    if (filterType === "GAINERS") {
      result = result.filter(d => d.live && d.live.pChange > 0);
    } else if (filterType === "LOSERS") {
      result = result.filter(d => d.live && d.live.pChange < 0);
    }

    // Sort
    result.sort((a, b) => {
      const aChange = a.live?.pChange ?? 0;
      const bChange = b.live?.pChange ?? 0;
      const aMcap = a.mCap ?? 0;
      const bMcap = b.mCap ?? 0;
      const aVol = a.live?.volume ?? 0;
      const bVol = b.live?.volume ?? 0;

      switch (sortType) {
        case "CHANGE_DESC": return bChange - aChange;
        case "CHANGE_ASC": return aChange - bChange;
        case "MCAP_DESC": return bMcap - aMcap;
        case "VOL_DESC": return bVol - aVol;
        default: return 0;
      }
    });

    return result;
  }, [mergedData, selectedSector, searchQuery, filterType, sortType]);

  const totalWeight = displayData.reduce((sum, d) => sum + (d.index_weight || 0), 0);
  const totalMarketCap = displayData.reduce((sum, d) => sum + (d.mCap || 0), 0);

  const categories = ["Broad Market", "Sectoral", "Thematic", "Strategy"];

  return (
    <div className="flex flex-col h-[calc(100vh-123px)] bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white p-4 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 m-2 shadow-sm">
      {/* HEADER */}
      <header className="mb-4">
        <h1 className="text-2xl font-bold mb-2">Market Heatmap</h1>
        
        <div className="flex flex-wrap gap-4 items-center bg-white dark:bg-slate-900 p-3 rounded shadow-sm border border-slate-200 dark:border-slate-800">
          <div className="flex gap-2">
            {categories.map(cat => (
              <button
                key={cat}
                className={`px-3 py-1 rounded text-sm font-medium transition-colors ${selectedCategory === cat ? 'bg-blue-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'}`}
                onClick={() => {
                  setSelectedCategory(cat);
                  const firstInCat = indices.find(i => i.category === cat);
                  if (firstInCat) setSelectedIndex(firstInCat.index_id);
                }}
              >
                {cat}
              </button>
            ))}
          </div>

          <select
            className="bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-white px-3 py-1 rounded border border-slate-300 dark:border-slate-700 font-medium"
            value={selectedIndex || ""}
            onChange={(e) => setSelectedIndex(e.target.value)}
          >
            {indices.filter(i => i.category === selectedCategory).map(idx => (
              <option key={idx.index_id} value={idx.index_id}>{idx.index_symbol}</option>
            ))}
          </select>

          <div className="flex items-center gap-4 ml-auto">
            {/* Controls */}
            <div className="flex items-center gap-3 border-r border-slate-300 dark:border-slate-700 pr-4">
              <button
                onClick={() => refresh(true)}
                className="px-2.5 py-1.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors flex items-center justify-center gap-1.5"
                title="Refresh snapshot immediately"
                disabled={isRefreshing}
              >
                <RefreshCw size={14} className={`${isRefreshing ? 'animate-spin text-blue-500' : ''}`} />
                <span className="text-xs font-medium">Refresh</span>
              </button>
              
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Stream</span>
                <button
                  onClick={() => setIsLive(!isLive)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${isLive ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`}
                  title="Toggle Live Streaming"
                >
                  <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${isLive ? 'translate-x-4.5' : 'translate-x-1'}`} />
                </button>
              </div>
            </div>

            {/* Status indicator */}
            <div className="flex flex-col items-end">
              <span className={`flex items-center text-sm font-semibold ${isLive ? 'text-emerald-500' : 'text-slate-500'}`}>
                {isLive && <span className="w-2 h-2 rounded-full bg-emerald-500 mr-2 animate-pulse"></span>}
                {!isLive && <span className="w-2 h-2 rounded-full bg-slate-500 mr-2"></span>}
                {isLive ? 'LIVE' : 'PAUSED'}
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                Last updated: {lastUpdate ? lastUpdate.toLocaleTimeString() : "--:--:--"}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* CONTROLS */}
      <div className="flex flex-wrap gap-3 items-center mb-4 text-sm bg-white dark:bg-slate-900 p-3 rounded shadow-sm border border-slate-200 dark:border-slate-800">
        <select 
          className="bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-white border border-slate-300 dark:border-slate-700 rounded px-2 py-1"
          value={selectedSector}
          onChange={e => setSelectedSector(e.target.value)}
        >
          <option value="ALL">All Sectors</option>
          {availableSectors.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        <input 
          type="text" 
          placeholder="Search stock..." 
          className="bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-white border border-slate-300 dark:border-slate-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
        />

        <div className="flex gap-1 ml-4 border-l border-slate-300 dark:border-slate-700 pl-4">
          <button className={`px-2 py-1 rounded font-medium ${filterType === 'ALL' ? 'bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}`} onClick={() => setFilterType('ALL')}>All Stocks</button>
          <button className={`px-2 py-1 rounded font-medium ${filterType === 'GAINERS' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}`} onClick={() => setFilterType('GAINERS')}>Gainers</button>
          <button className={`px-2 py-1 rounded font-medium ${filterType === 'LOSERS' ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-400' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}`} onClick={() => setFilterType('LOSERS')}>Losers</button>
        </div>

        <div className="flex items-center gap-2 ml-4 border-l border-slate-300 dark:border-slate-700 pl-4">
          <span className="text-slate-600 dark:text-slate-400 font-medium">Sort:</span>
          <select 
            className="bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-white border border-slate-300 dark:border-slate-700 rounded px-2 py-1"
            value={sortType}
            onChange={e => setSortType(e.target.value as SortType)}
          >
            <option value="CHANGE_DESC">% Change (High-Low)</option>
            <option value="CHANGE_ASC">% Change (Low-High)</option>
            <option value="MCAP_DESC">Market Cap</option>
            <option value="VOL_DESC">Volume</option>
          </select>
        </div>

        <button 
          className="ml-auto text-blue-500 dark:text-blue-400 hover:text-blue-600 dark:hover:text-blue-300 underline text-xs font-medium"
          onClick={() => {
            setSelectedSector("ALL");
            setSearchQuery("");
            setFilterType("ALL");
            setSortType("CHANGE_DESC");
          }}
        >
          Reset Filters
        </button>
      </div>

      {/* HEATMAP AREA */}
      <div className="flex-1 overflow-auto bg-slate-50 dark:bg-slate-950 pr-2 pb-4">
        {displayData.length === 0 ? (
          <div className="flex items-center justify-center h-full text-slate-500 dark:text-slate-400">
             Constituent data unavailable or no stocks match filters.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-1 content-start">
            {displayData.map((d) => {
              return (
                <StockTile
                  key={d.stock_symbol}
                  symbol={d.stock_symbol}
                  companyName={d.companyName}
                  quote={d.live}
                  weight={d.index_weight}
                  marketCap={d.mCap}
                  totalMarketCap={totalMarketCap}
                  totalWeight={totalWeight}
                />
              );
            })}
          </div>
        )}
      </div>
      
      {/* LEGEND */}
      <div className="mt-4 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 justify-end">
        <span className="font-medium">Legend:</span>
        <div className="w-4 h-4 bg-rose-600 rounded"></div> <span>-3%+</span>
        <div className="w-4 h-4 bg-slate-300 dark:bg-slate-700 rounded"></div> <span>Neutral</span>
        <div className="w-4 h-4 bg-emerald-600 rounded"></div> <span>+3%+</span>
      </div>
    </div>
  );
}
