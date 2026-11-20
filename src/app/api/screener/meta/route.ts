/** GET /api/screener/meta -> backend /screener/meta (fields, presets with live counts, sectors, data date) */
import { NextRequest } from "next/server";
import { proxyScreener } from "../_proxy";

export async function GET(req: NextRequest) {
  return proxyScreener(req, "/screener/meta", "GET");
}
