import { getDb } from "./db";
import { maskForStorage, unmaskNames } from "./people-directory";

// ユーザー指摘「確認したが対応不要だった、を示せず、メンバーのアラート表示（関連Issueの
// 停滞・ブロッカー）の強調を減らせない」対応。people-hub.tsのhasConcerningIssueは、
// この人物に名前が一致した未アーカイブIssueに停滞・ブロッカーが1件でもあるかを毎回
// 実データから計算する（保存された状態を持たない）。Issue自体の状態は書き換えず、
// 「この人物にとって、このIssueは対応不要と確認済み」という人物×Issue単位の判断だけを
// 別テーブルに持たせ、people-hub.ts側でこの判断を差し引いて強調するかどうかを決める。

export type PersonIssueConcernAck = {
  personId: string;
  issueId: string;
  note?: string;
  createdAt: number;
};

type Row = {
  person_id: string;
  issue_id: string;
  note: string | null;
  created_at: number;
};

function rowToAck(row: Row): PersonIssueConcernAck {
  return {
    personId: row.person_id,
    issueId: row.issue_id,
    note: row.note ?? undefined,
    createdAt: row.created_at,
  };
}

export async function acknowledgePersonIssueConcern(
  personId: string,
  issueId: string,
  note?: string,
): Promise<PersonIssueConcernAck> {
  const trimmed = note?.trim();
  const masked = trimmed ? await maskForStorage(trimmed) : undefined;
  const createdAt = Date.now();
  getDb()
    .prepare(
      `INSERT INTO person_issue_concern_acks (person_id, issue_id, note, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(person_id, issue_id) DO UPDATE SET note = excluded.note, created_at = excluded.created_at`,
    )
    .run(personId, issueId, masked ?? null, createdAt);
  return { personId, issueId, note: masked, createdAt };
}

export function clearPersonIssueConcernAck(personId: string, issueId: string): void {
  getDb()
    .prepare(`DELETE FROM person_issue_concern_acks WHERE person_id = ? AND issue_id = ?`)
    .run(personId, issueId);
}

export function listPersonIssueConcernAcks(personId: string): PersonIssueConcernAck[] {
  const rows = getDb()
    .prepare(`SELECT * FROM person_issue_concern_acks WHERE person_id = ?`)
    .all(personId) as Row[];
  return rows.map(rowToAck);
}

/** この人物について、確認済み（対応不要）のIssue IDの集合。 */
export function listAcknowledgedIssueIds(personId: string): Set<string> {
  return new Set(listPersonIssueConcernAcks(personId).map((a) => a.issueId));
}

export function toPersonIssueConcernAckView(ack: PersonIssueConcernAck): PersonIssueConcernAck {
  return { ...ack, note: ack.note !== undefined ? unmaskNames(ack.note) : undefined };
}
