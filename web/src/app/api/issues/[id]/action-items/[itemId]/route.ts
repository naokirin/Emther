import { NextResponse } from "next/server";
import { setActionItemAsNext, toggleActionItem, toIssueView } from "@/lib/issue-store";

export async function PATCH(request: Request, ctx: RouteContext<"/api/issues/[id]/action-items/[itemId]">) {
  const { id, itemId } = await ctx.params;
  const body = await request.json().catch(() => null);

  // asNext: true のときはトグルせず「次の一手」へ繰り上げる。
  if (body?.asNext === true) {
    const issue = setActionItemAsNext(id, itemId);
    if (!issue) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ issue: toIssueView(issue) });
  }

  const issue = toggleActionItem(id, itemId);
  if (!issue) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ issue: toIssueView(issue) });
}
