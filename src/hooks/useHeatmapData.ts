"use client";

import { useState, useEffect } from "react";

// Matches NormalizedQuote in tradingview.ts
export type HeatmapQuote = {
  symbol: string;
  ltp: number;
  change: number;
  pChange: number;
  volume?: number;
  marketCap?: number;
  updatedAt: number;
};

let globalQuotesCache: Record<string, HeatmapQuote> = {};

export function useHeatmapData(symbols: string[], isLive: boolean = true) {
  const [quotes, setQuotes] = useState<Record<string, HeatmapQuote>>(globalQuotesCache);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const updateQuotes = (newQuotes: Partial<Record<string, HeatmapQuote>>) => {
    setQuotes(prev => {
      const next = { ...prev, ...newQuotes };
      globalQuotesCache = next; // Keep global cache in sync
      return next;
    });
  };

  const fetchSnapshot = async (manual: boolean = false) => {
    if (symbols.length === 0) return;
    setIsRefreshing(true);
    try {
      const symbolsQuery = symbols.join(",");
      const reqPromise = fetch(`/api/heatmap/snapshot?symbols=${encodeURIComponent(symbolsQuery)}`);
      
      let res;
      if (manual) {
        const delayPromise = new Promise(resolve => setTimeout(resolve, 500));
        [res] = await Promise.all([reqPromise, delayPromise]);
      } else {
        res = await reqPromise;
      }
      
      if (res.ok) {
        const data = await res.json();
        updateQuotes(data);
      }
    } catch (err) {
      console.error("Failed to fetch heatmap snapshot", err);
    } finally {
      setIsRefreshing(false);
    }
  };

  // Instant fetch on mount or symbol change
  useEffect(() => {
    // If we already have some of these symbols in our global cache, they will render instantly.
    // We still fire the background fetch to ensure they are up to date.
    fetchSnapshot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbols.join(",")]);

  useEffect(() => {
    if (symbols.length === 0 || !isLive) {
      return;
    }

    const symbolsQuery = symbols.join(",");
    const eventSource = new EventSource(`/api/heatmap?symbols=${encodeURIComponent(symbolsQuery)}`);

    eventSource.onmessage = (event) => {
      try {
        const quote = JSON.parse(event.data) as HeatmapQuote;
        updateQuotes({ [quote.symbol]: quote });
      } catch (err) {
        console.error("Error parsing SSE data", err);
      }
    };

    eventSource.onerror = (err) => {
      console.error("SSE Error:", err);
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, [symbols.join(","), isLive]);

  return { quotes, refresh: fetchSnapshot, isRefreshing };
}
