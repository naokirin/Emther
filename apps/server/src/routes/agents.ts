import { Hono } from "hono";
import type {
  AgentRunMutationResponse,
  AgentSuggestionNotesResponse,
  AgentSuggestionUpdatesResponse,
  AgentThemesAdoptResponse,
  AgentsInboxResponse,
  AgentsResponse,
  OkResponse,
} from "@emther/api-contract";
import {
  adoptSuggestedSuggestionNotesFromRun,
  adoptSuggestedThemesFromRun,
  adoptSuggestionUpdatesFromRun,
  clearSuggestedSuggestionNotes,
  clearSuggestedSuggestionUpdates,
  clearSuggestedThemes,
  confirmPendingUnmaskedSend,
  decideRun,
  dismissPendingUnmaskedSend,
  getRun,
  listPendingAgentStarts,
  listPendingUnmaskedSends,
  listRuns,
  listRunsPage,
  markRunReviewed,
  setRunArchived,
  setRunTriageStatus,
  startRun,
  toRunView,
  type AgentStatus,
} from "@emther/core/agent-runtime/index";
import { resolveUniqueByPrefix } from "@emther/core/id-resolve";
import { dateStringToNoonTimestamp } from "@emther/core/journal-date-parser";
import { toThemeView } from "@emther/core/theme-store";
import { EXEC_AGENT_NAME } from "@emther/core/types";
import { jsonFromUnknownError, maskOptionsFromBody, maskOptionsFromBodyStrict } from "../lib/name-candidate-response";

// 注意: このファイルを import すると agent-runtime/scheduled-tasks.ts の
// モジュールロード時 side effect（ensureWatchdogStarted）により Hono プロセス側でも
// 30秒間隔の watchdog が起動する。二重起動は既存の3層ガード
// （globalThis・ファイル永続化・DB上の当日 run 存在チェック）で許容される設計。

const DEFAULT_PAGE_SIZE = 5;
const MAX_PAGE_SIZE = 50;
const VALID_STATUSES: readonly AgentStatus[] = ["active", "queued", "yield", "idle", "error"];

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const n = value !== undefined ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function parseIndices(body: unknown): number[] | undefined {
  const raw = (body as { indices?: unknown } | null)?.indices;
  if (!Array.isArray(raw)) return undefined;
  const indices = raw.filter((n): n is number => typeof n === "number");
  return indices.length > 0 ? indices : undefined;
}

