import { NextResponse } from "next/server";
import { getIssue } from "@/lib/issue-store";
import { computeIssueImpact } from "@/lib/vitals";

// docs/memo.md「L. 介入の閉ループ」対応。チーム紐付き済みのIssueに限り、そのチームの
// 介入前後のJournal sentimentを比較して返す。アーカイブ前は「介入開始〜現在」を
// 暫定的な後窓として返す（docs/em_human_story_and_ux.md P2-15「進行中」版）。
export async function GET(_request: Request, ctx: RouteContext<"/api/issues/[id]/impact">) {
  const { id } = await ctx.params;
  const issue = getIssue(id);
  if (!issue) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const impact = computeIssueImpact(issue);
  return NextResponse.json({ impact: impact ?? null });
}
