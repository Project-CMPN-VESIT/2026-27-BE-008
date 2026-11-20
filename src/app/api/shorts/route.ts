import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { getSessionShorts, NiftyStockItem } from "@/lib/niftyShortsService";

export const dynamic = "force-dynamic";

export interface RenderedShortItem {
  symbol: string;
  company_name: string;
  sector: string;
  trading_date: string;
  price?: number;
  change_pct?: number;
  video_url: string;
  headline?: string;
  verdict?: "Bullish" | "Bearish" | "Watchlist" | "Neutral";
  duration_seconds?: number;
  brief?: any;
  scenes?: any[];
  script?: any;
  created_at?: string;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const requestedDate = searchParams.get("date");
    const requestedSymbol = searchParams.get("symbol")?.toUpperCase();

    // both values become file-system path segments below: only accept their exact expected shapes
    if (requestedDate && !/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
      return NextResponse.json({ success: false, error: "date must be YYYY-MM-DD" }, { status: 400 });
    }
    if (requestedSymbol && !/^[A-Z0-9&_-]{1,20}$/.test(requestedSymbol)) {
      return NextResponse.json({ success: false, error: "symbol contains unsupported characters" }, { status: 400 });
    }

    const publicBaseDir = path.join(process.cwd(), "public", "videos", "nifty-shorts");
    const engineBaseDir = path.join(process.cwd(), "video-engine", "frontend", "public", "videos", "nifty-shorts");

    // 1. Gather all date directories from both public and video-engine
    const availableDatesSet = new Set<string>();

    if (fs.existsSync(publicBaseDir)) {
      for (const d of fs.readdirSync(publicBaseDir)) {
        if (fs.statSync(path.join(publicBaseDir, d)).isDirectory()) {
          availableDatesSet.add(d);
        }
      }
    }

    if (fs.existsSync(engineBaseDir)) {
      for (const d of fs.readdirSync(engineBaseDir)) {
        if (fs.statSync(path.join(engineBaseDir, d)).isDirectory()) {
          availableDatesSet.add(d);
        }
      }
    }

    const availableDates = Array.from(availableDatesSet).sort().reverse();

    // 2. Load stock metadata from session shorts
    let sessionStocks: NiftyStockItem[] = [];
    let currentSessionDate = "";
    try {
      const res = await getSessionShorts();
      sessionStocks = res.stocks || [];
      currentSessionDate = res.session?.effectiveTradingDate || "";
    } catch (e) {
      console.warn("[API /shorts] Error loading session shorts:", e);
    }

    const stockMap = new Map<string, NiftyStockItem>();
    for (const s of sessionStocks) {
      stockMap.set(s.symbol.toUpperCase(), s);
    }

    // 3. Scan rendered MP4 files across all dates (or selected date)
    const renderedShorts: RenderedShortItem[] = [];

    const datesToScan = requestedDate
      ? [requestedDate]
      : availableDates.length > 0
      ? availableDates
      : currentSessionDate
      ? [currentSessionDate]
      : [];

    for (const dateFolder of datesToScan) {
      const pubFolder = path.join(publicBaseDir, dateFolder);
      const engFolder = path.join(engineBaseDir, dateFolder);

      if (!fs.existsSync(pubFolder) && !fs.existsSync(engFolder)) {
        continue;
      }

      // Collect all candidate symbols that have MP4
      const symbolSet = new Set<string>();

      if (fs.existsSync(pubFolder)) {
        for (const file of fs.readdirSync(pubFolder)) {
          if (file.endsWith(".mp4") && !file.startsWith(".")) {
            symbolSet.add(file.replace(".mp4", "").toUpperCase());
          }
        }
      }

      if (fs.existsSync(engFolder)) {
        for (const file of fs.readdirSync(engFolder)) {
          if (file.endsWith(".mp4") && !file.startsWith(".")) {
            const sym = file.replace(".mp4", "").toUpperCase();
            symbolSet.add(sym);
            // Sync to public if missing
            const destMp4 = path.join(pubFolder, `${sym}.mp4`);
            if (!fs.existsSync(destMp4)) {
              try {
                fs.mkdirSync(pubFolder, { recursive: true });
                fs.copyFileSync(path.join(engFolder, `${sym}.mp4`), destMp4);
              } catch {}
            }
          }
        }
      }

      for (const sym of symbolSet) {
        if (requestedSymbol && sym !== requestedSymbol) {
          continue;
        }

        const mp4Path = path.join(pubFolder, `${sym}.mp4`);
        if (!fs.existsSync(mp4Path) || fs.statSync(mp4Path).size < 1000) {
          continue;
        }

        // Load brief json if present
        let briefData: any = null;
        const pubBrief = path.join(pubFolder, `${sym}_brief.json`);
        const engBrief = path.join(engFolder, `${sym}_brief.json`);

        if (fs.existsSync(pubBrief)) {
          try {
            briefData = JSON.parse(fs.readFileSync(pubBrief, "utf-8"));
          } catch {}
        } else if (fs.existsSync(engBrief)) {
          try {
            briefData = JSON.parse(fs.readFileSync(engBrief, "utf-8"));
            fs.mkdirSync(pubFolder, { recursive: true });
            fs.copyFileSync(engBrief, pubBrief);
          } catch {}
        }

        const stockMeta = stockMap.get(sym);
        const headline =
          briefData?.scenes?.find((sc: any) => sc.type === "intro" || sc.type === "stock")?.headline ||
          stockMeta?.headlines?.[0] ||
          briefData?.title ||
          `${sym} Daily Market Short`;

        let verdict = stockMeta?.script?.verdict;
        if (!verdict && briefData?.scenes) {
          const outro = briefData.scenes.find((sc: any) => sc.type === "outro");
          if (outro?.headline?.includes("BULLISH")) verdict = "Bullish";
          else if (outro?.headline?.includes("BEARISH")) verdict = "Bearish";
          else if (outro?.headline?.includes("WATCHLIST")) verdict = "Watchlist";
          else verdict = "Neutral";
        }

        const duration = briefData?.total_seconds || 30;

        renderedShorts.push({
          symbol: sym,
          company_name: stockMeta?.company_name || briefData?.title?.split(" - ")[0] || sym,
          sector: stockMeta?.sector || "Nifty 50 Constituent",
          trading_date: dateFolder,
          price: stockMeta?.price,
          change_pct: stockMeta?.change_pct,
          video_url: `/videos/nifty-shorts/${dateFolder}/${sym}.mp4`,
          headline,
          verdict: (verdict as any) || "Watchlist",
          duration_seconds: duration,
          brief: briefData,
          scenes: briefData?.scenes || [],
          script: stockMeta?.script,
          created_at: fs.statSync(mp4Path).mtime.toISOString(),
        });
      }
    }

    return NextResponse.json({
      success: true,
      count: renderedShorts.length,
      available_dates: availableDates,
      selected_date: requestedDate || availableDates[0] || currentSessionDate,
      shorts: renderedShorts,
    });
  } catch (error: any) {
    console.error("[API /shorts GET]", error);
    return NextResponse.json(
      { success: false, error: error.message || "Failed to load rendered video shorts" },
      { status: 500 }
    );
  }
}
