import { Hono } from "hono";
import { suggestIssueStrategyLinks } from "@emther/core/link-suggest";

// docs/2nd_architecture/plan.md フェーズ2.5（高リスク バッチ10）: web/src/app/api/issues/link/suggest/route.ts の移植。
// docs/value_hierarchy_and_flow.md §2 / §6.1。戦略未接続の親 Issue へテーマ/KR リンク案を返す（HITL・未適用）。
export const issuesLinkSuggestRoute = new Hono().post("/", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { issueIds?: string[] };
  const issueIds = Array.isArray(body.issueIds) ? body.issueIds.filter((id): id is string => typeof id === "string" && !!id) : undefined;

  const result = await suggestIssueStrategyLinks({ issueIds });
  return c.json({
    suggestions: result.suggestions,
    targetCount: result.targetCount,
    source: result.source,
    fallbackReason: result.fallbackReason,
  });
});
