import { NextResponse } from "next/server";
import { computeOrgVitals } from "@/lib/vitals";
import { unmaskNames } from "@/lib/people-directory";

// docs/memo.md「D. 評価不能→観測アクション」対応。vitals.tsのmembers/uncoveredMembersは
// 個人情報分離のためPERSON_n IDのまま保持しているので、EM向け応答の境界であるここで
// 実名へ復元する（toRunView/toIssueViewと同じ設計方針）。
export async function GET() {
  const vitals = computeOrgVitals();
  return NextResponse.json({
    teams: vitals.teams.map((t) => ({ ...t, members: t.members.map(unmaskNames) })),
    oneOnOneCoverage: {
      ...vitals.oneOnOneCoverage,
      uncoveredMembers: vitals.oneOnOneCoverage.uncoveredMembers.map(unmaskNames),
    },
  });
}
