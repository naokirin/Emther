import { NextResponse } from "next/server";
import { getIssue } from "@/lib/issue-store";
import { computeIssueImpact } from "@/lib/vitals";

// docs/memo.md「L. 介入の閉ループ」対応。アーカイブ済み・チーム紐付き済みのIssueに
// 限り、そのチームの介入前後のJournal sentimentを比較して返す。
export async function GET(_request: Request, ctx: RouteContext<"/api/issues/[id]/impact">) {
  const { id } = await ctx.params;
  const issue = getIssue(id);
  if (!issue) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const impact = computeIssueImpact(issue);
  return NextResponse.json({ impact: impact ?? null });
}
