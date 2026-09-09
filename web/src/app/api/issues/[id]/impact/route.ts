import { NextResponse } from "next/server";
import { getIssue } from "@/lib/issue-store";
import { computeIssueImpact } from "@/lib/vitals";

// docs/memo.md「L. 介入の閉ループ」対応。チーム紐付き済みのIssueに限り、そのチームの
// 介入前後のJournal sentimentを比較して返す。解決（status=done）前は「介入開始〜現在」を
// 暫定的な後窓として返す（docs/issue_tracker_contract.md §6／P2-15）。
export async function GET(_request: Request, ctx: RouteContext<"/api/issues/[id]/impact">) {
  const { id } = await ctx.params;
  const issue = getIssue(id);
  if (!issue) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const impact = computeIssueImpact(issue);
  return NextResponse.json({ impact: impact ?? null });
}
