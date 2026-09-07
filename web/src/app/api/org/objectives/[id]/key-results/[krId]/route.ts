import { NextResponse } from "next/server";
import { removeKeyResult, toObjectiveView } from "@/lib/org-context-store";

export async function DELETE(_request: Request, ctx: RouteContext<"/api/org/objectives/[id]/key-results/[krId]">) {
  const { id, krId } = await ctx.params;
  const objective = removeKeyResult(id, krId);
  if (!objective) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ objective: toObjectiveView(objective) });
}
