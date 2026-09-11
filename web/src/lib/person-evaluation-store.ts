import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import { maskForStorage, unmaskNames } from "@/lib/people-directory";
import { listObjectives, getOrgStrategy } from "@/lib/org-context-store";
import { listActiveFactsForPerson } from "@/lib/knowledge-store";

// docs/value_hierarchy_and_flow.md §5。メンバー評価の主経路は Journal → 日常の評価ログ。
// テーマ / Issue は載せない。A（成果）と B（Value）を混ぜない。仮置き→確定の状態機械。

export type EvaluationLens = "outcome" | "value";
export type EvaluationLogStatus = "provisional" | "confirmed" | "discarded";
export type EvaluationPolarity = "positive" | "concern";

export type PersonEvaluationLog = {
  id: string;
  personId: string;
  lens: EvaluationLens;
  status: EvaluationLogStatus;
  polarity: EvaluationPolarity;
  sourceJournalId: string;
  targetObjectiveId?: string;
  targetKeyResultId?: string;
  /** Values 参照は ID が無いため生成時点の文言スナップショット */
  valueSnapshot?: string;
  snapshotText: string;
  rationale: string;
  createdAt: number;
  updatedAt: number;
};

type Row = {
  id: string;
  person_id: string;
  lens: string;
  status: string;
  polarity: string;
  source_journal_id: string;
  target_objective_id: string | null;
  target_key_result_id: string | null;
  value_snapshot: string | null;
  snapshot_text: string;
  rationale: string;
  created_at: number;
  updated_at: number;
};

