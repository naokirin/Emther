import { NextResponse } from "next/server";
import { listIssues, rescoreIssueTriage, toIssueView } from "@/lib/issue-store";
import { ISSUE_PRIORITY_META } from "@/lib/types";
import { resolveUniqueByPrefix } from "@/lib/id-resolve";

type Ctx = { params: Promise<{ id: string }> };

// docs/value_hierarchy_and_flow.md §4。Issue 単体の4軸再採点。
// Charter や紐付けを直した直後に、Issue一覧の一括更新を待たず評価を更新できるようにする。

export async function POST(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const resolved = resolveUniqueByPrefix(listIssues(), (i) => i.id, id);
  if (resolved.status === "none") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (resolved.status === "ambiguous") {
    return NextResponse.json(
      {
        error: "ambiguous",
        candidates: resolved.items.map((i) => ({ id: i.id, title: i.title, href: `/issues/${i.id}` })),
      },
      { status: 409 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const applySuggested = body?.applySuggested === true;
  const result = rescoreIssueTriage(resolved.item.id, { applySuggested });
  if (!result) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const suggested = result.issue.triage?.suggestedPriority;
  return NextResponse.json({
    issue: toIssueView(result.issue),
    applied: applySuggested,
    changed: result.changed,
    from: result.from,
    to: result.to,
    fromLabel: result.from ? ISSUE_PRIORITY_META[result.from].label : undefined,
    toLabel: result.to ? ISSUE_PRIORITY_META[result.to].label : undefined,
    suggestedPriority: suggested,
    suggestedLabel: suggested ? ISSUE_PRIORITY_META[suggested].label : undefined,
  });
}