export const agentsRoute = new Hono()
  .get("/", (c) => {
    const body = {
      runs: listRuns().map(toRunView),
      pendingAgentStarts: listPendingAgentStarts(),
      pendingUnmaskedSends: listPendingUnmaskedSends(),
    } satisfies AgentsResponse;
    return c.json(body);
  })
  .post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    const agentName = typeof body?.agentName === "string" ? body.agentName.trim() : "";
    const task = typeof body?.task === "string" ? body.task.trim() : "";
    const sourceJournalId =
      typeof body?.sourceJournalId === "string" && body.sourceJournalId.trim() ? body.sourceJournalId.trim() : undefined;
    const consultIntent = body?.consultIntent === "theme" ? ("theme" as const) : undefined;
    // 何でも相談の「経営／役員目線の厳しいレビューも聞く」チェック。LeadがExec Agentを必須consultする。
    const requireExecConsult = body?.requireExecConsult === true;

    if (!agentName || !task) {
      return c.json({ error: "agentNameとtaskは必須です" }, 400);
    }

    try {
      const run = await startRun(agentName, task, "manual", undefined, {
        ...maskOptionsFromBodyStrict(body),
        sourceJournalId,
        consultIntent,
        ...(requireExecConsult && agentName === "Lead Agent" ? { requiredConsultAgents: [EXEC_AGENT_NAME] } : {}),
      });
      const resBody = { run: toRunView(run) } satisfies AgentRunMutationResponse;
      return c.json(resBody, 201);
    } catch (err) {
      return jsonFromUnknownError(err);
    }
  })
  .get("/:id", (c) => {
    const id = c.req.param("id");
    const exact = getRun(id);
    if (exact) {
      return c.json({ run: toRunView(exact) });
    }
    const resolved = resolveUniqueByPrefix(listRuns(), (r) => r.id, id);
    if (resolved.status === "none") {
      return c.json({ error: "not found" }, 404);
    }
    if (resolved.status === "ambiguous") {
      return c.json(
        {
          error: "ambiguous",
          candidates: resolved.items.map((r) => ({
            id: r.id,
            label: `${r.agentName}: ${r.task.slice(0, 80)}`,
            href: `/chat?runId=${encodeURIComponent(r.id)}`,
          })),
        },
        409,
      );
    }
    return c.json({ run: toRunView(resolved.item) });
  })
  .post("/:id/decide", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    const message = typeof body?.message === "string" ? body.message.trim() : "";

    if (!message) {
      return c.json({ error: "messageは必須です" }, 400);
    }

    try {
      const run = await decideRun(id, message, {
        ...maskOptionsFromBodyStrict(body),
      });
      if (!run) {
        return c.json({ error: "not found" }, 404);
      }
      const resBody = { run: toRunView(run) } satisfies AgentRunMutationResponse;
      return c.json(resBody);
    } catch (err) {
      return jsonFromUnknownError(err, 409);
    }
  })
  // archived は triageStatus（様子見/却下）とは独立の軸のため、他の指定と併用できるよう独立して処理する。
  .post("/:id/review", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    if ("archived" in (body ?? {}) && typeof body.archived !== "boolean") {
      return c.json({ error: "archivedはtrue/falseです" }, 400);
    }

    const triageStatus = body?.triageStatus === "watching" || body?.triageStatus === "dismissed" ? body.triageStatus : undefined;
    const hasArchived = "archived" in (body ?? {});
    // 様子見時の「次確認日」（ローリング）。YYYY-MM-DD または epoch ms。却下時は無視。
    let nextReviewAt: number | undefined;
    if (triageStatus === "watching" && body?.triageNextReviewAt != null) {
      if (typeof body.triageNextReviewAt === "number" && Number.isFinite(body.triageNextReviewAt)) {
        nextReviewAt = body.triageNextReviewAt;
      } else if (typeof body.triageNextReviewAt === "string") {
        const parsed = dateStringToNoonTimestamp(body.triageNextReviewAt);
        if (parsed === undefined) {
          return c.json({ error: "triageNextReviewAtはYYYY-MM-DDまたは数値のタイムスタンプです" }, 400);
        }
        nextReviewAt = parsed;
      } else {
        return c.json({ error: "triageNextReviewAtはYYYY-MM-DDまたは数値のタイムスタンプです" }, 400);
      }
    }

    let run = triageStatus
      ? setRunTriageStatus(id, triageStatus, nextReviewAt !== undefined ? { nextReviewAt } : undefined)
      : undefined;
    if (hasArchived) run = setRunArchived(id, body.archived) ?? run;
    if (!triageStatus && !hasArchived) run = markRunReviewed(id);

    if (!run) {
      return c.json({ error: "not found" }, 404);
    }
    const resBody = { run: toRunView(run) } satisfies AgentRunMutationResponse;
    return c.json(resBody);
  })
  .post("/:id/themes", async (c) => {
    const id = c.req.param("id");
    if (!getRun(id)) return c.json({ error: "not found" }, 404);
    const result = await adoptSuggestedThemesFromRun(id);
    if (!result) return c.json({ error: "採用できるテーマ提案がありません" }, 400);
    const resBody = {
      run: toRunView(result.run),
      themes: result.themes.map(toThemeView),
    } satisfies AgentThemesAdoptResponse;
    return c.json(resBody);
  })
  .delete("/:id/themes", (c) => {
    const id = c.req.param("id");
    const run = clearSuggestedThemes(id);
    if (!run) return c.json({ error: "not found" }, 404);
    const resBody = { run: toRunView(run) } satisfies AgentRunMutationResponse;
    return c.json(resBody);
  })
  // POST=まとめて反映（suggestedSuggestionUpdates を実際の Suggestion へ書き込む）、DELETE=却下。
  // body で indices を指定すると該当要素のみ、未指定時は全件。
  .post("/:id/suggestion-updates", async (c) => {
    const id = c.req.param("id");
    if (!getRun(id)) return c.json({ error: "not found" }, 404);
    const body = await c.req.json().catch(() => null);
    const indices = parseIndices(body);
    const result = await adoptSuggestionUpdatesFromRun(id, indices);
    if (!result) return c.json({ error: "反映できる整理差分がありません" }, 400);
    const resBody = {
      run: toRunView(result.run),
      applied: result.applied,
      skipped: result.skipped,
    } satisfies AgentSuggestionUpdatesResponse;
    return c.json(resBody);
  })
  .delete("/:id/suggestion-updates", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    const indices = parseIndices(body);
    const run = clearSuggestedSuggestionUpdates(id, { indices });
    if (!run) return c.json({ error: "not found" }, 404);
    const resBody = { run: toRunView(run) } satisfies AgentRunMutationResponse;
    return c.json(resBody);
  })
  // POST=採用（対象提案への追記を確定）、DELETE=却下/対応済み。
  // body で indices を指定すると suggestedSuggestionNotes 中の該当要素のみ、未指定時は全件。
  // いずれも処理した提案は run から消す。
  .post("/:id/suggestion-notes", async (c) => {
    const id = c.req.param("id");
    if (!getRun(id)) return c.json({ error: "not found" }, 404);
    const body = await c.req.json().catch(() => null);
    const indices = parseIndices(body);
    const result = await adoptSuggestedSuggestionNotesFromRun(id, indices);
    if (!result) return c.json({ error: "採用できる追記提案がありません" }, 400);
    const resBody = {
      run: toRunView(result.run),
      written: result.written,
      skipped: result.skipped,
    } satisfies AgentSuggestionNotesResponse;
    return c.json(resBody);
  })
  .delete("/:id/suggestion-notes", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    const indices = parseIndices(body);
    const reason = (body as { reason?: unknown } | null)?.reason === "handled" ? "handled" : "dismissed";
    const run = clearSuggestedSuggestionNotes(id, { indices, reason });
    if (!run) return c.json({ error: "not found" }, 404);
    const resBody = { run: toRunView(run) } satisfies AgentRunMutationResponse;
    return c.json(resBody);
  });

