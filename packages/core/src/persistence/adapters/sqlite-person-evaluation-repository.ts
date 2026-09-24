import type {
  EvaluationLens,
  EvaluationLogStatus,
  PersonEvaluationLog,
  PersonEvaluationRepository,
} from "../../person-evaluation/person-evaluation-types";
import { createSqliteExecutor, type SqliteExecutor } from "../sqlite-executor";

type Row = {
  id: string;
  person_id: string;
  lens: string;
  status: string;
  polarity: string;
  source_journal_id: string;
  value_snapshot: string | null;
  snapshot_text: string;
  rationale: string;
  created_at: number;
  updated_at: number;
  no_action_needed_at: number | null;
  no_action_needed_note: string | null;
};

function rowToLog(row: Row): PersonEvaluationLog {
  return {
    id: row.id,
    personId: row.person_id,
    lens: row.lens as PersonEvaluationLog["lens"],
    status: row.status as PersonEvaluationLog["status"],
    polarity: row.polarity as PersonEvaluationLog["polarity"],
    sourceJournalId: row.source_journal_id,
    valueSnapshot: row.value_snapshot ?? undefined,
    snapshotText: row.snapshot_text,
    rationale: row.rationale,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    noActionNeededAt: row.no_action_needed_at ?? undefined,
    noActionNeededNote: row.no_action_needed_note ?? undefined,
  };
}

export function createSqlitePersonEvaluationRepository(
  db: SqliteExecutor = createSqliteExecutor(),
): PersonEvaluationRepository {
  return {
    insert(log: PersonEvaluationLog): void {
      db.run(
        `INSERT INTO person_evaluation_logs (
          id, person_id, lens, status, polarity, source_journal_id,
          value_snapshot, snapshot_text, rationale, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        log.id,
        log.personId,
        log.lens,
        log.status,
        log.polarity,
        log.sourceJournalId,
        log.valueSnapshot ?? null,
        log.snapshotText,
        log.rationale,
        log.createdAt,
        log.updatedAt,
      );
    },
    listByPerson(personId: string): PersonEvaluationLog[] {
      return db
        .all<Row>(
          `SELECT * FROM person_evaluation_logs WHERE person_id = ? ORDER BY created_at DESC`,
          personId,
        )
        .map(rowToLog);
    },
    get(id: string): PersonEvaluationLog | undefined {
      const row = db.get<Row>(`SELECT * FROM person_evaluation_logs WHERE id = ?`, id);
      return row ? rowToLog(row) : undefined;
    },
    updateStatus(id: string, status: EvaluationLogStatus, updatedAt: number): void {
      db.run(`UPDATE person_evaluation_logs SET status = ?, updated_at = ? WHERE id = ?`, status, updatedAt, id);
    },
    updateNoActionNeeded(id: string, at: number | null, note: string | null): void {
      db.run(
        `UPDATE person_evaluation_logs SET no_action_needed_at = ?, no_action_needed_note = ? WHERE id = ?`,
        at,
        note,
        id,
      );
    },
    existsActive(personId: string, sourceJournalId: string, lens: EvaluationLens): boolean {
      const row = db.get<{ id: string }>(
        `SELECT id FROM person_evaluation_logs
         WHERE person_id = ? AND source_journal_id = ? AND lens = ? AND status != 'discarded'
         LIMIT 1`,
        personId,
        sourceJournalId,
        lens,
      );
      return !!row;
    },
  };
}
