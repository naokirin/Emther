import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import { cosineSimilarity } from "@/lib/embeddings";

// docs/memo.md「H: 永続化データモデルの設計」の中核。ユーザー方針:
// 「組織・人・システムは時系列で一貫せず、方針転換・一時的感情・環境変化を多く受ける前提で
//  ナレッジをデータ化する必要がある」への対応。「上書きされるデータベース」ではなく、
// 状態の変化を履歴として蓄積するイベントソーシング＋バイテンポラル（実世界でいつ真だったか
// occurredAt／システムがいつ記録したか recordedAt）のモデルを採用する。
//
// ファクトと解釈の分離:
//   kind: "fact"           = 起きた出来事そのもの（例: 「Aさんが『辞めたい』と言った」）
//   kind: "interpretation" = そこから導いた長期的な解釈（例: 「Aさんはリーダー志向がある」）
// context（公式方針か、雑談か、一時的な不満か）とttlDays（現在の判断にどれだけの期間
// 重みを持たせるか）をすべてのイベントに付与する。ttlDaysが無い＝長期有効（解釈・公式方針等）。
// 重要: イベントは削除しない。ttlDaysは「重み」の話であり「履歴からの消去」の話ではない。

export type KnowledgeKind = "fact" | "interpretation";
export type KnowledgeContext = "official" | "observation" | "casual" | "complaint" | "profile";
export type KnowledgeEntityType = "journal" | "person" | "team" | "issue" | "org";

export type KnowledgeEvent = {
  id: string;
  kind: KnowledgeKind;
  context: KnowledgeContext;
  entityType: KnowledgeEntityType;
  // Issue/Teamの変更履歴（Phase 2）のように、特定の1エンティティ（issueId/teamId）を
  // 一意に指す必要がある場合に使う。人物についてのイベント（peopleで名前を持つ）とは
  // 直交する概念なので、両方が同時に埋まることもある（例: 「issueにAさんの名前が言及された」）。
  entityId?: string;
  people: string[];
  text: string;
  tags: string[];
  urgency?: "low" | "mid" | "high";
  sentiment?: "positive" | "negative" | "neutral";
  summary?: string;
  occurredAt: number;
  recordedAt: number;
  ttlDays?: number;
  supersedes?: string;
  sourceJournalId?: string;
  // docs/memo.md「H: Phase 3」ローカル完結のベクトル検索用。@/lib/embeddingsで生成した
  // 埋め込みベクトル。Issue/Teamの変更履歴等、意味的検索の対象外のイベントには付与しない。
  embedding?: number[];
};

export type NewKnowledgeEvent = Omit<KnowledgeEvent, "id" | "recordedAt"> & {
  id?: string;
  recordedAt?: number;
};

type Row = {
  id: string;
  kind: string;
  context: string;
  entity_type: string;
  entity_id: string | null;
  people_json: string;
  text: string;
  tags_json: string;
  urgency: string | null;
  sentiment: string | null;
  summary: string | null;
  occurred_at: number;
  recorded_at: number;
  ttl_days: number | null;
  supersedes: string | null;
  source_journal_id: string | null;
  embedding_json: string | null;
};

function rowToEvent(row: Row): KnowledgeEvent {
  return {
    id: row.id,
    kind: row.kind as KnowledgeKind,
    context: row.context as KnowledgeContext,
    entityType: row.entity_type as KnowledgeEntityType,
    entityId: row.entity_id ?? undefined,
    people: JSON.parse(row.people_json),
    text: row.text,
    tags: JSON.parse(row.tags_json),
    urgency: (row.urgency as KnowledgeEvent["urgency"]) ?? undefined,
    sentiment: (row.sentiment as KnowledgeEvent["sentiment"]) ?? undefined,
    summary: row.summary ?? undefined,
    occurredAt: row.occurred_at,
    recordedAt: row.recorded_at,
    ttlDays: row.ttl_days ?? undefined,
    supersedes: row.supersedes ?? undefined,
    sourceJournalId: row.source_journal_id ?? undefined,
    embedding: row.embedding_json ? JSON.parse(row.embedding_json) : undefined,
  };
}