function rowToLog(row: Row): PersonEvaluationLog {
  return {
    id: row.id,
    personId: row.person_id,
    lens: row.lens as EvaluationLens,
    status: row.status as EvaluationLogStatus,
    polarity: row.polarity as EvaluationPolarity,
    sourceJournalId: row.source_journal_id,
    targetObjectiveId: row.target_objective_id ?? undefined,
    targetKeyResultId: row.target_key_result_id ?? undefined,
    valueSnapshot: row.value_snapshot ?? undefined,
    snapshotText: row.snapshot_text,
    rationale: row.rationale,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toEvaluationLogView(log: PersonEvaluationLog): PersonEvaluationLog {
  return {
    ...log,
    snapshotText: unmaskNames(log.snapshotText),
    rationale: unmaskNames(log.rationale),
    valueSnapshot: log.valueSnapshot !== undefined ? unmaskNames(log.valueSnapshot) : undefined,
  };
}

export async function createEvaluationLog(input: {
  personId: string;
  lens: EvaluationLens;
  polarity?: EvaluationPolarity;
  sourceJournalId: string;
  targetObjectiveId?: string;
  targetKeyResultId?: string;
  valueSnapshot?: string;
  snapshotText: string;
  rationale: string;
  status?: EvaluationLogStatus;
}): Promise<PersonEvaluationLog> {
  const now = Date.now();
  const log: PersonEvaluationLog = {
    id: randomUUID(),
    personId: input.personId,
    lens: input.lens,
    status: input.status ?? "provisional",
    polarity: input.polarity ?? "positive",
    sourceJournalId: input.sourceJournalId,
    targetObjectiveId: input.targetObjectiveId,
    targetKeyResultId: input.targetKeyResultId,
    valueSnapshot: input.valueSnapshot?.trim()
      ? await maskForStorage(input.valueSnapshot.trim())
      : undefined,
    snapshotText: await maskForStorage(input.snapshotText.trim()),
    rationale: await maskForStorage(input.rationale.trim()),
    createdAt: now,
    updatedAt: now,
  };
  const db = getDb();
  db.prepare(
    `INSERT INTO person_evaluation_logs (
      id, person_id, lens, status, polarity, source_journal_id,
      target_objective_id, target_key_result_id, value_snapshot,
      snapshot_text, rationale, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    log.id,
    log.personId,
    log.lens,
    log.status,
    log.polarity,
    log.sourceJournalId,
    log.targetObjectiveId ?? null,
    log.targetKeyResultId ?? null,
    log.valueSnapshot ?? null,
    log.snapshotText,
    log.rationale,
    log.createdAt,
    log.updatedAt,
  );
  return log;
}

export function listEvaluationLogsForPerson(
  personId: string,
  filter?: { lens?: EvaluationLens; status?: EvaluationLogStatus; since?: number; until?: number },
): PersonEvaluationLog[] {
  const db = getDb();
  const rows = db
    .prepare(`SELECT * FROM person_evaluation_logs WHERE person_id = ? ORDER BY created_at DESC`)
    .all(personId) as Row[];
  return rows
    .map(rowToLog)
    .filter((log) => {
      if (filter?.lens && log.lens !== filter.lens) return false;
      if (filter?.status && log.status !== filter.status) return false;
      if (filter?.since !== undefined && log.createdAt < filter.since) return false;
      if (filter?.until !== undefined && log.createdAt > filter.until) return false;
      return true;
    });
}

export function getEvaluationLog(id: string): PersonEvaluationLog | undefined {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM person_evaluation_logs WHERE id = ?`).get(id) as Row | undefined;
  return row ? rowToLog(row) : undefined;
}

export function setEvaluationLogStatus(
  id: string,
  status: EvaluationLogStatus,
): PersonEvaluationLog | undefined {
  const log = getEvaluationLog(id);
  if (!log) return undefined;
  if (log.status === status) return log;
  const now = Date.now();
  getDb()
    .prepare(`UPDATE person_evaluation_logs SET status = ?, updated_at = ? WHERE id = ?`)
    .run(status, now, id);
  return { ...log, status, updatedAt: now };
}

/** 同一 Journal×人物×レンズの仮置きが既にあればスキップ。 */
function alreadyLogged(personId: string, sourceJournalId: string, lens: EvaluationLens): boolean {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id FROM person_evaluation_logs
       WHERE person_id = ? AND source_journal_id = ? AND lens = ? AND status != 'discarded'
       LIMIT 1`,
    )
    .get(personId, sourceJournalId, lens) as { id: string } | undefined;
  return !!row;
}

/**
 * Journal 事実から A/B 仮置きログをヒューリスティック生成。
 * AI 本格推定の置き場。断定せず rationale に根拠を残す。
 */
export async function suggestEvaluationLogsFromRecentJournals(
  personId: string,
  _personName: string,
  opts: { limit?: number } = {},
): Promise<PersonEvaluationLog[]> {
  const limit = opts.limit ?? 20;
  const facts = listActiveFactsForPerson(personId, limit);

  const objectives = listObjectives();
  const topObjective = objectives[0];
  const topKr = topObjective?.keyResults[0];
  const strategy = getOrgStrategy();
  const valuesText = strategy.values?.trim() || undefined;

  const created: PersonEvaluationLog[] = [];

  for (const fact of facts) {
    const journalId = fact.sourceJournalId ?? fact.id;
    const excerpt = (fact.summary || fact.text || "").trim().slice(0, 280);
    if (!excerpt) continue;

    const concern =
      /懸念|不安|乖離|問題|炎上|離職|バーン|遅延|対立|ミス/.test(excerpt) || fact.sentiment === "negative";

    if (!alreadyLogged(personId, journalId, "outcome")) {
      const log = await createEvaluationLog({
        personId,
        lens: "outcome",
        polarity: concern ? "concern" : "positive",
        sourceJournalId: journalId,
        targetObjectiveId: topObjective?.id,
        targetKeyResultId: topKr?.id,
        snapshotText: excerpt,
        rationale: topObjective
          ? `Journal の事実を、Objective「${topObjective.title}」への貢献候補として仮置き（要レビュー）`
          : "Journal の事実を目標貢献の候補として仮置き（要レビュー）",
      });
      created.push(log);
    }

    if (valuesText && !alreadyLogged(personId, journalId, "value")) {
      const log = await createEvaluationLog({
        personId,
        lens: "value",
        polarity: concern ? "concern" : "positive",
        sourceJournalId: journalId,
        valueSnapshot: valuesText.slice(0, 500),
        snapshotText: excerpt,
        rationale: "Journal の言動を Values 適合の候補として仮置き（要レビュー。監視チェックリスト化しない）",
      });
      created.push(log);
    }
  }

  return created;
}

/** 期次束ね: 破棄以外をレンズ別に要約 */
export function bundleEvaluationLogs(
  personId: string,
  opts: { since?: number; until?: number } = {},
): {
  outcome: PersonEvaluationLog[];
  value: PersonEvaluationLog[];
  missing: string[];
} {
  const logs = listEvaluationLogsForPerson(personId, {
    since: opts.since,
    until: opts.until,
  }).filter((l) => l.status !== "discarded");

  const outcome = logs.filter((l) => l.lens === "outcome");
  const value = logs.filter((l) => l.lens === "value");
  const missing: string[] = [];
  if (outcome.length === 0) missing.push("目標貢献ログが不足");
  if (value.length === 0) missing.push("Value 体現ログが不足");
  return { outcome, value, missing };
}
