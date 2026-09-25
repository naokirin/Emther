import type { AgentRunRepository } from "../../agent-runtime/agent-run-repository";
import { parseSuggestedPriority } from "../../agent-runtime/extraction";
import type { AgentRun, AgentStatus, LogLine, SuggestedSuggestionNote } from "../../agent-runtime/types";
import type { SuggestedTheme } from "../../theme-store";
import { createSqliteExecutor, type SqliteExecutor } from "../sqlite-executor";

type AgentRunRow = {
  id: string;
  agent_name: string;
  task: string;
  status: string;
  session_id: string | null;
  agy_conversation_id: string | null;
  cursor_session_id: string | null;
  yield_request_json: string | null;
  proposal_json: string | null;
  suggested_action_items_json: string | null;
  suggested_sub_suggestions_json: string | null;
  suggested_charter_json: string | null;
  suggested_priority_json: string | null;
  suggested_themes_json: string | null;
  suggested_suggestion_notes_json: string | null;
  suggested_suggestion_updates_json: string | null;
  period_review_json: string | null;
  source_report_id: string | null;
  total_cost_usd: number;
  created_at: number;
  updated_at: number;
  consulted_by: string | null;
  source_journal_id: string | null;
  consult_intent: string | null;
  origin: string;
  reviewed: number;
  triage_status: string | null;
  triage_at: number | null;
  triage_next_review_at: number | null;
  archived_at: number | null;
};

type AgentRunLogRow = {
  run_id: string;
  ts: number;
  channel: string;
  text: string;
};

function rowToRun(row: AgentRunRow, log: LogLine[]): AgentRun {
  return {
    id: row.id,
    agentName: row.agent_name,
    task: row.task,
    status: row.status as AgentStatus,
    sessionId: row.session_id ?? undefined,
    agyConversationId: row.agy_conversation_id ?? undefined,
    cursorSessionId: row.cursor_session_id ?? undefined,
    log,
    yieldRequest: row.yield_request_json ? JSON.parse(row.yield_request_json) : undefined,
    // 旧永続runは expansions/challenges 欠落がありうるため、読み込み時に空配列で補う。
    proposal: row.proposal_json
      ? (() => {
          const p = JSON.parse(row.proposal_json) as AgentRun["proposal"];
          if (!p) return undefined;
          return {
            ...p,
            expansions: p.expansions ?? [],
            challenges: p.challenges ?? [],
            explorations: p.explorations ?? [],
          };
        })()
      : undefined,
    suggestedActionItems: row.suggested_action_items_json
      ? JSON.parse(row.suggested_action_items_json)
      : undefined,
    suggestedPriority: row.suggested_priority_json
      ? parseSuggestedPriority(JSON.parse(row.suggested_priority_json))
      : undefined,
    // 旧DBはevidenceIssueIdsキーで永続化されているため、読み込み時に新キー名へ揃える。
    suggestedThemes: row.suggested_themes_json
      ? (JSON.parse(row.suggested_themes_json) as Array<SuggestedTheme & { evidenceIssueIds?: string[] }>).map(
          (t) => ({ ...t, evidenceSuggestionIds: t.evidenceSuggestionIds ?? t.evidenceIssueIds }),
        )
      : undefined,
    // 旧DBはキー名issueIdで永続化されているため、読み込み時に新キー名suggestionIdへ揃える。
    suggestedSuggestionNotes: row.suggested_suggestion_notes_json
      ? (JSON.parse(row.suggested_suggestion_notes_json) as Array<SuggestedSuggestionNote & { issueId?: string }>).map(
          (n) => ({ suggestionId: n.suggestionId ?? n.issueId!, text: n.text }),
        )
      : undefined,
    suggestedSuggestionUpdates: row.suggested_suggestion_updates_json
      ? JSON.parse(row.suggested_suggestion_updates_json)
      : undefined,
    periodReview: row.period_review_json ? JSON.parse(row.period_review_json) : undefined,
    totalCostUsd: row.total_cost_usd,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    consultedBy: row.consulted_by ?? undefined,
    sourceJournalId: row.source_journal_id ?? undefined,
    consultIntent: row.consult_intent === "theme" ? "theme" : undefined,
    sourceReportId: row.source_report_id ?? undefined,
    origin: (row.origin as AgentRun["origin"]) ?? "manual",
    reviewed: !!row.reviewed,
    triageStatus: (row.triage_status as AgentRun["triageStatus"]) ?? undefined,
    triageAt: row.triage_at ?? undefined,
    triageNextReviewAt: row.triage_next_review_at ?? undefined,
    archivedAt: row.archived_at ?? undefined,
  };
}

