export type ScreenerSnapshot = {
  fundamentals: {
    marketCap: number | null;
    peRatio: number | null;
    pbRatio: number | null;
    roe: number | null;
    eps: number | null;
    dividendYield: number | null;
    bookValue: number | null;
    faceValue: number | null;
    debtToEquity: number | null;
  };
  financials: {
    revenueTtm: number | null;
    netProfitTtm: number | null;
    operatingProfitTtm: number | null;
    totalAssets: number | null;
    totalLiabilities: number | null;
  };
};

type CacheEntry = {
  data: ScreenerSnapshot;
  fetchedAt: number;
};

const SCREENER_CACHE_TTL_MS = 30 * 60 * 1000;
const screenerCache = new Map<string, CacheEntry>();

const defaultSnapshot = (): ScreenerSnapshot => ({
  fundamentals: {
    marketCap: null,
    peRatio: null,
    pbRatio: null,
    roe: null,
    eps: null,
    dividendYield: null,
    bookValue: null,
    faceValue: null,
    debtToEquity: null,
  },
  financials: {
    revenueTtm: null,
    netProfitTtm: null,
    operatingProfitTtm: null,
    totalAssets: null,
    totalLiabilities: null,
  },
});

const normalizeSymbol = (symbol: string) => symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

const toNumber = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const cleaned = value.replace(/,/g, "").trim();
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
};

const stripHtml = (html: string) => {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--([\s\S]*?)-->/g, " ")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\r/g, "")
    .replace(/\t/g, " ")
    .replace(/[ ]{2,}/g, " ");
};

const extractSingle = (text: string, pattern: RegExp): number | null => {
  const match = text.match(pattern);
  return toNumber(match?.[1]);
};

const extractLastNumberFromRow = (text: string, rowLabel: string): number | null => {
  const escaped = rowLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`${escaped}\\s*\\+?\\s*((?:-?\\d[\\d,.]*\\s+){2,40})`, "i");
  const match = text.match(pattern);
  if (!match?.[1]) {
    return null;
  }

  const numbers = match[1].match(/-?\d[\d,]*(?:\.\d+)?/g);
  if (!numbers?.length) {
    return null;
  }

  return toNumber(numbers[numbers.length - 1]);
};

const fetchScreenerPage = async (symbol: string) => {
  const endpoints = [
    `https://www.screener.in/company/${symbol}/consolidated/`,
    `https://www.screener.in/company/${symbol}/`,
  ];

  for (const url of endpoints) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
          Accept: "text/html,application/xhtml+xml",
        },
        signal: controller.signal,
        cache: "no-store",
      });

      if (response.ok) {
        return await response.text();
      }
    } catch {
      // Try next endpoint.
    } finally {
      clearTimeout(timeout);
    }
  }

  return null;
};

export async function getScreenerSnapshot(inputSymbol: string): Promise<ScreenerSnapshot> {
  const symbol = normalizeSymbol(inputSymbol);
  if (!symbol) {
    return defaultSnapshot();
  }

  const cached = screenerCache.get(symbol);
  if (cached && Date.now() - cached.fetchedAt < SCREENER_CACHE_TTL_MS) {
    return cached.data;
  }

  const html = await fetchScreenerPage(symbol);
  if (!html) {
    return defaultSnapshot();
  }

  const text = stripHtml(html);

  const snapshot: ScreenerSnapshot = {
    fundamentals: {
      marketCap: extractSingle(text, /Market\s*Cap\s*₹?\s*([\d,]+(?:\.\d+)?)/i),
      peRatio: extractSingle(text, /Stock\s*P\/E\s*([\d,]+(?:\.\d+)?)/i),
      pbRatio: extractSingle(text, /P\/B\s*Ratio\s*([\d,]+(?:\.\d+)?)/i),
      roe: extractSingle(text, /ROE\s*([\d,]+(?:\.\d+)?)/i),
      eps: extractLastNumberFromRow(text, "EPS in Rs"),
      dividendYield: extractSingle(text, /Dividend\s*Yield\s*([\d,]+(?:\.\d+)?)/i),
      bookValue: extractSingle(text, /Book\s*Value\s*₹?\s*([\d,]+(?:\.\d+)?)/i),
      faceValue: extractSingle(text, /Face\s*Value\s*₹?\s*([\d,]+(?:\.\d+)?)/i),
      debtToEquity: extractSingle(text, /Debt\s*to\s*Equity\s*([\d,]+(?:\.\d+)?)/i),
    },
    financials: {
      revenueTtm: extractLastNumberFromRow(text, "Sales"),
      netProfitTtm: extractLastNumberFromRow(text, "Net Profit"),
      operatingProfitTtm: extractLastNumberFromRow(text, "Operating Profit"),
      totalAssets: extractLastNumberFromRow(text, "Total Assets"),
      totalLiabilities: extractLastNumberFromRow(text, "Total Liabilities"),
    },
  };

  screenerCache.set(symbol, { data: snapshot, fetchedAt: Date.now() });
  return snapshot;
}
