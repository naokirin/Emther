import { getDb } from "./db";
import { maskForStorage, unmaskNames } from "./people-directory";

// ユーザー指摘「確認したが対応不要だった、を示せず、メンバーのアラート表示（関連提案の
// 停滞・確認保留）の強調を減らせない」対応。people-hub.tsのhasConcerningSuggestionは、
// この人物に名前が一致した未アーカイブ提案に停滞・確認保留が1件でもあるかを毎回
// 実データから計算する（保存された状態を持たない）。提案自体の状態は書き換えず、
// 「この人物にとって、この提案は対応不要と確認済み」という人物×提案単位の判断だけを
// 別テーブルに持たせ、people-hub.ts側でこの判断を差し引いて強調するかどうかを決める。

export type PersonSuggestionConcernAck = {
  personId: string;
  suggestionId: string;
  note?: string;
  createdAt: number;
};

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

export async function acknowledgePersonSuggestionConcern(
  personId: string,
  suggestionId: string,
  note?: string,
): Promise<PersonSuggestionConcernAck> {
  const trimmed = note?.trim();
  const masked = trimmed ? await maskForStorage(trimmed) : undefined;
  const createdAt = Date.now();
  getDb()
    .prepare(
      `INSERT INTO person_suggestion_concern_acks (person_id, suggestion_id, note, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(person_id, suggestion_id) DO UPDATE SET note = excluded.note, created_at = excluded.created_at`,
    )
    .run(personId, suggestionId, masked ?? null, createdAt);
  return { personId, suggestionId, note: masked, createdAt };
}

export function clearPersonSuggestionConcernAck(personId: string, suggestionId: string): void {
  getDb()
    .prepare(`DELETE FROM person_suggestion_concern_acks WHERE person_id = ? AND suggestion_id = ?`)
    .run(personId, suggestionId);
}

export function listPersonSuggestionConcernAcks(personId: string): PersonSuggestionConcernAck[] {
  const rows = getDb()
    .prepare(`SELECT * FROM person_suggestion_concern_acks WHERE person_id = ?`)
    .all(personId) as Row[];
  return rows.map(rowToAck);
}

/** この人物について、確認済み（対応不要）の提案 IDの集合。 */
export function listAcknowledgedSuggestionIds(personId: string): Set<string> {
  return new Set(listPersonSuggestionConcernAcks(personId).map((a) => a.suggestionId));
}

export function toPersonSuggestionConcernAckView(ack: PersonSuggestionConcernAck): PersonSuggestionConcernAck {
  return { ...ack, note: ack.note !== undefined ? unmaskNames(ack.note) : undefined };
}
