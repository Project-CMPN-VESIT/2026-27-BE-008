import { NextRequest, NextResponse } from "next/server";
import { adminOnly } from "@/lib/admin-session";
import {
  runBatchGeneration,
  getBatchProgress,
  cancelBatch,
} from "@/lib/niftyShortsService";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = adminOnly(request);
  if (denied) return denied;
  const progress = getBatchProgress();
  return NextResponse.json({
    success: true,
    data: progress,
  });
}

export async function POST(req: NextRequest) {
  const denied = adminOnly(req);
  if (denied) return denied;
  const progress = getBatchProgress();
  if (progress.isRunning) {
    return NextResponse.json({
      success: true,
      message: "Batch generation is already running",
      data: progress,
    });
  }

  let force = false;
  try {
    const body = await req.json().catch(() => ({}));
    force = Boolean(body?.force);
  } catch {
    force = false;
  }

  // Trigger non-blocking batch generation in background
  runBatchGeneration({ force });

  return NextResponse.json({
    success: true,
    message: force
      ? "Started forceful regeneration (overwriting existing scripts for today)"
      : "Started batch generation for all Nifty 50 stocks",
    data: getBatchProgress(),
  });
}

export async function DELETE(request: NextRequest) {
  const denied = adminOnly(request);
  if (denied) return denied;
  cancelBatch();
  return NextResponse.json({
    success: true,
    message: "Batch generation cancelled",
    data: getBatchProgress(),
  });
}
