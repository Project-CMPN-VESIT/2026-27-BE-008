import { NextRequest } from "next/server";
import { forward } from "../_proxy";

export async function GET(req: NextRequest) {
  return forward(req, "/memory");
}
export async function PUT(req: NextRequest) {
  return forward(req, "/memory");
}
export async function DELETE(req: NextRequest) {
  return forward(req, "/memory");
}
