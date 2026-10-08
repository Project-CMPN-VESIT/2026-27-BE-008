import { NextRequest, NextResponse } from "next/server";
import { generateAndSaveSingle } from "@/lib/niftyShortsService";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const symbol = (body.symbol || "").trim().toUpperCase();
    const force = Boolean(body.force);

    if (!symbol) {
      return NextResponse.json(
        { success: false, error: "Stock symbol is required" },
        { status: 400 }
      );
    }

    const item = await generateAndSaveSingle(symbol, { force });

    return NextResponse.json({
      success: true,
      data: item,
    });
  } catch (error: any) {
    console.error("[API nifty-shorts generate]", error);
    return NextResponse.json(
      { success: false, error: error.message || "Failed to generate short script" },
      { status: 500 }
    );
  }
}