export function createSqliteAgentRunRepository(
  db: SqliteExecutor = createSqliteExecutor(),
): AgentRunRepository {
  return {
    insertRunLog(runId: string, line: LogLine): void {
      db.run(
        "INSERT INTO agent_run_logs (run_id, ts, channel, text) VALUES (?, ?, ?, ?)",
        runId,
        line.ts,
        line.channel,
        line.text,
      );
    },

    upsertRunMeta(run: AgentRun): void {
      db.run(
        `INSERT INTO agent_runs
          (id, agent_name, task, status, session_id, agy_conversation_id, cursor_session_id, yield_request_json, proposal_json, suggested_action_items_json, suggested_sub_suggestions_json, suggested_charter_json, suggested_priority_json, suggested_themes_json, suggested_suggestion_notes_json, suggested_suggestion_updates_json, period_review_json, source_report_id, total_cost_usd, created_at, updated_at, consulted_by, source_journal_id, consult_intent, origin, reviewed, triage_status, triage_at, triage_next_review_at, archived_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           status = excluded.status,
           session_id = excluded.session_id,
           agy_conversation_id = excluded.agy_conversation_id,
           cursor_session_id = excluded.cursor_session_id,
           yield_request_json = excluded.yield_request_json,
           proposal_json = excluded.proposal_json,
           suggested_action_items_json = excluded.suggested_action_items_json,
           suggested_sub_suggestions_json = excluded.suggested_sub_suggestions_json,
           suggested_charter_json = excluded.suggested_charter_json,
           suggested_priority_json = excluded.suggested_priority_json,
           suggested_themes_json = excluded.suggested_themes_json,
           suggested_suggestion_notes_json = excluded.suggested_suggestion_notes_json,
           suggested_suggestion_updates_json = excluded.suggested_suggestion_updates_json,
           period_review_json = excluded.period_review_json,
           source_report_id = excluded.source_report_id,
           total_cost_usd = excluded.total_cost_usd,
           updated_at = excluded.updated_at,
           consult_intent = excluded.consult_intent,
           reviewed = excluded.reviewed,
           triage_status = excluded.triage_status,
           triage_at = excluded.triage_at,
           triage_next_review_at = excluded.triage_next_review_at,
           archived_at = excluded.archived_at`,
        run.id,
        run.agentName,
        run.task,
        run.status,
        run.sessionId ?? null,
        run.agyConversationId ?? null,
        run.cursorSessionId ?? null,
        run.yieldRequest ? JSON.stringify(run.yieldRequest) : null,
        run.proposal ? JSON.stringify(run.proposal) : null,
        run.suggestedActionItems ? JSON.stringify(run.suggestedActionItems) : null,
        null,
        null,
        run.suggestedPriority ? JSON.stringify(run.suggestedPriority) : null,
        run.suggestedThemes ? JSON.stringify(run.suggestedThemes) : null,
        run.suggestedSuggestionNotes ? JSON.stringify(run.suggestedSuggestionNotes) : null,
        run.suggestedSuggestionUpdates ? JSON.stringify(run.suggestedSuggestionUpdates) : null,
        run.periodReview ? JSON.stringify(run.periodReview) : null,
        run.sourceReportId ?? null,
        run.totalCostUsd,
        run.createdAt,
        run.updatedAt,
        run.consultedBy ?? null,
        run.sourceJournalId ?? null,
        run.consultIntent ?? null,
        run.origin,
        run.reviewed ? 1 : 0,
        run.triageStatus ?? null,
        run.triageAt ?? null,
        run.triageNextReviewAt ?? null,
        run.archivedAt ?? null,
      );
    },

    loadAllRunsWithLogs(): AgentRun[] {
      const runRows = db.all<AgentRunRow>("SELECT * FROM agent_runs");
      const logRows = db.all<AgentRunLogRow>(
        "SELECT run_id, ts, channel, text FROM agent_run_logs ORDER BY id ASC",
      );

      const logsByRun = new Map<string, LogLine[]>();
      for (const row of logRows) {
        const list = logsByRun.get(row.run_id) ?? [];
        list.push({ ts: row.ts, channel: row.channel as LogLine["channel"], text: row.text });
        logsByRun.set(row.run_id, list);
      }

      return runRows.map((row) => rowToRun(row, logsByRun.get(row.id) ?? []));
    },

    existsByOriginInRange(origin: string, start: number, end: number): boolean {
      const row = db.get<{ ok: number }>(
        "SELECT 1 AS ok FROM agent_runs WHERE origin = ? AND created_at >= ? AND created_at < ? LIMIT 1",
        origin,
        start,
        end,
      );
      return !!row;
    },

    minCreatedAtByOriginInRange(origin: string, start: number, end: number): number | null {
      const row = db.get<{ t: number | null }>(
        "SELECT MIN(created_at) AS t FROM agent_runs WHERE origin = ? AND created_at >= ? AND created_at < ?",
        origin,
        start,
        end,
      );
      return typeof row?.t === "number" && Number.isFinite(row.t) ? row.t : null;
    },

    listCreatedAtByOriginSince(origin: string, since: number): number[] {
      return db
        .all<{ created_at: number }>(
          "SELECT created_at FROM agent_runs WHERE origin = ? AND created_at >= ?",
          origin,
          since,
        )
        .map((r) => r.created_at);
    },
  };
}
