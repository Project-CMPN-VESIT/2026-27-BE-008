/** GET /api/baskets/stocks/ranking?model=canslim&cap=small&limit=100 -> backend /baskets/stocks/ranking */
import { NextRequest } from "next/server";
import { proxyGet } from "../../_proxy";

export async function GET(req: NextRequest) {
  return proxyGet(req, "/baskets/stocks/ranking");
}
