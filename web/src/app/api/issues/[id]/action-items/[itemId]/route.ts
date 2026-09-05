import { NextResponse } from "next/server";
import { toggleActionItem } from "@/lib/issue-store";

export async function PATCH(_request: Request, ctx: RouteContext<"/api/issues/[id]/action-items/[itemId]">) {
  const { id, itemId } = await ctx.params;
  const issue = toggleActionItem(id, itemId);
  if (!issue) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ issue });
}
