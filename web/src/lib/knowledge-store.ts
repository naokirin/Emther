import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import { cosineSimilarity } from "@/lib/embeddings";
import { unmaskNames } from "@/lib/people-directory";

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
  // 個人情報の分離（ユーザー指摘対応）: 実名ではなくpeople-directory.tsが発行する
  // `PERSON_n` IDを保持する（recordEvent呼び出し側が保存前に変換する）。text/summaryも
  // 同様にPERSON_n IDでマスクした状態で保存する。実名への復元はtoEventView()を通す。
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
  // docs/em_human_story_and_ux.md 改修依頼対応。urgencyは「起きた出来事自体の深刻さ」の
  // 記録として書き換えない一方、「今どこで管理されているか」を別軸として持たせる
  // （Journal専用の概念だが、他のentityTypeで使っても害はないため型を分けない）。
  resolvedIssueId?: string;
  resolutionNote?: string;
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
  resolved_issue_id: string | null;
  resolution_note: string | null;
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
    resolvedIssueId: row.resolved_issue_id ?? undefined,
    resolutionNote: row.resolution_note ?? undefined,
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
        (id, kind, context, entity_type, entity_id, people_json, text, tags_json, urgency, sentiment, summary, occurred_at, recorded_at, ttl_days, supersedes, source_journal_id, embedding_json, resolved_issue_id, resolution_note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      event.resolvedIssueId ?? null,
      event.resolutionNote ?? null,
    );
  return event;
}

// docs/memo.md「C. Journalセンシング→行動」対応。イベントソーシング（イベントは削除・
// 上書きしない）を保ったまま「その場微修正」を実現するため、既存イベントを1件取得し、
// supersedesで新イベントに繋ぐための参照用途。
export function getEventById(id: string): KnowledgeEvent | undefined {
  const row = getDb().prepare("SELECT * FROM knowledge_events WHERE id = ?").get(id) as Row | undefined;
  return row ? rowToEvent(row) : undefined;
}

// supersedes チェーンの先頭（いま一覧に出る版）を返す。生成元リンクが古い版の ID を
// 指していても、EM が開く先は現行エントリである必要がある。
export function getEventHeadById(id: string): KnowledgeEvent | undefined {
  let current = getEventById(id);
  if (!current) return undefined;
  const stmt = getDb().prepare(
    "SELECT * FROM knowledge_events WHERE supersedes = ? ORDER BY recorded_at DESC LIMIT 1",
  );
  while (true) {
    const next = stmt.get(current.id) as Row | undefined;
    if (!next) return current;
    current = rowToEvent(next);
  }
}

export function listEventLineageIds(id: string): string[] {
  const start = getEventById(id);
  if (!start) return [];
  let root = start;
  const seen = new Set<string>([root.id]);
  while (root.supersedes) {
    const prev = getEventById(root.supersedes);
    if (!prev || seen.has(prev.id)) break;
    seen.add(prev.id);
    root = prev;
  }
  const ids = [root.id];
  let current = root;
  const stmt = getDb().prepare(
    "SELECT * FROM knowledge_events WHERE supersedes = ? ORDER BY recorded_at DESC LIMIT 1",
  );
  while (true) {
    const next = stmt.get(current.id) as Row | undefined;
    if (!next) return ids;
    const event = rowToEvent(next);
    if (ids.includes(event.id)) return ids;
    ids.push(event.id);
    current = event;
  }
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
  // occurred_atが同値（例: 「まとめて記録する」で同日イベントが同じ正午時刻を
  // 共有するケース）の場合、recorded_at（記録した実時刻）で降順のタイブレークを
  // かけないと、SQLiteの不定順（実質的に古い順）で返り、新しく登録した方が
  // 一覧の下に来てしまう。
  const rows = getDb()
    .prepare(`SELECT * FROM knowledge_events ${where} ORDER BY occurred_at DESC, recorded_at DESC`)
    .all(...params) as unknown as Row[];
  return rows.map(rowToEvent);
}

// ユーザー指摘「一覧の全件取得をページネーション化したい」対応。値そのものをSQL文字列へ
// 連結することはない（常にbind parameter経由）が、LIKEのワイルドカード文字（%・_）は
// 値の中に含まれると意図しない部分一致を起こすため、リテラルとして扱うためにエスケープする。
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export type EventPageFilter = {
  entityType?: KnowledgeEntityType;
  kind?: KnowledgeKind;
  // 自由記述検索（text/summary/tags_json/people_jsonへの部分一致）。text/people_jsonは
  // PERSON_n IDでマスクされた状態で保存されているため、呼び出し側（journal-store.ts）が
  // 検索語を渡す前にmaskNamesで変換しておくこと。
  textQuery?: string;
  // タグ・人物の完全一致フィルタ（JSON配列内の要素として存在するか）。personExactは
  // PERSON_n ID、tagExactはマスク後のタグ文字列を渡すこと（textQueryと同じ理由）。
  tagExact?: string;
  personExact?: string;
  urgency?: string;
  sentiment?: string;
  occurredAtFrom?: number;
  excludeResolved?: boolean;
  excludeSuperseded?: boolean;
};

