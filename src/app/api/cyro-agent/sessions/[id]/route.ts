import { NextRequest } from "next/server";
import { forward } from "../../_proxy";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return forward(req, `/sessions/${encodeURIComponent(id)}`);
}
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return forward(req, `/sessions/${encodeURIComponent(id)}`);
}
