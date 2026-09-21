import { Hono } from "hono";
import {
  adoptSuggestedSuggestionNotesFromRun,
  adoptSuggestedThemesFromRun,
  adoptSuggestionUpdatesFromRun,
  clearSuggestedCharter,
  clearSuggestedSuggestionNotes,
  clearSuggestedSubSuggestions,
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
import { toThemeView } from "@emther/core/theme-store";
import { EXEC_AGENT_NAME } from "@emther/core/types";
import { jsonFromUnknownError, maskOptionsFromBody, maskOptionsFromBodyStrict } from "../lib/name-candidate-response";

// docs/2nd_architecture/plan.md フェーズ2.5（高リスク バッチ1・2）:
// web/src/app/api/agents/**/route.ts の移植。
// 注意: このファイルをimportすると agent-runtime/scheduled-tasks.ts の
// モジュールロード時 side effect（ensureWatchdogStarted）によりHonoプロセス側でも
// 30秒間隔のwatchdogが起動する。Next側watchdogとの二重起動は、既存の3層ガード
// （globalThis・ファイル永続化・DB上の当日run存在チェック）で許容される設計
// （HMRによるNext側の多重起動と同型の事象として元々ハードニングされている）。
// docs/2nd_architecture/plan.md リスクレジスタ参照。

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
  .get("/", (c) =>
    c.json({
      runs: listRuns().map(toRunView),
      pendingAgentStarts: listPendingAgentStarts(),
      pendingUnmaskedSends: listPendingUnmaskedSends(),
    }),
  )
  .post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    const agentName = typeof body?.agentName === "string" ? body.agentName.trim() : "";
    const task = typeof body?.task === "string" ? body.task.trim() : "";
    const sourceJournalId =
      typeof body?.sourceJournalId === "string" && body.sourceJournalId.trim() ? body.sourceJournalId.trim() : undefined;
    // 何でも相談の「経営／役員目線の厳しいレビューも聞く」チェック。LeadがExec Agentを必須consultする。
    const requireExecConsult = body?.requireExecConsult === true;

    if (!agentName || !task) {
      return c.json({ error: "agentNameとtaskは必須です" }, 400);
    }

    try {
      const run = await startRun(agentName, task, "manual", undefined, {
        ...maskOptionsFromBodyStrict(body),
        sourceJournalId,
        ...(requireExecConsult && agentName === "Lead Agent" ? { requiredConsultAgents: [EXEC_AGENT_NAME] } : {}),
      });
      return c.json({ run: toRunView(run) }, 201);
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
      return c.json({ run: toRunView(run) });
    } catch (err) {
      return jsonFromUnknownError(err, 409);
    }
  })
  // docs/memo.md「相談、Journal、提案を削除（アーカイブ）したい」対応。archivedはtriageStatus
  // （様子見/却下）とは独立の軸のため、他の指定と併用できるよう独立して処理する。
  .post("/:id/review", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    if ("archived" in (body ?? {}) && typeof body.archived !== "boolean") {
      return c.json({ error: "archivedはtrue/falseです" }, 400);
    }

    const triageStatus = body?.triageStatus === "watching" || body?.triageStatus === "dismissed" ? body.triageStatus : undefined;
    const hasArchived = "archived" in (body ?? {});

    let run = triageStatus ? setRunTriageStatus(id, triageStatus) : undefined;
    if (hasArchived) run = setRunArchived(id, body.archived) ?? run;
    if (!triageStatus && !hasArchived) run = markRunReviewed(id);

    if (!run) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json({ run: toRunView(run) });
  })
  .post("/:id/themes", async (c) => {
    const id = c.req.param("id");
    if (!getRun(id)) return c.json({ error: "not found" }, 404);
    const result = await adoptSuggestedThemesFromRun(id);
    if (!result) return c.json({ error: "採用できるテーマ提案がありません" }, 400);
    return c.json({ run: toRunView(result.run), themes: result.themes.map(toThemeView) });
  })
  .delete("/:id/themes", (c) => {
    const id = c.req.param("id");
    const run = clearSuggestedThemes(id);
    if (!run) return c.json({ error: "not found" }, 404);
    return c.json({ run: toRunView(run) });
  })
  // docs/suggestion_organize_via_consult.md「5. 反映の契約（HITL）」対応。POST=まとめて反映
  // （suggestedSuggestionUpdatesの対象要素を実際のSuggestionへ書き込む）、DELETE=却下。
  // bodyでindicesを指定すると該当要素のみを対象にし、未指定時は従来どおり全件を対象にする。
  .post("/:id/suggestion-updates", async (c) => {
    const id = c.req.param("id");
    if (!getRun(id)) return c.json({ error: "not found" }, 404);
    const body = await c.req.json().catch(() => null);
    const indices = parseIndices(body);
    const result = await adoptSuggestionUpdatesFromRun(id, indices);
    if (!result) return c.json({ error: "反映できる整理差分がありません" }, 400);
    return c.json({ run: toRunView(result.run), applied: result.applied, skipped: result.skipped });
  })
  .delete("/:id/suggestion-updates", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    const indices = parseIndices(body);
    const run = clearSuggestedSuggestionUpdates(id, { indices });
    if (!run) return c.json({ error: "not found" }, 404);
    return c.json({ run: toRunView(run) });
  })
  .post("/:id/charter/dismiss", (c) => {
    const id = c.req.param("id");
    const run = clearSuggestedCharter(id);
    if (!run) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json({ run: toRunView(run) });
  })
  .post("/:id/sub-suggestions/dismiss", (c) => {
    const id = c.req.param("id");
    const run = clearSuggestedSubSuggestions(id);
    if (!run) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json({ run: toRunView(run) });
  })
  // docs/memo.md「Agentが相談などから他提案などへ記録することができない」「他提案への追記提案で
  // 追記対象を個別に選択できるようにする」対応。POST=採用（対象提案への追記を確定）、DELETE=却下/
  // 対応済み。bodyでindicesを指定するとsuggestedSuggestionNotes中の該当要素のみを対象にし、未指定時は
  // 従来どおり全件を対象にする。いずれも処理した提案はrunから消す。
  .post("/:id/suggestion-notes", async (c) => {
    const id = c.req.param("id");
    if (!getRun(id)) return c.json({ error: "not found" }, 404);
    const body = await c.req.json().catch(() => null);
    const indices = parseIndices(body);
    const result = await adoptSuggestedSuggestionNotesFromRun(id, indices);
    if (!result) return c.json({ error: "採用できる追記提案がありません" }, 400);
    return c.json({ run: toRunView(result.run), written: result.written, skipped: result.skipped });
  })
  .delete("/:id/suggestion-notes", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    const indices = parseIndices(body);
    const reason = (body as { reason?: unknown } | null)?.reason === "handled" ? "handled" : "dismissed";
    const run = clearSuggestedSuggestionNotes(id, { indices, reason });
    if (!run) return c.json({ error: "not found" }, 404);
    return c.json({ run: toRunView(run) });
  });

