import { NextResponse } from "next/server";
import { suggestThemeOkrLinks } from "@/lib/link-suggest";

// docs/value_hierarchy_and_flow.md §2 / §6.1。OKR未リンクの採用テーマへ Objective/KR リンク案を返す（HITL・未適用）。

type Body = {
  themeIds?: string[];
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Body;
  const themeIds = Array.isArray(body.themeIds)
    ? body.themeIds.filter((id): id is string => typeof id === "string" && !!id)
    : undefined;

  const result = await suggestThemeOkrLinks({ themeIds });
  return NextResponse.json({
    suggestions: result.suggestions,
    targetCount: result.targetCount,
    source: result.source,
  });
}
