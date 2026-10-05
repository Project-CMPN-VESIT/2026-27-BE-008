/** GET /api/baskets/stocks/<symbol>/summary?model=buffett -> backend (LLM call, so a longer timeout) */
import { NextRequest } from "next/server";
import { proxyGet } from "../../../_proxy";

export async function GET(req: NextRequest, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await ctx.params;
  return proxyGet(req, `/baskets/stocks/${encodeURIComponent(symbol)}/summary`, 70_000);
}
