import { NextRequest } from "next/server";
import { forward } from "../_proxy";

export async function GET(req: NextRequest) {
  return forward(req, "/sessions");
}
export async function POST(req: NextRequest) {
  return forward(req, "/sessions");
}
