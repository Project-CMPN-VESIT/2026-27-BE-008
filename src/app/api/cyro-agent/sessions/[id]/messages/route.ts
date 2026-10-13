import { NextRequest } from "next/server";
import { forward } from "../../../_proxy";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return forward(req, `/sessions/${encodeURIComponent(id)}/messages`);
}
