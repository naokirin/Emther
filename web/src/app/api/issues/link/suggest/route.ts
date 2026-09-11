import { NextResponse } from "next/server";
import { suggestIssueStrategyLinks } from "@/lib/link-suggest";

// docs/value_hierarchy_and_flow.md §2 / §6.1。戦略未接続の親 Issue へテーマ/KR リンク案を返す（HITL・未適用）。

type Body = {
  issueIds?: string[];
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Body;
  const issueIds = Array.isArray(body.issueIds)
    ? body.issueIds.filter((id): id is string => typeof id === "string" && !!id)
    : undefined;

  const result = await suggestIssueStrategyLinks({ issueIds });
  return NextResponse.json({
    suggestions: result.suggestions,
    targetCount: result.targetCount,
    source: result.source,
  });
}
