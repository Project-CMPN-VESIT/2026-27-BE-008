import TradingView from "@mathieuc/tradingview";
import { getMarketSessionInfo } from "@/lib/marketHours";

type SearchResult = {
  id: string;
  exchange: string;
  symbol: string;
  description: string;
  type?: string;
};

type QuotePacket = {
  lp?: number;
  ch?: number;
  chp?: number;
  high_price?: number;
  low_price?: number;
  volume?: number;
  market_cap_basic?: number;
  price_earnings_ttm?: number;
  price_book_fq?: number;
  return_on_equity?: number;
  earnings_per_share_basic_ttm?: number;
  dividend_yield_recent?: number;
  book_value_per_share?: number;
  face_value?: number;
  debt_to_equity?: number;
  total_revenue?: number;
  net_income?: number;
  operating_income?: number;
  total_assets?: number;
  total_liabilities?: number;
};

type ChartPeriod = {
  time: number;
  open: number;
  max: number;
  min: number;
  close: number;
  volume?: number;
};

export type TvStockSummary = {
  marketId: string;
  exchange: string;
  symbol: string;
  companyName: string;
};

export type TvLiveQuote = {
  ltp: number;
  change: number;
  pChange: number;
  dayHigh?: number;
  dayLow?: number;
  volume?: number;
  marketCap?: number;
  peRatio?: number;
  pbRatio?: number;
  roe?: number;
  eps?: number;
  dividendYield?: number;
  bookValue?: number;
  faceValue?: number;
  debtToEquity?: number;
  revenueTtm?: number;
  netProfitTtm?: number;
  operatingProfitTtm?: number;
  totalAssets?: number;
  totalLiabilities?: number;
};

export type TvChartPoint = {
  time: string;
  price: number;
};

