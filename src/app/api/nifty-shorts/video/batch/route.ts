import { NextRequest, NextResponse } from "next/server";
import { getSessionShorts } from "@/lib/niftyShortsService";

const VIDEO_ENGINE_URL = process.env.VIDEO_ENGINE_URL || "http://127.0.0.1:8500";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const res = await fetch(`${VIDEO_ENGINE_URL}/api/video/batch`);
    if (!res.ok) {
      return NextResponse.json(
        { success: false, error: "Failed to fetch batch video status from engine" },
        { status: res.status }
      );
    }
    const data = await res.json();
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Video engine offline" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const force = Boolean(body?.force);
    const voice = body?.voice || "en-IN-W";

    const { stocks, session } = await getSessionShorts();
    if (!stocks || stocks.length === 0) {
      return NextResponse.json(
        { success: false, error: "No stocks found for the current trading session" },
        { status: 400 }
      );
    }

    const res = await fetch(`${VIDEO_ENGINE_URL}/api/video/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stocks,
        date: session.effectiveTradingDate,
        force,
        voice,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json(
        { success: false, error: `Video Engine error: ${errText}` },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json({
      success: true,
      message: force
        ? "Started forceful batch video generation (rendering all stocks)"
        : "Started batch video generation for Nifty 50 stocks",
      data,
    });
  } catch (error: any) {
    console.error("[API nifty-shorts video batch POST]", error);
    return NextResponse.json(
      { success: false, error: error.message || "Failed to trigger batch video generation" },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    const res = await fetch(`${VIDEO_ENGINE_URL}/api/video/batch`, {
      method: "DELETE",
    });
    const data = await res.json();
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Failed to cancel video batch" },
      { status: 500 }
    );
  }
}
