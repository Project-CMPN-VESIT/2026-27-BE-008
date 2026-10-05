/** GET /api/baskets/stocks/<symbol>/scores -> backend /baskets/stocks/<symbol>/scores */
import { NextRequest } from "next/server";
import { proxyGet } from "../../../_proxy";

export async function GET(req: NextRequest, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await ctx.params;
  return proxyGet(req, `/baskets/stocks/${encodeURIComponent(symbol)}/scores`);
}
