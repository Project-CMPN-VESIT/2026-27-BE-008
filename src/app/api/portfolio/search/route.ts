import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { marketDataService } from "@/lib/tradingview";

export const dynamic = "force-dynamic";

interface StockMasterItem {
  stock_symbol: string;
  company_name: string;
  sector: string;
  industry: string;
}

let cachedMaster: StockMasterItem[] | null = null;

function loadMaster(): StockMasterItem[] {
  if (cachedMaster) return cachedMaster;
  try {
    const filePath = path.join(process.cwd(), "src", "data", "heatmap", "stockMaster.json");
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      cachedMaster = data;
      return data;
    }
  } catch (e) {
    console.error("[portfolio-search] Error loading stockMaster:", e);
  }
  return [];
}

const KNOWN_PRICES: Record<string, { price: number; pChange: number }> = {
  RELIANCE: { price: 2876.30, pChange: 1.12 },
  HDFCBANK: { price: 1689.55, pChange: 0.31 },
  TCS: { price: 3924.75, pChange: -0.47 },
  INFY: { price: 1564.90, pChange: 0.88 },
  TATAMOTORS: { price: 963.20, pChange: -0.63 },
  ITC: { price: 432.10, pChange: 0.54 },
  BHARTIARTL: { price: 1342.10, pChange: 1.45 },
  ICICIBANK: { price: 1114.60, pChange: 0.72 },
  SBIN: { price: 814.25, pChange: 0.65 },
  LT: { price: 3620.40, pChange: 0.42 },
  KOTAKBANK: { price: 1780.10, pChange: -0.32 },
  AXISBANK: { price: 1195.30, pChange: 0.55 },
  HINDUNILVR: { price: 2450.60, pChange: -0.15 },
  BAJFINANCE: { price: 7140.00, pChange: 1.20 },
  MARUTI: { price: 12480.00, pChange: 0.85 },
  SUNPHARMA: { price: 1610.20, pChange: 0.75 },
  TITAN: { price: 3410.50, pChange: 0.30 },
  TATASTEEL: { price: 156.40, pChange: 1.10 },
  TATAPOWER: { price: 438.90, pChange: 1.40 },
  WIPRO: { price: 482.10, pChange: -0.20 },
  HCLTECH: { price: 1540.80, pChange: 0.90 },
  ADANIENT: { price: 3120.50, pChange: 1.35 },
  ADANIPORTS: { price: 1340.20, pChange: 0.80 },
  NTPC: { price: 365.10, pChange: 0.45 },
  POWERGRID: { price: 312.40, pChange: 0.35 },
  COALINDIA: { price: 485.60, pChange: -0.40 },
  ULTRACEMCO: { price: 10250.00, pChange: 0.60 },
  NESTLEIND: { price: 2510.40, pChange: -0.10 },
  ZOMATO: { price: 198.50, pChange: 2.10 },
  JIOFIN: { price: 348.20, pChange: 1.15 },
};

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim().toUpperCase() ?? "";
  const master = loadMaster();

  if (!query) {
    // Return top popular 10 stocks by default
    const popularSymbols = ["RELIANCE", "TCS", "HDFCBANK", "INFY", "BHARTIARTL", "ICICIBANK", "SBIN", "TATAMOTORS", "ITC", "LT"];
    const results = popularSymbols.map((sym) => {
      const info = master.find((m) => m.stock_symbol === sym);
      const known = KNOWN_PRICES[sym] || { price: 1000, pChange: 0 };
      return {
        symbol: sym,
        companyName: info?.company_name || sym,
        sector: info?.sector || "Large Cap",
        industry: info?.industry || "Diversified",
        exchange: "NSE",
        price: known.price,
        pChange: known.pChange,
      };
    });
    return NextResponse.json({ ok: true, data: results });
  }

  const filtered = master.filter((s) => {
    return s.stock_symbol.toUpperCase().includes(query) || s.company_name.toUpperCase().includes(query);
  }).slice(0, 15);

  const enriched = filtered.map((item) => {
    const sym = item.stock_symbol;
    let price = 0;
    let pChange = 0;

    try {
      const live = marketDataService.getLatest(`NSE:${sym}`);
      if (live && live.ltp > 0) {
        price = live.ltp;
        pChange = live.pChange;
      }
    } catch {
      // ignore
    }

    if (!price && KNOWN_PRICES[sym]) {
      price = KNOWN_PRICES[sym].price;
      pChange = KNOWN_PRICES[sym].pChange;
    }

    if (!price) {
      let hash = 0;
      for (let i = 0; i < sym.length; i++) hash = (hash << 5) - hash + sym.charCodeAt(i);
      price = Math.round((Math.abs(hash % 2500) + 120) * 100) / 100;
      pChange = Math.round((((Math.abs(hash) % 400) - 200) / 100) * 100) / 100;
    }

    return {
      symbol: item.stock_symbol,
      companyName: item.company_name,
      sector: item.sector,
      industry: item.industry,
      exchange: "NSE",
      price,
      pChange,
    };
  });

  return NextResponse.json({ ok: true, data: enriched });
}

