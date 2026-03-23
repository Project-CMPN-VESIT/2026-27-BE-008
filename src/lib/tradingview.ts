import TradingView from "@mathieuc/tradingview";

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

const QUOTE_CACHE_TTL_MS = 900;
const CANDLE_CACHE_TTL_MS = 45000;

type CachedEntry<T> = {
  value: T;
  fetchedAt: number;
};

const quoteCache = new Map<string, CachedEntry<TvLiveQuote>>();
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
  };

  const lookup = aliasMap[normalized] ?? normalized;
  const results = await searchStocks(lookup, 12);
  if (!results.length) {
    return null;
  }

  const exact = results.find((item) => item.symbol.toUpperCase() === lookup);
  return exact ?? results[0];
}

export async function getLiveQuote(marketId: string): Promise<TvLiveQuote> {
  const cached = quoteCache.get(marketId);
  if (cached && Date.now() - cached.fetchedAt < QUOTE_CACHE_TTL_MS) {
    return cached.value;
  }

  const client = new TradingView.Client();

  try {
    const quoteData = await withTimeout<QuotePacket>(
      new Promise((resolve, reject) => {
        const quoteSession = new client.Session.Quote({ fields: "all" });
        const market = new quoteSession.Market(marketId);

        market.onData((packet: QuotePacket) => {
          if (typeof packet?.lp === "number") {
            resolve(packet);
          }
        });

        market.onError((...error: unknown[]) => {
          reject(new Error(`TradingView quote error: ${error.join(" ")}`));
        });
      }),
      3500,
      "TradingView quote timeout"
    );

    const quote = {
      ltp: quoteData.lp ?? 0,
      change: quoteData.ch ?? 0,
      pChange: quoteData.chp ?? 0,
      dayHigh: quoteData.high_price,
      dayLow: quoteData.low_price,
      volume: quoteData.volume,
      marketCap: quoteData.market_cap_basic,
      peRatio: quoteData.price_earnings_ttm,
      pbRatio: quoteData.price_book_fq,
      roe: quoteData.return_on_equity,
      eps: quoteData.earnings_per_share_basic_ttm,
      dividendYield: quoteData.dividend_yield_recent,
      bookValue: quoteData.book_value_per_share,
      faceValue: quoteData.face_value,
      debtToEquity: quoteData.debt_to_equity,
      revenueTtm: quoteData.total_revenue,
      netProfitTtm: quoteData.net_income,
      operatingProfitTtm: quoteData.operating_income,
      totalAssets: quoteData.total_assets,
      totalLiabilities: quoteData.total_liabilities,
    };

    quoteCache.set(marketId, { value: quote, fetchedAt: Date.now() });
    return quote;
  } catch (error) {
    if (cached) {
      return cached.value;
    }
    throw error;
  } finally {
    await client.end();
  }
}

const formatPointTime = (unix: number) => {
  return new Date(unix * 1000).toLocaleDateString("en-IN", {
    month: "short",
    day: "2-digit",
  });
};

export async function getCandleHistory(marketId: string, timeframe = "D", range = 120): Promise<TvCandle[]> {
  const cacheKey = `${marketId}|${timeframe}|${range}`;
  const cached = candleCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CANDLE_CACHE_TTL_MS) {
    return cached.value;
  }

  const client = new TradingView.Client();

  try {
    const periods = await withTimeout<ChartPeriod[]>(
      new Promise((resolve, reject) => {
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
      5500,
      "TradingView chart timeout"
    );

    const candles = periods
      .slice(0, 300)
      .reverse()
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
      }));

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

export async function getChartHistory(marketId: string, range = 40): Promise<TvChartPoint[]> {
  const candles = await getCandleHistory(marketId, "D", range);
  return candles.slice(0, 30).map((row) => ({ time: row.timeLabel, price: row.close }));
}