export type TvCandle = {
  time: number;
  timeLabel: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

const allowedExchanges = new Set(["NSE", "BSE"]);
const CANDLE_CACHE_TTL_MS = 300000; // 5 minutes cache for daily/historical candles

type CachedEntry<T> = {
  value: T;
  fetchedAt: number;
};

const candleCache = new Map<string, CachedEntry<TvCandle[]>>();

const withTimeout = <T,>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> => {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
};

const normalizeInput = (value: string) => value.trim().toUpperCase();

export async function searchStocks(query: string, limit = 8): Promise<TvStockSummary[]> {
  const normalized = normalizeInput(query);
  if (!normalized) {
    return [];
  }

  const items: SearchResult[] = await TradingView.searchMarketV3(normalized, "stock", 0);

  return items
    .filter((item) => item?.id && item?.symbol && allowedExchanges.has(item.exchange))
    .slice(0, limit)
    .map((item) => ({
      marketId: item.id,
      exchange: item.exchange,
      symbol: item.symbol,
      companyName: item.description,
    }));
}

export async function resolveMarket(input: string): Promise<TvStockSummary | null> {
  const normalized = normalizeInput(input);
  if (!normalized) {
    return null;
  }

  if (normalized.includes(":")) {
    const [exchange, symbol] = normalized.split(":");
    if (!exchange || !symbol) {
      return null;
    }

    return {
      marketId: `${exchange}:${symbol}`,
      exchange,
      symbol,
      companyName: symbol,
    };
  }

  const aliasMap: Record<string, string> = {
    ADANI: "ADANIENT",
    HDFC: "HDFCBANK",
    ICICI: "ICICIBANK",
    ZOMATO: "ETERNAL",
  };

  const lookup = aliasMap[normalized] ?? normalized;
  const results = await searchStocks(lookup, 12);
  if (!results.length) {
    return null;
  }

  const exact = results.find((item) => item.symbol.toUpperCase() === lookup);
  return exact ?? results[0];
}

// =========================================================================
// MARKET DATA SERVICE LAYER
// =========================================================================

export type NormalizedQuote = {
  symbol: string;
  ltp: number;
  change: number;
  pChange: number;
  dayHigh?: number;
  dayLow?: number;
  volume?: number;
  marketCap?: number;
  updatedAt: number;
  // Extras
  peRatio?: number;
  pbRatio?: number;
  roe?: number;
  eps?: number;
  dividendYield?: number;
  bookValue?: number;
  faceValue?: number;
  debtToEquity?: number;
  revenueTtm?: number;
  netProfitTtm?: number;
  operatingProfitTtm?: number;
  totalAssets?: number;
  totalLiabilities?: number;
};

class MarketDataService {
  private client: any = null;
  private quoteSession: any = null;
  private markets = new Map<string, any>();
  private store = new Map<string, NormalizedQuote>();
  private activeSubscriptions = new Set<string>();
  // who asked for each symbol: a symbol is only closed once every owner has released it
  private owners = new Map<string, Set<string>>();
  private readonly MAX_SUBSCRIPTIONS = 800;
  private listeners = new Set<(quote: NormalizedQuote) => void>();
  
  public isConnected = false;
  public lastUpdateTimestamp = 0;
  
  private reconnectTimer: NodeJS.Timeout | null = null;
  private staleCheckTimer: NodeJS.Timeout | null = null;
  private STALE_THRESHOLD_MS = 300000; // 5 minutes (market-aware)
  private isReconnecting = false;
  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 5;

  constructor() {
    this.startStaleCheck();
  }

  public addListener(callback: (quote: NormalizedQuote) => void) {
    this.listeners.add(callback);
  }

  public removeListener(callback: (quote: NormalizedQuote) => void) {
    this.listeners.delete(callback);
  }

  private connect() {
    if (this.client) {
      const oldClient = this.client;
      this.client = null;
      try {
        oldClient.onError(() => {});
        oldClient.onDisconnected(() => {});
        oldClient.end();
      } catch (e) {
        // ignore
      }
    }
    
    const clientInstance = new TradingView.Client();
    this.client = clientInstance;
    this.quoteSession = new clientInstance.Session.Quote({ fields: "all" });
    this.isConnected = true;
    
    // Handle global client errors/disconnects
    clientInstance.onError((...error: any[]) => {
      if (this.client !== clientInstance) return;
      console.error("[MarketDataService] Client error:", error);
      this.scheduleReconnect();
    });

    clientInstance.onDisconnected(() => {
      if (this.client !== clientInstance) return;
      console.warn("[MarketDataService] Client disconnected");
      this.isConnected = false;
      this.scheduleReconnect();
    });

    // Restore active subscriptions on connect
    this.markets.clear();
    const toSubscribe = Array.from(this.activeSubscriptions);
    if (toSubscribe.length > 0) {
      this.subscribe(toSubscribe);
    }
  }

  private scheduleReconnect() {
    if (this.isReconnecting) return;
    if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      console.warn(
        `[MarketDataService] Max reconnect attempts (${this.MAX_RECONNECT_ATTEMPTS}) reached. Connection paused until next active request.`
      );
      this.isConnected = false;
      return;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    this.isConnected = false;
    this.isReconnecting = true;
    this.reconnectAttempts++;

    const delay = Math.min(30000, 5000 * Math.pow(1.5, this.reconnectAttempts - 1));
    this.reconnectTimer = setTimeout(() => {
      this.isReconnecting = false;
      console.log(`[MarketDataService] Reconnecting (attempt ${this.reconnectAttempts})...`);
      this.connect();
    }, delay);
  }

  /**
   * Subscribe to live quotes. `owner` identifies the caller (for example one SSE connection); symbols requested
   * without an owner belong to "shared" and stay for the life of the server. A connection that leaves must not
   * drop symbols other pages are still reading.
   */
  public subscribe(symbols: string[], owner = "shared") {
    if (!this.client || !this.isConnected) {
      this.connect();
    }

    symbols.forEach(symbol => {
      // re-insert so recently used symbols sit at the end of the Set (oldest first when we need to evict)
      this.activeSubscriptions.delete(symbol);
      this.activeSubscriptions.add(symbol);
      const set = this.owners.get(symbol) ?? new Set<string>();
      set.add(owner);
      this.owners.set(symbol, set);

      if (!this.markets.has(symbol) && this.quoteSession) {
        const market = new this.quoteSession.Market(symbol);

        market.onData((packet: QuotePacket) => {
          this.handleData(symbol, packet);
        });

        market.onError((...err: any[]) => {
          console.error(`[MarketDataService] Error on ${symbol}:`, err);
        });

        this.markets.set(symbol, market);
      }
    });

    this.evictIfNeeded();
  }

  public unsubscribe(symbols: string[], owner = "shared") {
    symbols.forEach(symbol => {
      const set = this.owners.get(symbol);
      if (set) {
        set.delete(owner);
        if (set.size > 0) return; // someone else still needs this symbol
        this.owners.delete(symbol);
      }
      this.activeSubscriptions.delete(symbol);
      const market = this.markets.get(symbol);
      if (market) {
        // According to the library, closing the market or removing it
        market.close();
        this.markets.delete(symbol);
      }
    });

    if (this.activeSubscriptions.size === 0) {
      this.cleanup();
    }
  }

  /** Drop the oldest symbols once the cap is passed so unbounded lookups cannot exhaust the feed or memory. */
  private evictIfNeeded() {
    if (this.activeSubscriptions.size <= this.MAX_SUBSCRIPTIONS) return;
    for (const symbol of Array.from(this.activeSubscriptions)) {
      if (this.activeSubscriptions.size <= this.MAX_SUBSCRIPTIONS) break;
      this.owners.delete(symbol);
      this.activeSubscriptions.delete(symbol);
      this.store.delete(symbol);
      const market = this.markets.get(symbol);
      if (market) {
        try { market.close(); } catch { /* already closed */ }
        this.markets.delete(symbol);
      }
    }
  }

  private handleData(symbol: string, packet: QuotePacket) {
    if (packet.lp === undefined && !this.store.has(symbol)) {
      // Ignore initial empty packets if we don't have existing data
      return;
    }

    const now = Date.now();
    this.lastUpdateTimestamp = now;

    const existing = this.store.get(symbol) || {
      symbol,
      ltp: 0,
      change: 0,
      pChange: 0,
      updatedAt: now,
    };

    const updated: NormalizedQuote = {
      symbol,
      ltp: packet.lp ?? existing.ltp,
      change: packet.ch ?? existing.change,
      pChange: packet.chp ?? existing.pChange,
      dayHigh: packet.high_price ?? existing.dayHigh,
      dayLow: packet.low_price ?? existing.dayLow,
      volume: packet.volume ?? existing.volume,
      marketCap: packet.market_cap_basic ?? existing.marketCap,
      updatedAt: now,
      
      peRatio: packet.price_earnings_ttm ?? existing.peRatio,
      pbRatio: packet.price_book_fq ?? existing.pbRatio,
      roe: packet.return_on_equity ?? existing.roe,
      eps: packet.earnings_per_share_basic_ttm ?? existing.eps,
      dividendYield: packet.dividend_yield_recent ?? existing.dividendYield,
      bookValue: packet.book_value_per_share ?? existing.bookValue,
      faceValue: packet.face_value ?? existing.faceValue,
      debtToEquity: packet.debt_to_equity ?? existing.debtToEquity,
      revenueTtm: packet.total_revenue ?? existing.revenueTtm,
      netProfitTtm: packet.net_income ?? existing.netProfitTtm,
      operatingProfitTtm: packet.operating_income ?? existing.operatingProfitTtm,
      totalAssets: packet.total_assets ?? existing.totalAssets,
      totalLiabilities: packet.total_liabilities ?? existing.totalLiabilities,
    };

    this.store.set(symbol, updated);
    this.reconnectAttempts = 0; // Successful receipt resets backoff counter

    // Notify listeners
    this.listeners.forEach(listener => listener(updated));
  }

  public getLatest(symbol: string): NormalizedQuote | undefined {
    return this.store.get(symbol);
  }

  private startStaleCheck() {
    this.staleCheckTimer = setInterval(() => {
      // Check market session status - outside 09:00-15:30 IST Mon-Fri, quotes are static
      const session = getMarketSessionInfo();
      if (!session.isLive) {
        // Market is closed, static quotes are completely expected and valid
        return;
      }

      const now = Date.now();
      let allStale = true;
      let hasData = false;
      
      for (const [, quote] of this.store.entries()) {
        hasData = true;
        if (now - quote.updatedAt <= this.STALE_THRESHOLD_MS) {
          allStale = false;
          break;
        }
      }
      
      // Only during live market hours, if we have active subscriptions and zero updates for 5+ min
      if (this.activeSubscriptions.size > 0 && hasData && allStale && this.isConnected && !this.isReconnecting) {
        console.warn("[MarketDataService] All data is stale during live market session (>5m). Forcing reconnect...");
        this.scheduleReconnect();
      }
    }, 60000); // Check every 60s
  }

  public cleanup() {
    if (this.client) {
      this.client.end();
      this.client = null;
    }
    this.quoteSession = null;
    this.isConnected = false;
    this.markets.clear();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  public shutdown() {
    this.cleanup();
    if (this.staleCheckTimer) {
      clearInterval(this.staleCheckTimer);
      this.staleCheckTimer = null;
    }
  }
}

export const marketDataService = new MarketDataService();

// =========================================================================
// BACKWARDS COMPATIBILITY LAYER
// =========================================================================

export async function getLiveQuote(marketId: string): Promise<TvLiveQuote> {
  const existing = marketDataService.getLatest(marketId);
  // If we already have a valid quote in store, return it immediately
  if (existing && existing.ltp > 0) {
    return existing;
  }

  // Subscribe to get the quote
  marketDataService.subscribe([marketId]);

  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const timeout = 2000;
    
    const checkInterval = setInterval(() => {
      const quote = marketDataService.getLatest(marketId);
      if (quote && quote.ltp > 0) {
        clearInterval(checkInterval);
        resolve(quote);
      } else if (Date.now() - startTime > timeout) {
        clearInterval(checkInterval);
        if (quote && quote.ltp > 0) {
          resolve(quote);
        } else {
          reject(new Error("TradingView quote timeout via MarketDataService"));
        }
      }
    }, 25);
  });
}

