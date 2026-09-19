import { Hono } from "hono";
import {
  listPendingAgentStarts,
  listPendingUnmaskedSends,
  listRuns,
  listRunsPage,
  startRun,
  toRunView,
  type AgentStatus,
} from "@emther/core/agent-runtime/index";
import { EXEC_AGENT_NAME } from "@emther/core/types";
import { jsonFromUnknownError, maskOptionsFromBodyStrict } from "../lib/name-candidate-response";

// docs/2nd_architecture/plan.md フェーズ2.5（高リスク バッチ1）:
// web/src/app/api/agents/{route,inbox/route}.ts の移植。
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
