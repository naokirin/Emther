import { Hono } from "hono";
import { createIssue, listIssues, moveFocusIssue, setIssuePriority, setIssueStatus, setIssueTags, setIssueTeam, setIssueTheme, setIssueTitle, toIssueView, updateIssueCharter, type IssuePriority as IssueStorePriority, type IssueStatus } from "@emther/core/issue-store";
import { buildIssueDraftTask, getRun, markRunReviewed, parkPendingUnmaskedSend, reactToIssueUpdate, startRun } from "@emther/core/agent-runtime/index";
import { isUnconfirmedNameCandidatesError } from "@emther/core/name-candidate-confirmation";
import { linkJournalToIssue, listSourceJournalsForIssue, toJournalEntryViews } from "@emther/core/journal-store";
import { buildSourceConsultIndex } from "@emther/core/journal-consult-index";
import { resolveUniqueByPrefix } from "@emther/core/id-resolve";
import { ISSUE_PRIORITIES, ISSUE_STATUSES, type IssuePriority } from "@emther/core/types";
import { jsonFromUnknownError, maskOptionsFromBody } from "../lib/name-candidate-response";

// docs/2nd_architecture/plan.md フェーズ2.5（高リスク バッチ3）: web/src/app/api/issues/{route,[id]/route}.ts の移植。

function resolveIssueForRead(id: string) {
  return resolveUniqueByPrefix(listIssues(), (i) => i.id, id);
}

