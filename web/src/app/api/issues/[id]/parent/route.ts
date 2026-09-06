import { NextResponse } from "next/server";
import { createParentIssue } from "@/lib/issue-store";

// 既存Issueの上位に新しいIssueを作り、既存Issueをその子として付け替える（ズームアウト）。
export async function POST(request: Request, ctx: RouteContext<"/api/issues/[id]/parent">) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title.trim() : "";

  if (!title) {
    return NextResponse.json({ error: "titleは必須です" }, { status: 400 });
  }

  try {
    const parent = createParentIssue(id, title, {
      why: typeof body?.why === "string" ? body.why : undefined,
      what: typeof body?.what === "string" ? body.what : undefined,
      how: typeof body?.how === "string" ? body.how : undefined,
    });
    return NextResponse.json({ issue: parent }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
