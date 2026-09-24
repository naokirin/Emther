import type {
  PersonConcernAckRepository,
  PersonSuggestionConcernAck,
} from "../../person-concern-ack/person-concern-ack-repository";
import { createSqliteExecutor, type SqliteExecutor } from "../sqlite-executor";

type Row = {
  person_id: string;
  suggestion_id: string;
  note: string | null;
  created_at: number;
};

function rowToAck(row: Row): PersonSuggestionConcernAck {
  return {
    personId: row.person_id,
    suggestionId: row.suggestion_id,
    note: row.note ?? undefined,
    createdAt: row.created_at,
  };
}

export function createSqlitePersonConcernAckRepository(
  db: SqliteExecutor = createSqliteExecutor(),
): PersonConcernAckRepository {
  return {
    upsert(ack: PersonSuggestionConcernAck): void {
      db.run(
        `INSERT INTO person_suggestion_concern_acks (person_id, suggestion_id, note, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(person_id, suggestion_id) DO UPDATE SET note = excluded.note, created_at = excluded.created_at`,
        ack.personId,
        ack.suggestionId,
        ack.note ?? null,
        ack.createdAt,
      );
    },
    delete(personId: string, suggestionId: string): void {
      db.run(
        `DELETE FROM person_suggestion_concern_acks WHERE person_id = ? AND suggestion_id = ?`,
        personId,
        suggestionId,
      );
    },
    listByPerson(personId: string): PersonSuggestionConcernAck[] {
      return db
        .all<Row>(`SELECT * FROM person_suggestion_concern_acks WHERE person_id = ?`, personId)
        .map(rowToAck);
    },
  };
}
