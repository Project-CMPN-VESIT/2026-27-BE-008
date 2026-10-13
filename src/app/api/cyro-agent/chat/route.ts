import { NextRequest } from "next/server";
import { forward } from "../_proxy";

export const dynamic = "force-dynamic";

/** POST /api/cyro-agent/chat  -> streams one conversational turn (SSE) */
export async function POST(req: NextRequest) {
  return forward(req, "", { stream: true });
}