function buildEventPageWhere(filter: EventPageFilter): { where: string; params: (string | number)[] } {
  const conditions: string[] = [];
  const params: (string | number)[] = [];
  if (filter.entityType) {
    conditions.push("entity_type = ?");
    params.push(filter.entityType);
  }
  if (filter.kind) {
    conditions.push("kind = ?");
    params.push(filter.kind);
  }
  if (filter.urgency) {
    conditions.push("urgency = ?");
    params.push(filter.urgency);
  }
  if (filter.sentiment) {
    conditions.push("sentiment = ?");
    params.push(filter.sentiment);
  }
  if (filter.occurredAtFrom !== undefined) {
    conditions.push("occurred_at >= ?");
    params.push(filter.occurredAtFrom);
  }
  if (filter.textQuery) {
    const like = `%${escapeLike(filter.textQuery)}%`;
    conditions.push("(text LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\' OR tags_json LIKE ? ESCAPE '\\' OR people_json LIKE ? ESCAPE '\\')");
    params.push(like, like, like, like);
  }
  if (filter.tagExact) {
    conditions.push("tags_json LIKE ? ESCAPE '\\'");
    params.push(`%"${escapeLike(filter.tagExact)}"%`);
  }
  if (filter.personExact) {
    conditions.push("people_json LIKE ? ESCAPE '\\'");
    params.push(`%"${escapeLike(filter.personExact)}"%`);
  }
  if (filter.excludeResolved) {
    conditions.push("resolved_issue_id IS NULL AND (resolution_note IS NULL OR resolution_note = '')");
  }
  if (filter.excludeSuperseded) {
    conditions.push("id NOT IN (SELECT supersedes FROM knowledge_events WHERE supersedes IS NOT NULL)");
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return { where, params };
}

// ユーザー指摘「一覧の全件取得をページネーション化したい」対応。listEvents()は常に全件を
// 返すため、件数が増えるほどAPIレスポンス・パース・マスク処理のコストが線形に増加する。
// こちらはWHERE句・LIMIT/OFFSETをSQL側で組み立て、該当ページ分の行と総件数だけを返す。
export function listEventsPage(
  filter: EventPageFilter,
  opts: { limit: number; offset: number },
): { events: KnowledgeEvent[]; total: number } {
  const { where, params } = buildEventPageWhere(filter);
  const totalRow = getDb().prepare(`SELECT COUNT(*) as c FROM knowledge_events ${where}`).get(...params) as { c: number };
  const rows = getDb()
    .prepare(`SELECT * FROM knowledge_events ${where} ORDER BY occurred_at DESC, recorded_at DESC LIMIT ? OFFSET ?`)
    .all(...params, opts.limit, opts.offset) as unknown as Row[];
  return { events: rows.map(rowToEvent), total: totalRow.c };
}

// ユーザー指摘「Dashboardから特定のJournalエントリへ直接飛ぶ深いリンクを、ページネーション後も
// 保ちたい」対応。対象イベントが、同じfilter・並び順（occurred_at DESC, recorded_at DESC）の
// 何件目（0-indexed）に位置するかを1クエリで求める。クライアント側で全件を走査してインデックスを
// 探す必要をなくす。
export function findEventOffset(target: { occurredAt: number; recordedAt: number }, filter: EventPageFilter): number {
  const { where, params } = buildEventPageWhere(filter);
  const orderCondition = "(occurred_at > ? OR (occurred_at = ? AND recorded_at > ?))";
  const combinedWhere = where ? `${where} AND ${orderCondition}` : `WHERE ${orderCondition}`;
  const row = getDb()
    .prepare(`SELECT COUNT(*) as c FROM knowledge_events ${combinedWhere}`)
    .get(...params, target.occurredAt, target.occurredAt, target.recordedAt) as { c: number };
  return row.c;
}

// ユーザー指摘「一覧の全件取得をページネーション化したい」対応。絞り込みドロップダウン
// （タグ・人物）の選択肢一覧。listEvents()（SELECT *）と違い、tags_json/people_jsonの
// 2カラムだけを読むため、件数が増えても本文・要約等の重いフィールドを読み込まずに済む。
export function listEventFacets(filter: {
  entityType?: KnowledgeEntityType;
  kind?: KnowledgeKind;
  excludeSuperseded?: boolean;
}): { tags: string[]; people: string[] } {
  const conditions: string[] = [];
  const params: string[] = [];
  if (filter.entityType) {
    conditions.push("entity_type = ?");
    params.push(filter.entityType);
  }
  if (filter.kind) {
    conditions.push("kind = ?");
    params.push(filter.kind);
  }
  if (filter.excludeSuperseded) {
    conditions.push("id NOT IN (SELECT supersedes FROM knowledge_events WHERE supersedes IS NOT NULL)");
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = getDb()
    .prepare(`SELECT tags_json, people_json FROM knowledge_events ${where}`)
    .all(...params) as { tags_json: string; people_json: string }[];
  const tags = new Set<string>();
  const people = new Set<string>();
  for (const row of rows) {
    for (const t of JSON.parse(row.tags_json) as string[]) tags.add(t);
    for (const p of JSON.parse(row.people_json) as string[]) people.add(p);
  }
  return { tags: Array.from(tags), people: Array.from(people) };
}

// TTL切れかどうかの判定。ttlDaysが無い場合は常にfalse（＝常に有効＝長期解釈・公式方針）。
export function isEventExpired(event: KnowledgeEvent, now = Date.now()): boolean {
  if (event.ttlDays === undefined) return false;
  return event.occurredAt + event.ttlDays * 24 * 60 * 60 * 1000 < now;
}

// 特定の人物に関する「今も重みを持つファクト」。TTL切れのものは除外する
// （削除はしない＝listEvents()で全履歴は引き続き参照可能）。
// personIdはpeople-directory.tsの`PERSON_n` ID（実名ではない）。
export function listActiveFactsForPerson(personId: string, limit = 5): KnowledgeEvent[] {
  return listEvents({ kind: "fact" })
    .filter((e) => e.people.includes(personId) && !isEventExpired(e))
    .slice(0, limit);
}

// 特定の人物に関する長期的な解釈（プロファイル）。TTLの概念上、基本的に常に有効。
export function listInterpretationsForPerson(personId: string): KnowledgeEvent[] {
  return listEvents({ kind: "interpretation" }).filter((e) => e.people.includes(personId));
}

// 個人情報の分離（ユーザー指摘対応）: 上記の関数群はマスクされた（PERSON_n ID化された）
// テキストを返す内部表現。EM向けのAPI応答を組み立てる境界だけで、この関数を通して
// 実名へ復元する（agent-runtime.tsから呼んではいけない）。
export function toEventView(event: KnowledgeEvent): KnowledgeEvent {
  return {
    ...event,
    text: unmaskNames(event.text),
    summary: event.summary !== undefined ? unmaskNames(event.summary) : event.summary,
    people: event.people.map(unmaskNames),
  };
}

// docs/memo.md「H: Phase 2」対応。Issue/Teamの変更履歴を1つのentityId単位で取得する。
export function listEventsForEntity(entityType: KnowledgeEntityType, entityId: string): KnowledgeEvent[] {
  return listEvents({ entityType }).filter((e) => e.entityId === entityId);
}

// docs/memo.md「N. 時系列変化をEMが読む物語に」対応。特定のentityに絞らず、
// Issue/Team/Objectiveの変更（recordChangeEventで記録されるkind:"fact" context:"official"）
// を横断的に新しい順で返す。Journal（context:"observation"）は含めない
// （「組織の状態がどう変わったか」の物語であり、日々の所感・出来事のログとは別軸）。
export function listRecentChangeEvents(limit = 100): KnowledgeEvent[] {
  return listEvents({ kind: "fact" })
    .filter((e) => e.context === "official")
    .slice(0, limit);
}

// Issue/Team/人物の変更履歴（Phase 2、人物統合は後日追加）記録用の薄いヘルパー。変更は
// 「起きた出来事そのもの」なのでkind:"fact"、組織の管理された状態変化なのでcontext:"official"
// で固定する。変更履歴は削除・上書きされるべきでない永続的な監査証跡のためttlDaysは付けない。
export function recordChangeEvent(
  entityType: "issue" | "team" | "org" | "person",
  entityId: string,
  text: string,
  tags: string[] = [],
): void {
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

// ユーザー要望「誤って複数登録されてしまったメンバーを統合する機能が欲しい」対応。
// people-directory.ts（対応表）の付け替えだけでは不十分で、既にSQLiteへ保存済みの
// KnowledgeEvent（Journalのtext/summary/tags/people、Issueへの解決メモ等）に埋め込まれた
// fromId（PERSON_n）をtoIdへ書き換える必要がある。text/summary/resolution_noteは
// 自由記述への埋め込み置換（同じ文中に元々fromId/toId両方への言及があった場合、
// 書き換え後は同じ人物への言及が重複するだけで、内容としては正しい）。
// tags_json/people_jsonはID配列なので、置換後にtoIdが重複しうる（元々fromId/toId両方が
// 含まれていた場合）ため、配列としてパースし直して重複排除する。
function replaceIdInJsonArray(json: string, pattern: RegExp, toId: string): string {
  const replaced = json.replace(pattern, toId);
  try {
    const arr = JSON.parse(replaced) as string[];
    return JSON.stringify(Array.from(new Set(arr)));
  } catch {
    return replaced;
  }
}

export function reassignPersonId(fromId: string, toId: string): number {
  const pattern = new RegExp(`\\b${fromId}\\b`, "g");
  const rows = getDb()
    .prepare("SELECT id, text, summary, tags_json, people_json, resolution_note FROM knowledge_events")
    .all() as { id: string; text: string; summary: string | null; tags_json: string; people_json: string; resolution_note: string | null }[];
  const stmt = getDb().prepare(
    "UPDATE knowledge_events SET text = ?, summary = ?, tags_json = ?, people_json = ?, resolution_note = ? WHERE id = ?",
  );
  let updated = 0;
  for (const row of rows) {
    const nextText = row.text.replace(pattern, toId);
    const nextSummary = row.summary !== null ? row.summary.replace(pattern, toId) : row.summary;
    const nextTags = replaceIdInJsonArray(row.tags_json, pattern, toId);
    const nextPeople = replaceIdInJsonArray(row.people_json, pattern, toId);
    const nextNote = row.resolution_note !== null ? row.resolution_note.replace(pattern, toId) : row.resolution_note;
    if (
      nextText !== row.text ||
      nextSummary !== row.summary ||
      nextTags !== row.tags_json ||
      nextPeople !== row.people_json ||
      nextNote !== row.resolution_note
    ) {
      stmt.run(nextText, nextSummary, nextTags, nextPeople, nextNote, row.id);
      updated++;
    }
  }
  return updated;
}

type SearchCandidateRow = {
  id: string;
  occurred_at: number;
  ttl_days: number | null;
  embedding_json: string;
};

// 意味的検索のスコアリング用。text/summary 等の重い列は読まず、embedding だけを走査する。
function listSearchCandidateRows(filter?: { kind?: KnowledgeKind }): SearchCandidateRow[] {
  const conditions = ["embedding_json IS NOT NULL"];
  const params: string[] = [];
  if (filter?.kind) {
    conditions.push("kind = ?");
    params.push(filter.kind);
  }
  const where = `WHERE ${conditions.join(" AND ")}`;
  return getDb()
    .prepare(`SELECT id, occurred_at, ttl_days, embedding_json FROM knowledge_events ${where}`)
    .all(...params) as SearchCandidateRow[];
}

function isSearchCandidateExpired(row: SearchCandidateRow, now = Date.now()): boolean {
  if (row.ttl_days === null) return false;
  return row.occurred_at + row.ttl_days * 24 * 60 * 60 * 1000 < now;
}

function getEventsByIds(ids: string[]): KnowledgeEvent[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(", ");
  const rows = getDb()
    .prepare(`SELECT * FROM knowledge_events WHERE id IN (${placeholders})`)
    .all(...ids) as Row[];
  const byId = new Map(rows.map((row) => [row.id, rowToEvent(row)]));
  return ids.map((id) => byId.get(id)).filter((e): e is KnowledgeEvent => e !== undefined);
}

// docs/memo.md「H: Phase 3」ローカル完結の意味的検索。埋め込みを持つイベントに限定して
// ブルートフォースでコサイン類似度を計算し、上位を返す。単一ローカルユーザー規模
// （数百万件に達するには何年もかかる想定）ではこれで十分高速なため、専用のベクトル
// インデックス（sqlite-vec等）は導入しない。TTL切れのfactは除外する（意味的に近くても、
// 現在の判断への重みを失った一時的な情報を混ぜないため）。
// スコアリングは embedding 列だけを読み、上位候補の本文等は結果確定後にまとめて取得する。
export function searchSimilarEvents(
  queryEmbedding: number[],
  opts?: { kind?: KnowledgeKind; limit?: number; excludeExpired?: boolean },
): Array<KnowledgeEvent & { similarity: number }> {
  const limit = opts?.limit ?? 5;
  const excludeExpired = opts?.excludeExpired ?? true;
  const scored: Array<{ id: string; similarity: number }> = [];
  for (const row of listSearchCandidateRows({ kind: opts?.kind })) {
    if (excludeExpired && isSearchCandidateExpired(row)) continue;
    const embedding = JSON.parse(row.embedding_json) as number[];
    scored.push({ id: row.id, similarity: cosineSimilarity(queryEmbedding, embedding) });
  }
  scored.sort((a, b) => b.similarity - a.similarity);
  const top = scored.slice(0, limit);
  const similarityById = new Map(top.map((item) => [item.id, item.similarity]));
  return getEventsByIds(top.map((item) => item.id)).map((event) => ({
    ...event,
    similarity: similarityById.get(event.id)!,
  }));
}
