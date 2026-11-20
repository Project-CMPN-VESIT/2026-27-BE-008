/** POST /api/screener/run -> backend /screener/run  { conditions, search, sort_by, sort_desc, limit, offset, symbols } */
import { NextRequest } from "next/server";
import { proxyScreener } from "../_proxy";

export async function POST(req: NextRequest) {
  return proxyScreener(req, "/screener/run", "POST");
}
