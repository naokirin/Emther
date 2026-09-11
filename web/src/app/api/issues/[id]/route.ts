import { NextResponse } from "next/server";
import {
  listIssues,
  moveFocusIssue,
  setIssueKeyResult,
  setIssuePriority,
  setIssueStatus,
  setIssueTags,
  setIssueTeam,
  setIssueTitle,
  toIssueView,
  updateIssueCharter,
  type IssuePriority,
  type IssueStatus,
} from "@/lib/issue-store";
import { ISSUE_PRIORITIES, ISSUE_STATUSES } from "@/lib/types";
import { jsonFromUnknownError, maskOptionsFromBody } from "@/app/api/name-candidate-response";
import { listSourceJournalsForIssue, toJournalEntryViews } from "@/lib/journal-store";
import { resolveUniqueByPrefix } from "@/lib/id-resolve";

function resolveIssueForRead(id: string) {
  return resolveUniqueByPrefix(listIssues(), (i) => i.id, id);
}

export async function GET(_request: Request, ctx: RouteContext<"/api/issues/[id]">) {
  const { id } = await ctx.params;
  const resolved = resolveIssueForRead(id);
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
  const issue = resolved.item;
  return NextResponse.json({
    issue: toIssueView(issue),
    sourceJournals: toJournalEntryViews(listSourceJournalsForIssue(issue.id, issue.sourceJournalId)),
  });
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/issues/[id]">) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  const opts = maskOptionsFromBody(body);

  // docs/em_human_story_and_ux.md 改修依頼「Issueのタイトルを変更できるようにする」対応。
  if (typeof body?.title === "string" && !body.title.trim()) {
    return NextResponse.json({ error: "titleは必須です" }, { status: 400 });
  }
  // docs/em_ui_ux_issue.md 4節「ステータス管理の導入」対応。
  if ("status" in (body ?? {}) && !ISSUE_STATUSES.includes(body.status)) {
    return NextResponse.json({ error: "statusの値が不正です" }, { status: 400 });
  }
  if ("priority" in (body ?? {}) && !ISSUE_PRIORITIES.includes(body.priority)) {
    return NextResponse.json({ error: "priorityの値が不正です" }, { status: 400 });
  }
  if ("moveFocus" in (body ?? {}) && body.moveFocus !== "up" && body.moveFocus !== "down") {
    return NextResponse.json({ error: "moveFocusは up または down です" }, { status: 400 });
  }

  try {
    let issue = await updateIssueCharter(
      id,
      {
        why: typeof body?.why === "string" ? body.why : undefined,
        what: typeof body?.what === "string" ? body.what : undefined,
        how: typeof body?.how === "string" ? body.how : undefined,
      },
      opts,
    );
    if (!issue) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    if (typeof body?.title === "string" && body.title.trim()) {
      issue = (await setIssueTitle(id, body.title, opts)) ?? issue;
    }
    if (Array.isArray(body?.tags)) {
      const tags = body.tags.filter((t: unknown): t is string => typeof t === "string");
      issue = setIssueTags(id, tags) ?? issue;
    }
    if ("keyResultId" in (body ?? {})) {
      const keyResultId = typeof body.keyResultId === "string" && body.keyResultId ? body.keyResultId : null;
      issue = setIssueKeyResult(id, keyResultId) ?? issue;
    }
    if ("teamId" in (body ?? {})) {
      const teamId = typeof body.teamId === "string" && body.teamId ? body.teamId : null;
      issue = setIssueTeam(id, teamId) ?? issue;
    }
    if ("status" in (body ?? {})) {
      issue = setIssueStatus(id, body.status as IssueStatus) ?? issue;
    }
    if ("priority" in (body ?? {})) {
      issue = setIssuePriority(id, body.priority as IssuePriority) ?? issue;
    }
    if (body?.moveFocus === "up" || body?.moveFocus === "down") {
      issue = moveFocusIssue(id, body.moveFocus) ?? issue;
    }
    return NextResponse.json({ issue: toIssueView(issue) });
  } catch (err) {
    return jsonFromUnknownError(err);
  }
}