export function recordEvent(input: NewKnowledgeEvent): KnowledgeEvent {
  const event: KnowledgeEvent = {
    ...input,
    id: input.id ?? randomUUID(),
    recordedAt: input.recordedAt ?? Date.now(),
  };
  getDb()
    .prepare(
      `INSERT INTO knowledge_events
        (id, kind, context, entity_type, entity_id, people_json, text, tags_json, urgency, sentiment, summary, occurred_at, recorded_at, ttl_days, supersedes, source_journal_id, embedding_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      event.id,
      event.kind,
      event.context,
      event.entityType,
      event.entityId ?? null,
      JSON.stringify(event.people),
      event.text,
      JSON.stringify(event.tags),
      event.urgency ?? null,
      event.sentiment ?? null,
      event.summary ?? null,
      event.occurredAt,
      event.recordedAt,
      event.ttlDays ?? null,
      event.supersedes ?? null,
      event.sourceJournalId ?? null,
      event.embedding ? JSON.stringify(event.embedding) : null,
    );
  return event;
}

export function listEvents(filter?: { entityType?: KnowledgeEntityType; kind?: KnowledgeKind }): KnowledgeEvent[] {
  const conditions: string[] = [];
  const params: string[] = [];
  if (filter?.entityType) {
    conditions.push("entity_type = ?");
    params.push(filter.entityType);
  }
  if (filter?.kind) {
    conditions.push("kind = ?");
    params.push(filter.kind);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = getDb()
    .prepare(`SELECT * FROM knowledge_events ${where} ORDER BY occurred_at DESC`)
    .all(...params) as unknown as Row[];
  return rows.map(rowToEvent);
}

// TTL切れかどうかの判定。ttlDaysが無い場合は常にfalse（＝常に有効＝長期解釈・公式方針）。
export function isEventExpired(event: KnowledgeEvent, now = Date.now()): boolean {
  if (event.ttlDays === undefined) return false;
  return event.occurredAt + event.ttlDays * 24 * 60 * 60 * 1000 < now;
}

// 特定の人物に関する「今も重みを持つファクト」。TTL切れのものは除外する
// （削除はしない＝listEvents()で全履歴は引き続き参照可能）。
export function listActiveFactsForPerson(name: string, limit = 5): KnowledgeEvent[] {
  return listEvents({ kind: "fact" })
    .filter((e) => e.people.includes(name) && !isEventExpired(e))
    .slice(0, limit);
}

// 特定の人物に関する長期的な解釈（プロファイル）。TTLの概念上、基本的に常に有効。
export function listInterpretationsForPerson(name: string): KnowledgeEvent[] {
  return listEvents({ kind: "interpretation" }).filter((e) => e.people.includes(name));
}

// docs/memo.md「H: Phase 2」対応。Issue/Teamの変更履歴を1つのentityId単位で取得する。
export function listEventsForEntity(entityType: KnowledgeEntityType, entityId: string): KnowledgeEvent[] {
  return listEvents({ entityType }).filter((e) => e.entityId === entityId);
}

// Issue/Teamの変更履歴（Phase 2）記録用の薄いヘルパー。変更は「起きた出来事そのもの」
// なのでkind:"fact"、組織の管理された状態変化なのでcontext:"official"で固定する。
// 変更履歴は削除・上書きされるべきでない永続的な監査証跡のためttlDaysは付けない。
export function recordChangeEvent(entityType: "issue" | "team", entityId: string, text: string, tags: string[] = []): void {
  recordEvent({
    kind: "fact",
    context: "official",
    entityType,
    entityId,
    people: [],
    text,
    tags,
    occurredAt: Date.now(),
  });
}

// docs/memo.md「H: Phase 3」ローカル完結の意味的検索。埋め込みを持つイベントに限定して
// ブルートフォースでコサイン類似度を計算し、上位を返す。単一ローカルユーザー規模
// （数百万件に達するには何年もかかる想定）ではこれで十分高速なため、専用のベクトル
// インデックス（sqlite-vec等）は導入しない。TTL切れのfactは除外する（意味的に近くても、
// 現在の判断への重みを失った一時的な情報を混ぜないため）。
export function searchSimilarEvents(
  queryEmbedding: number[],
  opts?: { kind?: KnowledgeKind; limit?: number; excludeExpired?: boolean },
): Array<KnowledgeEvent & { similarity: number }> {
  const limit = opts?.limit ?? 5;
  const candidates = listEvents({ kind: opts?.kind }).filter((e) => e.embedding !== undefined);
  const scored = candidates
    .filter((e) => !(opts?.excludeExpired ?? true) || !isEventExpired(e))
    .map((e) => ({ ...e, similarity: cosineSimilarity(queryEmbedding, e.embedding!) }))
    .sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, limit);
}
