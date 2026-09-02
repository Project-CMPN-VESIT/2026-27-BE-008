"use client";

import { useState, useEffect, useRef } from "react";

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

const CACHE_KEY = "finpilot_heatmap_quotes_cache";

// Initialize global cache in memory, hydrated from localStorage if available
let globalQuotesCache: Record<string, HeatmapQuote> = {};

if (typeof window !== "undefined") {
  try {
    const saved = localStorage.getItem(CACHE_KEY);
    if (saved) {
      globalQuotesCache = JSON.parse(saved);
    }
  } catch {
    // Ignore storage errors
  }
}

export function useHeatmapData(symbols: string[], isLive: boolean = true) {
  const [quotes, setQuotes] = useState<Record<string, HeatmapQuote>>(globalQuotesCache);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const bufferRef = useRef<Record<string, HeatmapQuote>>({});
  const flushTimerRef = useRef<NodeJS.Timeout | null>(null);

  const saveCacheDebounced = useRef<NodeJS.Timeout | null>(null);

  const updateQuotesBatch = (newQuotes: Record<string, HeatmapQuote>) => {
    setQuotes((prev) => {
      const next = { ...prev, ...newQuotes };
      globalQuotesCache = next;

      // Debounce saving to localStorage to prevent blocking main thread
      if (typeof window !== "undefined") {
        if (saveCacheDebounced.current) clearTimeout(saveCacheDebounced.current);
        saveCacheDebounced.current = setTimeout(() => {
          try {
            localStorage.setItem(CACHE_KEY, JSON.stringify(globalQuotesCache));
          } catch {
            // Ignore quota errors
          }
        }, 1000);
      }

      return next;
    });
  };

  const fetchSnapshot = async (manual: boolean = false) => {
    if (symbols.length === 0) return;
    setIsRefreshing(true);
    try {
      const symbolsQuery = symbols.join(",");
      const res = await fetch(`/api/heatmap/snapshot?symbols=${encodeURIComponent(symbolsQuery)}`);

      if (res.ok) {
        const data = await res.json();
        if (data && Object.keys(data).length > 0) {
          updateQuotesBatch(data);
        }
      }
    } catch (err) {
      console.error("Failed to fetch heatmap snapshot", err);
    } finally {
      setIsRefreshing(false);
    }
  };

  // Instant fetch on mount or symbol change
  useEffect(() => {
    fetchSnapshot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbols.join(",")]);

  // SSE streaming with batched updates (flushed every 100ms) to prevent UI frame drops
  useEffect(() => {
    if (symbols.length === 0 || !isLive) {
      return;
    }

    const symbolsQuery = symbols.join(",");
    const eventSource = new EventSource(`/api/heatmap?symbols=${encodeURIComponent(symbolsQuery)}`);

    const flushBuffer = () => {
      if (Object.keys(bufferRef.current).length > 0) {
        const batch = { ...bufferRef.current };
        bufferRef.current = {};
        updateQuotesBatch(batch);
      }
      flushTimerRef.current = null;
    };

    eventSource.onmessage = (event) => {
      try {
        const quote = JSON.parse(event.data) as HeatmapQuote;
        bufferRef.current[quote.symbol] = quote;

        if (!flushTimerRef.current) {
          flushTimerRef.current = setTimeout(flushBuffer, 100);
        }
      } catch (err) {
        console.error("Error parsing SSE data", err);
      }
    };

    eventSource.onerror = (err) => {
      console.error("SSE Error:", err);
      eventSource.close();
    };

    return () => {
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      eventSource.close();
    };
  }, [symbols.join(","), isLive]);

  return { quotes, refresh: fetchSnapshot, isRefreshing };
}