export const issuesRoute = new Hono()
  .get("/", (c) => c.json({ issues: listIssues().map(toIssueView) }))
  // ユーザー依頼「Journal等からIssueを生成する際、AIエージェントチームに内容を埋めさせる」
  // 対応。既存のAgent Run（EM主導のチャット・Dashboard等）から起票された場合は
  // agentRunIdが渡るのでそちらに委ね、それ以外（Journal起票・Issues一覧の手動起票・
  // サブIssue追加など、agentRunIdの無い「素のIssue作成」）だけ、作成直後にLead Agentの
  // 分析Runを自動で紐づける。Lead Agentはconsultで専門エージェントに相談できるため、
  // 「チームで内容を埋める」を単一エントリポイント（このAPI）だけで全経路に効かせられる。
  .post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    const title = typeof body?.title === "string" ? body.title.trim() : "";
    const agentRunId = typeof body?.agentRunId === "string" && body.agentRunId ? body.agentRunId : undefined;
    const parentId = typeof body?.parentId === "string" && body.parentId ? body.parentId : undefined;

    if (!title) {
      return c.json({ error: "titleは必須です" }, 400);
    }

    const tags = Array.isArray(body?.tags) ? body.tags.filter((t: unknown): t is string => typeof t === "string") : undefined;
    const themeId = typeof body?.themeId === "string" && body.themeId ? body.themeId : undefined;
    const teamId = typeof body?.teamId === "string" && body.teamId ? body.teamId : undefined;
    const priority =
      typeof body?.priority === "string" && ISSUE_PRIORITIES.includes(body.priority as IssueStorePriority)
        ? (body.priority as IssueStorePriority)
        : undefined;
    const charter = {
      why: typeof body?.why === "string" ? body.why : undefined,
      what: typeof body?.what === "string" ? body.what : undefined,
      how: typeof body?.how === "string" ? body.how : undefined,
    };
    const opts = maskOptionsFromBody(body);
    // 同一相談から親なし複数Issueを切るとき、2件目以降は agentRunId を付けず
    // sourceRunId だけ渡して生成元を残す（agentRunId は1 Issue に1 Run の紐付け制約）。
    const sourceRunId = typeof body?.sourceRunId === "string" && body.sourceRunId.trim() ? body.sourceRunId.trim() : agentRunId;
    const sourceRun = agentRunId ? getRun(agentRunId) : sourceRunId ? getRun(sourceRunId) : undefined;
    const sourceJournalId =
      typeof body?.sourceJournalId === "string" && body.sourceJournalId.trim() ? body.sourceJournalId.trim() : sourceRun?.sourceJournalId;

    // docs/memo.md「メモとは別に提案自体の詳細を残す単一の場所」対応。/api/suggestionsと同じ
    // ロジック（sourceRunの内部表現のproposalをそのまま起票時のdetailにする）。
    const detail = sourceRun?.proposal
      ? {
          conclusion: sourceRun.proposal.conclusion,
          facts: sourceRun.proposal.facts,
          logic: sourceRun.proposal.logic,
          ...(sourceRun.proposal.expansions?.length ? { expansions: sourceRun.proposal.expansions } : {}),
          ...(sourceRun.proposal.challenges?.length ? { challenges: sourceRun.proposal.challenges } : {}),
          ...(sourceRun.proposal.advice ? { advice: sourceRun.proposal.advice } : {}),
        }
      : undefined;

    try {
      const issue = await createIssue(title, agentRunId, charter, parentId, tags, teamId, {
        ...opts,
        priority,
        sourceJournalId,
        sourceRunId,
        themeId,
        detail,
      });
      if (agentRunId) {
        markRunReviewed(agentRunId);
        if (sourceJournalId) {
          await linkJournalToIssue(sourceJournalId, issue.id, opts).catch(() => {
            // Journal 紐付けの失敗で Issue 起票自体は失敗させない。
          });
        }
      } else {
        const task = buildIssueDraftTask(title, charter);
        try {
          await startRun("Lead Agent", task, "manual", issue.id, { ...opts, sourceJournalId });
        } catch (err) {
          if (isUnconfirmedNameCandidatesError(err)) {
            parkPendingUnmaskedSend({
              id: `unmasked-start:${issue.id}:${Date.now()}`,
              kind: "start-run",
              candidates: err.candidates,
              label: "起票直後の分析送信確認",
              issueId: issue.id,
              issueTitle: title,
              agentName: "Lead Agent",
              task,
              origin: "manual",
              linkedIssueId: issue.id,
              sourceJournalId,
            });
          }
          // その他の起動失敗でもIssue起票自体は失敗させない。
        }
      }
      return c.json({ issue: toIssueView(issue) }, 201);
    } catch (err) {
      return jsonFromUnknownError(err, 400);
    }
  })
  .get("/:id", async (c) => {
    const id = c.req.param("id");
    const resolved = resolveIssueForRead(id);
    if (resolved.status === "none") {
      return c.json({ error: "not found" }, 404);
    }
    if (resolved.status === "ambiguous") {
      return c.json(
        { error: "ambiguous", candidates: resolved.items.map((i) => ({ id: i.id, title: i.title, href: `/suggestions/${i.id}` })) },
        409,
      );
    }
    const issue = resolved.item;
    return c.json({
      issue: toIssueView(issue),
      sourceJournals: toJournalEntryViews(listSourceJournalsForIssue(issue.id, issue.sourceJournalId), await buildSourceConsultIndex()),
    });
  })
  .patch("/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    const opts = maskOptionsFromBody(body);

    // docs/em_human_story_and_ux.md 改修依頼「Issueのタイトルを変更できるようにする」対応。
    if (typeof body?.title === "string" && !body.title.trim()) {
      return c.json({ error: "titleは必須です" }, 400);
    }
    // docs/em_ui_ux_issue.md 4節「ステータス管理の導入」対応。
    if ("status" in (body ?? {}) && !ISSUE_STATUSES.includes(body.status)) {
      return c.json({ error: "statusの値が不正です" }, 400);
    }
    if ("priority" in (body ?? {}) && !ISSUE_PRIORITIES.includes(body.priority)) {
      return c.json({ error: "priorityの値が不正です" }, 400);
    }
    if ("moveFocus" in (body ?? {}) && body.moveFocus !== "up" && body.moveFocus !== "down") {
      return c.json({ error: "moveFocusは up または down です" }, 400);
    }

    try {
      let issue = await updateIssueCharter(
        id,
        {
          why: typeof body?.why === "string" ? body.why : undefined,
          what: typeof body?.what === "string" ? body.what : undefined,
          how: typeof body?.how === "string" ? body.how : undefined,
        },
        { ...opts, onUpdated: reactToIssueUpdate },
      );
      if (!issue) {
        return c.json({ error: "not found" }, 404);
      }
      if (typeof body?.title === "string" && body.title.trim()) {
        issue = (await setIssueTitle(id, body.title, opts)) ?? issue;
      }
      if (Array.isArray(body?.tags)) {
        const tags = body.tags.filter((t: unknown): t is string => typeof t === "string");
        issue = (await setIssueTags(id, tags)) ?? issue;
      }
      if ("themeId" in (body ?? {})) {
        const themeId = typeof body.themeId === "string" && body.themeId ? body.themeId : null;
        issue = setIssueTheme(id, themeId) ?? issue;
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
      return c.json({ issue: toIssueView(issue) });
    } catch (err) {
      return jsonFromUnknownError(err);
    }
  });