// /agents の Inbox 一覧（フィルタ＋ページ送り）専用。Fleet・Activity Stream は
// 引き続き既存の /api/agents（全件）を使う（横断的な直近状態の集計用途）。
export const agentsInboxRoute = new Hono().get("/", (c) => {
  const pageSize = Math.min(MAX_PAGE_SIZE, parsePositiveInt(c.req.query("pageSize"), DEFAULT_PAGE_SIZE));
  const page = parsePositiveInt(c.req.query("page"), 1);
  const statusParam = c.req.query("status");
  const status = statusParam && (VALID_STATUSES as readonly string[]).includes(statusParam) ? (statusParam as AgentStatus) : undefined;
  const showDismissed = c.req.query("showDismissed") === "1";

  const { runs, total } = listRunsPage({ status, showDismissed }, { limit: pageSize, offset: (page - 1) * pageSize });
  const body = { runs, total, page, pageSize } satisfies AgentsInboxResponse;
  return c.json(body);
});

export const agentsPendingUnmaskedRoute = new Hono().post("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const action = body?.action === "dismiss" ? "dismiss" : "confirm";

  if (action === "dismiss") {
    const ok = dismissPendingUnmaskedSend(id);
    if (!ok) return c.json({ error: "not found" }, 404);
    const resBody = { ok: true } satisfies OkResponse;
    return c.json(resBody);
  }

  try {
    const opts = maskOptionsFromBody(body);
    // 未指定時は従来どおり未マスク許可で進める（ダイアログの「このまま」）
    const run = await confirmPendingUnmaskedSend(id, {
      allowUnmaskedCandidates: opts.registerNameCandidates ? false : true,
      registerNameCandidates: opts.registerNameCandidates,
    });
    if (!run) return c.json({ error: "not found" }, 404);
    const resBody = { run: toRunView(run) } satisfies AgentRunMutationResponse;
    return c.json(resBody);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 409);
  }
});
