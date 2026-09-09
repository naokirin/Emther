import { NextResponse } from "next/server";
import { promoteActionItemToChildIssue, toIssueView } from "@/lib/issue-store";
import { jsonFromUnknownError, maskOptionsFromBody } from "@/app/api/name-candidate-response";

// Action Item → 子Issue 昇格。独自の介入物語として切り出すときに使う。
export async function POST(request: Request, ctx: RouteContext<"/api/issues/[id]/action-items/[itemId]/promote">) {
  const { id, itemId } = await ctx.params;
  const body = await request.json().catch(() => null);

  try {
    const result = await promoteActionItemToChildIssue(id, itemId, maskOptionsFromBody(body));
    if (!result) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json(
      { issue: toIssueView(result.parent), child: toIssueView(result.child) },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof Error && err.message.includes("1階層")) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return jsonFromUnknownError(err);
  }
}
