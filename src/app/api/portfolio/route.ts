import { NextRequest, NextResponse } from "next/server";
import { AuthRequiredError, requireAuth } from "@/lib/server-auth";
import { getServerPool } from "@/lib/server-db";
import { marketDataService } from "@/lib/tradingview";

export const dynamic = "force-dynamic";

export interface HoldingRecord {
  id: string;
  firebase_uid: string;
  symbol: string;
  company_name: string;
  exchange: string;
  sector: string;
  shares: number;
  buy_price: number;
  buy_date: string;
  notes?: string;
  created_at?: string;
  updated_at?: string;
}

let tableInitialized = false;
async function ensurePortfolioTable(pool: any) {
  if (tableInitialized) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_portfolio_holdings (
      id VARCHAR(64) PRIMARY KEY,
      firebase_uid TEXT NOT NULL,
      symbol VARCHAR(32) NOT NULL,
      company_name VARCHAR(128) NOT NULL,
      exchange VARCHAR(16) DEFAULT 'NSE',
      sector VARCHAR(64) DEFAULT 'General',
      shares NUMERIC(15, 4) NOT NULL CHECK (shares > 0),
      buy_price NUMERIC(15, 2) NOT NULL CHECK (buy_price >= 0),
      buy_date VARCHAR(32) NOT NULL,
      notes TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_uph_uid ON user_portfolio_holdings(firebase_uid);
  `);
  tableInitialized = true;
}

function resolveStockQuote(symbol: string, exchange = "NSE") {
  const cleanSym = symbol.toUpperCase().trim().replace(/[^A-Z0-9]/g, "");
  const normalizedExchange = exchange.toUpperCase() === "BSE" ? "BSE" : "NSE";

  try {
    const cached = marketDataService.getLatest(`${normalizedExchange}:${cleanSym}`);
    if (cached && cached.ltp > 0) {
      const prev = cached.ltp - cached.change;
      return {
        price: cached.ltp,
        pChange: cached.pChange,
        change: cached.change,
        previousClose: prev > 0 ? prev : cached.ltp,
      };
    }
  } catch {
    // ignore
  }

  return {
    price: 0,
    pChange: 0,
    change: 0,
    previousClose: 0,
  };
}

export async function GET(request: NextRequest) {
  let uid = "";
  try {
    const auth = await requireAuth(request);
    uid = auth.uid;
  } catch {
    // guest or unauthenticated
  }

  if (!uid) {
    return NextResponse.json({
      ok: true,
      authenticated: false,
      holdings: [],
      message: "Client should use local storage state for guest mode.",
    });
  }

  try {
    const pool = getServerPool();
    await ensurePortfolioTable(pool);

    const result = await pool.query(
      "SELECT * FROM user_portfolio_holdings WHERE firebase_uid = $1 ORDER BY created_at DESC",
      [uid]
    );

    const enrichedHoldings = result.rows.map((row: any) => {
      const quote = resolveStockQuote(row.symbol, row.exchange);
      const shares = parseFloat(row.shares);
      const buyPrice = parseFloat(row.buy_price);
      const currentPrice = quote.price;
      const investedValue = shares * buyPrice;
      const currentValue = shares * currentPrice;
      const totalPnL = currentValue - investedValue;
      const totalPnLPercent = investedValue > 0 ? (totalPnL / investedValue) * 100 : 0;
      const dayGain = shares * quote.change;
      const dayGainPercent = quote.pChange;

      return {
        id: row.id,
        symbol: row.symbol,
        companyName: row.company_name,
        exchange: row.exchange || "NSE",
        sector: row.sector || "General",
        shares,
        buyPrice,
        buyDate: row.buy_date,
        notes: row.notes || "",
        currentPrice,
        previousClose: quote.previousClose,
        dayChange: quote.change,
        dayChangePercent: quote.pChange,
        investedValue,
        currentValue,
        totalPnL,
        totalPnLPercent,
        dayGain,
        dayGainPercent,
      };
    });

    const totalInvested = enrichedHoldings.reduce((sum: number, h: any) => sum + h.investedValue, 0);
    const totalCurrentValue = enrichedHoldings.reduce((sum: number, h: any) => sum + h.currentValue, 0);
    const totalPnL = totalCurrentValue - totalInvested;
    const totalPnLPercent = totalInvested > 0 ? (totalPnL / totalInvested) * 100 : 0;
    const totalDayGain = enrichedHoldings.reduce((sum: number, h: any) => sum + h.dayGain, 0);
    const previousPortfolioValue = totalCurrentValue - totalDayGain;
    const totalDayGainPercent = previousPortfolioValue > 0 ? (totalDayGain / previousPortfolioValue) * 100 : 0;

    return NextResponse.json({
      ok: true,
      authenticated: true,
      holdings: enrichedHoldings,
      summary: {
        totalInvested,
        totalCurrentValue,
        totalPnL,
        totalPnLPercent,
        totalDayGain,
        totalDayGainPercent,
        holdingsCount: enrichedHoldings.length,
      },
    });
  } catch (error: any) {
    console.error("[portfolio-get] Database error:", error);
    return NextResponse.json(
      { ok: false, error: error.message || "Failed to fetch portfolio" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  let uid = "";
  try {
    const auth = await requireAuth(request);
    uid = auth.uid;
  } catch (err) {
    if (err instanceof AuthRequiredError) {
      return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });
    }
  }

  try {
    const body = await request.json();

    // Support batch holdings sync
    if (Array.isArray(body.holdings)) {
      const pool = getServerPool();
      await ensurePortfolioTable(pool);

      await pool.query("BEGIN");
      await pool.query("DELETE FROM user_portfolio_holdings WHERE firebase_uid = $1", [uid]);

      for (const h of body.holdings) {
        if (!h.symbol || !h.shares || !h.buyPrice) continue;
        const cleanSymbol = String(h.symbol).toUpperCase().trim();
        const cleanShares = parseFloat(h.shares);
        const cleanBuyPrice = parseFloat(h.buyPrice);
        if (isNaN(cleanShares) || cleanShares <= 0 || isNaN(cleanBuyPrice) || cleanBuyPrice < 0) continue;

        const cleanName = h.companyName || cleanSymbol;
        const cleanSector = h.sector || "General";
        const cleanDate = h.buyDate || new Date().toISOString().split("T")[0];
        const holdingId = h.id || `hld_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

        await pool.query(
          `INSERT INTO user_portfolio_holdings
            (id, firebase_uid, symbol, company_name, exchange, sector, shares, buy_price, buy_date, notes)
          VALUES
            ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [holdingId, uid, cleanSymbol, cleanName, h.exchange || "NSE", cleanSector, cleanShares, cleanBuyPrice, cleanDate, h.notes || ""]
        );
      }

      await pool.query("COMMIT");
      return NextResponse.json({ ok: true, count: body.holdings.length });
    }

    const { symbol, companyName, shares, buyPrice, buyDate, exchange, sector, notes } = body;

    if (!symbol || !shares || !buyPrice) {
      return NextResponse.json(
        { ok: false, error: "Symbol, shares, and buy price are required." },
        { status: 400 }
      );
    }

    const cleanSymbol = symbol.toUpperCase().trim();
    const cleanShares = parseFloat(shares);
    const cleanBuyPrice = parseFloat(buyPrice);
    if (isNaN(cleanShares) || cleanShares <= 0 || isNaN(cleanBuyPrice) || cleanBuyPrice < 0) {
      return NextResponse.json(
        { ok: false, error: "Invalid shares or buy price." },
        { status: 400 }
      );
    }

    const cleanName = companyName || cleanSymbol;
    const cleanSector = sector || "General";
    const cleanDate = buyDate || new Date().toISOString().split("T")[0];
    const holdingId = body.id || `hld_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    const pool = getServerPool();
    await ensurePortfolioTable(pool);

    const query = `
      INSERT INTO user_portfolio_holdings
        (id, firebase_uid, symbol, company_name, exchange, sector, shares, buy_price, buy_date, notes)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (id) DO UPDATE SET
        shares = EXCLUDED.shares,
        buy_price = EXCLUDED.buy_price,
        buy_date = EXCLUDED.buy_date,
        notes = EXCLUDED.notes,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;

    const res = await pool.query(query, [
      holdingId,
      uid,
      cleanSymbol,
      cleanName,
      exchange || "NSE",
      cleanSector,
      cleanShares,
      cleanBuyPrice,
      cleanDate,
      notes || "",
    ]);

    return NextResponse.json({
      ok: true,
      holding: res.rows[0],
    });
  } catch (error: any) {
    console.error("[portfolio-post] Database error:", error);
    return NextResponse.json(
      { ok: false, error: error.message || "Failed to save holding" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  let uid = "";
  try {
    const auth = await requireAuth(request);
    uid = auth.uid;
  } catch (err) {
    if (err instanceof AuthRequiredError) {
      return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });
    }
  }

  try {
    const body = await request.json();
    const { id, shares, buyPrice, buyDate, notes } = body;

    if (!id) {
      return NextResponse.json({ ok: false, error: "Holding id is required" }, { status: 400 });
    }

    const pool = getServerPool();
    await ensurePortfolioTable(pool);

    const query = `
      UPDATE user_portfolio_holdings
      SET
        shares = COALESCE($1, shares),
        buy_price = COALESCE($2, buy_price),
        buy_date = COALESCE($3, buy_date),
        notes = COALESCE($4, notes),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $5 AND firebase_uid = $6
      RETURNING *
    `;

    const res = await pool.query(query, [
      shares ? parseFloat(shares) : null,
      buyPrice ? parseFloat(buyPrice) : null,
      buyDate || null,
      notes !== undefined ? notes : null,
      id,
      uid,
    ]);

    if (res.rowCount === 0) {
      return NextResponse.json({ ok: false, error: "Holding not found or unauthorized" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, holding: res.rows[0] });
  } catch (error: any) {
    console.error("[portfolio-put] Database error:", error);
    return NextResponse.json(
      { ok: false, error: error.message || "Failed to update holding" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  let uid = "";
  try {
    const auth = await requireAuth(request);
    uid = auth.uid;
  } catch (err) {
    if (err instanceof AuthRequiredError) {
      return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });
    }
  }

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ ok: false, error: "Holding id is required" }, { status: 400 });
    }

    const pool = getServerPool();
    await ensurePortfolioTable(pool);

    const res = await pool.query(
      "DELETE FROM user_portfolio_holdings WHERE id = $1 AND firebase_uid = $2 RETURNING id",
      [id, uid]
    );

    return NextResponse.json({
      ok: true,
      deletedId: id,
      success: res.rowCount !== 0,
    });
  } catch (error: any) {
    console.error("[portfolio-delete] Database error:", error);
    return NextResponse.json(
      { ok: false, error: error.message || "Failed to delete holding" },
      { status: 500 }
    );
  }
}