const formatPointTime = (unix: number) => {
  return new Date(unix * 1000).toLocaleDateString("en-IN", {
    month: "short",
    day: "2-digit",
  });
};

async function fetchCandleHistory(marketId: string, timeframe = "D", range = 120): Promise<TvCandle[]> {
  const cacheKey = `${marketId}|${timeframe}|${range}`;
  const cached = candleCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CANDLE_CACHE_TTL_MS) {
    return cached.value;
  }

  const client = new TradingView.Client();

  try {
    const periods = await withTimeout<ChartPeriod[]>(
      new Promise((resolve, reject) => {
        client.onError((...error: unknown[]) => {
          reject(new Error(`TradingView client error: ${error.join(" ")}`));
        });

        const chart = new client.Session.Chart();

        chart.setMarket(marketId, {
          timeframe,
          range,
        });

        chart.onUpdate(() => {
          const rows = (chart.periods ?? []) as ChartPeriod[];
          if (!rows.length) {
            return;
          }
          resolve(rows);
        });

        chart.onError((...error: unknown[]) => {
          reject(new Error(`TradingView chart error: ${error.join(" ")}`));
        });
      }),
      9000,
      "TradingView chart timeout"
    );

    const candles = periods
      .filter((row) => {
        return typeof row.time === "number"
          && typeof row.open === "number"
          && typeof row.max === "number"
          && typeof row.min === "number"
          && typeof row.close === "number";
      })
      .map((row) => ({
        time: row.time,
        timeLabel: formatPointTime(row.time),
        open: row.open,
        high: row.max,
        low: row.min,
        close: row.close,
        volume: typeof row.volume === "number" ? row.volume : 0,
      }))
      .sort((a, b) => a.time - b.time);

    candleCache.set(cacheKey, { value: candles, fetchedAt: Date.now() });
    return candles;
  } catch (error) {
    if (cached) {
      return cached.value;
    }
    throw error;
  } finally {
    await client.end();
  }
}

/** The feed occasionally misses its first answer (a cold socket); one retry with a fresh connection fixes almost all of those. */
export async function getCandleHistory(marketId: string, timeframe = "D", range = 120): Promise<TvCandle[]> {
  try {
    return await fetchCandleHistory(marketId, timeframe, range);
  } catch {
    return fetchCandleHistory(marketId, timeframe, range);
  }
}

export async function getChartHistory(marketId: string, range = 40): Promise<TvChartPoint[]> {
  const candles = await getCandleHistory(marketId, "D", range);
  return candles.slice(0, 30).map((row) => ({ time: row.timeLabel, price: row.close }));
}
