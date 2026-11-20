import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { adminOnly } from "@/lib/admin-session";
import { getSessionShorts, NiftyStockItem } from "@/lib/niftyShortsService";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = adminOnly(request);
  if (denied) return denied;
  try {
    const { stocks, session } = await getSessionShorts();
    const date = session.effectiveTradingDate;

    // Check disk for existing rendered MP4s and attach video_url
    const publicVideosDir = path.join(process.cwd(), "public", "videos", "nifty-shorts", date);
    const engineVideosDir = path.join(process.cwd(), "video-engine", "frontend", "public", "videos", "nifty-shorts", date);

    if (!fs.existsSync(publicVideosDir)) {
      fs.mkdirSync(publicVideosDir, { recursive: true });
    }

    const enhancedStocks = stocks.map((s) => {
      const sym = s.symbol.toUpperCase();
      const fileName = `${sym}.mp4`;
      const publicPath = path.join(publicVideosDir, fileName);
      const enginePath = path.join(engineVideosDir, fileName);

      let hasVideo = false;

      if (fs.existsSync(publicPath) && fs.statSync(publicPath).size > 1000) {
        hasVideo = true;
      } else if (fs.existsSync(enginePath) && fs.statSync(enginePath).size > 1000) {
        // Sync to public for direct streaming
        try {
          fs.copyFileSync(enginePath, publicPath);
          hasVideo = true;
        } catch {
          hasVideo = true;
        }
      }

      return {
        ...s,
        video_url: hasVideo ? `/videos/nifty-shorts/${date}/${fileName}` : null,
      };
    });

    const readyCount = enhancedStocks.filter((s) => s.status === "ready" && s.script).length;
    const bullishCount = enhancedStocks.filter((s) => s.script?.verdict === "Bullish").length;
    const bearishCount = enhancedStocks.filter((s) => s.script?.verdict === "Bearish").length;
    const neutralCount = enhancedStocks.filter(
      (s) => s.script?.verdict === "Neutral" || s.script?.verdict === "Watchlist"
    ).length;

    return NextResponse.json({
      success: true,
      data: {
        stocks: enhancedStocks,
        total: enhancedStocks.length,
        ready_count: readyCount,
        pending_count: enhancedStocks.length - readyCount,
        market_session: session,
        stats: {
          bullish: bullishCount,
          bearish: bearishCount,
          neutral: neutralCount,
        },
      },
    });
  } catch (error: any) {
    console.error("[API nifty-shorts GET]", error);
    return NextResponse.json(
      { success: false, error: error.message || "Failed to load Nifty Shorts" },
      { status: 500 }
    );
  }
}
