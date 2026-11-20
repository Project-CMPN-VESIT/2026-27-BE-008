import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { adminOnly } from "@/lib/admin-session";
import { Agent } from "undici";
import { getSessionShorts } from "@/lib/niftyShortsService";

const VIDEO_ENGINE_URL = process.env.VIDEO_ENGINE_URL || "http://127.0.0.1:8500";

// Video rendering (Remotion) can take 5+ minutes for full-length 2-minute videos.
// Node.js undici default headersTimeout is 300,000ms (5 mins). We extend it to 20 mins.
const videoEngineDispatcher = new Agent({
  headersTimeout: 20 * 60 * 1000,
  bodyTimeout: 20 * 60 * 1000,
  connectTimeout: 60 * 1000,
});

export const dynamic = "force-dynamic";
export const maxDuration = 900; // 15 minutes max route execution

export async function GET(req: NextRequest) {
  const denied = adminOnly(req);
  if (denied) return denied;
  try {
    const { searchParams } = new URL(req.url);
    const symbol = searchParams.get("symbol");
    const date = searchParams.get("date");

    if (!symbol) {
      return NextResponse.json({ success: false, error: "Symbol required" }, { status: 400 });
    }

    const engineUrl = `${VIDEO_ENGINE_URL}/api/video/status/${encodeURIComponent(symbol)}${
      date ? `?date=${encodeURIComponent(date)}` : ""
    }`;
    const res = await fetch(engineUrl);
    if (!res.ok) {
      return NextResponse.json(
        { success: false, error: "Video engine error or offline" },
        { status: res.status }
      );
    }
    const data = await res.json();
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Failed to check video status" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const denied = adminOnly(req);
  if (denied) return denied;
  try {
    const body = await req.json();
    const symbol = (body.symbol || "").trim().toUpperCase();
    const force = Boolean(body.force);
    const voice = body.voice || "en-IN-W";

    if (!symbol) {
      return NextResponse.json(
        { success: false, error: "Stock symbol is required" },
        { status: 400 }
      );
    }

    // 1. Fetch current stock item from NiftyShorts service
    const { stocks, session } = await getSessionShorts();
    const stockItem = stocks.find((s) => s.symbol.toUpperCase() === symbol);

    if (!stockItem) {
      return NextResponse.json(
        { success: false, error: `Stock ${symbol} not found in Nifty 50 constituents` },
        { status: 404 }
      );
    }

    // 2. Call Video Engine backend to render video
    // undici dispatcher prevents 5-minute HeadersTimeoutError during video render
    const response = await fetch(`${VIDEO_ENGINE_URL}/api/video/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stock_data: stockItem,
        script: stockItem.script,
        date: stockItem.trading_date || session.effectiveTradingDate,
        voice,
        force,
      }),
      // @ts-expect-error Node fetch supports dispatcher
      dispatcher: videoEngineDispatcher,
    });

    if (!response.ok) {
      const errText = await response.text();
      return NextResponse.json(
        { success: false, error: `Video Engine response error: ${errText}` },
        { status: response.status }
      );
    }

    const result = await response.json();
    const effectiveDate = stockItem.trading_date || session.effectiveTradingDate;

    // Sync video file, brief json, and images to FinPilot/public for direct native streaming
    try {
      const srcVideo = path.join(process.cwd(), "video-engine", "frontend", "public", "videos", "nifty-shorts", effectiveDate, `${symbol}.mp4`);
      const destVideo = path.join(process.cwd(), "public", "videos", "nifty-shorts", effectiveDate, `${symbol}.mp4`);
      if (fs.existsSync(srcVideo)) {
        fs.mkdirSync(path.dirname(destVideo), { recursive: true });
        fs.copyFileSync(srcVideo, destVideo);
      }

      const srcBrief = path.join(process.cwd(), "video-engine", "frontend", "public", "videos", "nifty-shorts", effectiveDate, `${symbol}_brief.json`);
      const destBrief = path.join(process.cwd(), "public", "videos", "nifty-shorts", effectiveDate, `${symbol}_brief.json`);
      if (fs.existsSync(srcBrief)) {
        fs.mkdirSync(path.dirname(destBrief), { recursive: true });
        fs.copyFileSync(srcBrief, destBrief);
      }

      // Sync scene images if present
      const srcImagesDir = path.join(process.cwd(), "video-engine", "frontend", "public", "images", "nifty-shorts", effectiveDate, symbol);
      const destImagesDir = path.join(process.cwd(), "public", "images", "nifty-shorts", effectiveDate, symbol);
      if (fs.existsSync(srcImagesDir)) {
        fs.mkdirSync(destImagesDir, { recursive: true });
        const imgFiles = fs.readdirSync(srcImagesDir);
        for (const f of imgFiles) {
          fs.copyFileSync(path.join(srcImagesDir, f), path.join(destImagesDir, f));
        }
      }
    } catch (e) {
      console.warn("[API video POST] Could not sync assets to public directory:", e);
    }

    return NextResponse.json({
      success: true,
      data: {
        symbol,
        date: effectiveDate,
        video_url: result.video_url,
        video_brief: result.video_brief,
        cached: result.cached,
      },
    });
  } catch (error: any) {
    console.error("[API nifty-shorts video POST]", error);
    return NextResponse.json(
      { success: false, error: error.message || "Failed to render video" },
      { status: 500 }
    );
  }
}