// ユーザー要望「一覧の全件取得をページネーション化したい」対応。/agents画面の
// Inbox一覧（フィルタ＋ページ送り）専用の軽量エンドポイント。Fleet状態・Activity Streamは
// 引き続き既存の/api/agents（全件取得）を使う——それらは「直近の状態」を横断的に見る
// 集計用途であり、今回のスコープ外（別タスク）とする。
export const agentsInboxRoute = new Hono().get("/", (c) => {
  const pageSize = Math.min(MAX_PAGE_SIZE, parsePositiveInt(c.req.query("pageSize"), DEFAULT_PAGE_SIZE));
  const page = parsePositiveInt(c.req.query("page"), 1);
  const statusParam = c.req.query("status");
  const status = statusParam && (VALID_STATUSES as readonly string[]).includes(statusParam) ? (statusParam as AgentStatus) : undefined;
  const showDismissed = c.req.query("showDismissed") === "1";

  const { runs, total } = listRunsPage({ status, showDismissed }, { limit: pageSize, offset: (page - 1) * pageSize });
  return c.json({ runs, total, page, pageSize });
});

export const agentsPendingUnmaskedRoute = new Hono().post("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const action = body?.action === "dismiss" ? "dismiss" : "confirm";

  if (action === "dismiss") {
    const ok = dismissPendingUnmaskedSend(id);
    if (!ok) return c.json({ error: "not found" }, 404);
    return c.json({ ok: true });
  }

  try {
    const opts = maskOptionsFromBody(body);
    // 未指定時は従来どおり未マスク許可で進める（ダイアログの「このまま」）
    const run = await confirmPendingUnmaskedSend(id, {
      allowUnmaskedCandidates: opts.registerNameCandidates ? false : true,
      registerNameCandidates: opts.registerNameCandidates,
    });
    if (!run) return c.json({ error: "not found" }, 404);
    return c.json({ run: toRunView(run) });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 409);
  }
});
