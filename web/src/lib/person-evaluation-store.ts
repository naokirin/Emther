import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import { maskForStorage, unmaskNames } from "@/lib/people-directory";
import { listObjectives, getOrgStrategy, type Objective } from "@/lib/org-context-store";
import { listActiveFactsForPerson } from "@/lib/knowledge-store";
import { cosineSimilarity, embedText } from "@/lib/embeddings";
import { RELATED_SIMILARITY_THRESHOLD } from "@/lib/related-context";

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
  // ユーザー指摘「確認したが対応不要だった、を示せず懸念の強調を減らせない」対応。
  // polarity（AIが検出した当初の判定）は書き換えず、EMが確認して対応不要と判断した
  // 事実だけを別途持たせる。statusの確定/仮置き/破棄とは独立（破棄は記録自体を隠す操作、
  // これは「懸念としての強調」だけを弱める操作）。
  noActionNeededAt?: number;
  noActionNeededNote?: string;
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
  no_action_needed_at: number | null;
  no_action_needed_note: string | null;
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
    noActionNeededAt: row.no_action_needed_at ?? undefined,
    noActionNeededNote: row.no_action_needed_note ?? undefined,
  };
}

export function toEvaluationLogView(log: PersonEvaluationLog): PersonEvaluationLog {
  return {
    ...log,
    snapshotText: unmaskNames(log.snapshotText),
    rationale: unmaskNames(log.rationale),
    valueSnapshot: log.valueSnapshot !== undefined ? unmaskNames(log.valueSnapshot) : undefined,
    noActionNeededNote: log.noActionNeededNote !== undefined ? unmaskNames(log.noActionNeededNote) : undefined,
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

/**
 * ユーザー指摘「懸念(polarity: concern)を確認したが対応不要だった、を示せず強調を
 * 減らせない」対応。polarity自体（AIが当初検出した判定）は書き換えず、EMの確認結果だけを
 * 別軸に記録する。noteは任意の自由記述（人物名を含み得るため保存前にmaskForStorageを通す）。
 */
export async function setEvaluationLogNoActionNeeded(id: string, note?: string): Promise<PersonEvaluationLog | undefined> {
  const log = getEvaluationLog(id);
  if (!log) return undefined;
  const now = Date.now();
  const trimmed = note?.trim();
  const masked = trimmed ? await maskForStorage(trimmed) : undefined;
  getDb()
    .prepare(`UPDATE person_evaluation_logs SET no_action_needed_at = ?, no_action_needed_note = ? WHERE id = ?`)
    .run(now, masked ?? null, id);
  return { ...log, noActionNeededAt: now, noActionNeededNote: masked };
}

export function clearEvaluationLogNoActionNeeded(id: string): PersonEvaluationLog | undefined {
  const log = getEvaluationLog(id);
  if (!log) return undefined;
  getDb()
    .prepare(`UPDATE person_evaluation_logs SET no_action_needed_at = NULL, no_action_needed_note = NULL WHERE id = ?`)
    .run(id);
  return { ...log, noActionNeededAt: undefined, noActionNeededNote: undefined };
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

type ObjectiveMatch = {
  objectiveId: string;
  objectiveTitle: string;
  keyResultId?: string;
  embedding: number[];
};

/** Objective/KeyResultごとに埋め込みを作り、Factとの意味的な照合対象にする。 */
async function buildObjectiveMatches(objectives: Objective[]): Promise<ObjectiveMatch[]> {
  const matches: ObjectiveMatch[] = [];
  for (const o of objectives) {
    if (o.keyResults.length === 0) {
      try {
        matches.push({
          objectiveId: o.id,
          objectiveTitle: o.title,
          embedding: await embedText([o.title, o.note].filter(Boolean).join(" ")),
        });
      } catch {
        // 埋め込み失敗時はこのObjectiveを照合対象から外す（関連性を確認できないため）
      }
      continue;
    }
    for (const kr of o.keyResults) {
      try {
        matches.push({
          objectiveId: o.id,
          objectiveTitle: o.title,
          keyResultId: kr.id,
          embedding: await embedText(`${o.title} ${kr.title}`),
        });
      } catch {
        // 同上
      }
    }
  }
  return matches;
}

type ValueMatch = { text: string; embedding: number[] };

/** Values は複数の価値観が1つの自由記述にまとまっているため、行単位に割ってから照合する。 */
function splitValueItems(valuesText: string): string[] {
  return valuesText
    .split(/\r?\n/)
    .map((line) => line.replace(/^[\s\-*・•]+/, "").trim())
    .filter((line) => line.length > 0);
}

async function buildValueMatches(valuesText: string): Promise<ValueMatch[]> {
  const matches: ValueMatch[] = [];
  for (const text of splitValueItems(valuesText)) {
    try {
      matches.push({ text, embedding: await embedText(text) });
    } catch {
      // 埋め込み失敗時はこの価値観を照合対象から外す
    }
  }
  return matches;
}

function bestMatch<T extends { embedding: number[] }>(
  factEmbedding: number[],
  candidates: T[],
): (T & { similarity: number }) | undefined {
  return candidates
    .map((c) => ({ ...c, similarity: cosineSimilarity(factEmbedding, c.embedding) }))
    .sort((a, b) => b.similarity - a.similarity)[0];
}

/**
 * Journal 事実から A/B 仮置きログをヒューリスティック生成。
 * AI 本格推定の置き場。断定せず rationale に根拠を残す。
 *
 * ユーザー指摘「単に紐づくものを引っ張ってくるだけになっている」対応。以前は対象の
 * Journal事実を無条件に「先頭のObjective」「Values全文」へ仮置きしていたため、実際には
 * 無関係な事実まで拾われていた。今はFactの埋め込みとObjective/KeyResult・Valuesの
 * 各項目の埋め込みを意味的に照合し、一定の類似度（RELATED_SIMILARITY_THRESHOLD、
 * 関連Issue/Journal検索と同じ基準）を超えたものだけを仮置きする。埋め込みが無いFact
 * （生成失敗）は関連性を確認できないためスキップする。
 */
export async function suggestEvaluationLogsFromRecentJournals(
  personId: string,
  _personName: string,
  opts: { limit?: number } = {},
): Promise<PersonEvaluationLog[]> {
  const limit = opts.limit ?? 20;
  const facts = listActiveFactsForPerson(personId, limit);

  const objectiveMatches = await buildObjectiveMatches(listObjectives());
  const valuesText = getOrgStrategy().values?.trim() || undefined;
  const valueMatches = valuesText ? await buildValueMatches(valuesText) : [];

  const created: PersonEvaluationLog[] = [];

  for (const fact of facts) {
    const journalId = fact.sourceJournalId ?? fact.id;
    const excerpt = (fact.summary || fact.text || "").trim().slice(0, 280);
    // 埋め込みが無いFactは意味的な関連性を確認できないため、確度不明の仮置きはしない。
    if (!excerpt || !fact.embedding) continue;

    const concern =
      /懸念|不安|乖離|問題|炎上|離職|バーン|遅延|対立|ミス/.test(excerpt) || fact.sentiment === "negative";

    if (!alreadyLogged(personId, journalId, "outcome")) {
      const match = bestMatch(fact.embedding, objectiveMatches);
      if (match && match.similarity >= RELATED_SIMILARITY_THRESHOLD) {
        const log = await createEvaluationLog({
          personId,
          lens: "outcome",
          polarity: concern ? "concern" : "positive",
          sourceJournalId: journalId,
          targetObjectiveId: match.objectiveId,
          targetKeyResultId: match.keyResultId,
          snapshotText: excerpt,
          rationale: `Journal の事実を、Objective「${match.objectiveTitle}」への貢献候補として仮置き（意味的関連度 ${match.similarity.toFixed(2)}・要レビュー）`,
        });
        created.push(log);
      }
    }

    if (!alreadyLogged(personId, journalId, "value")) {
      const match = bestMatch(fact.embedding, valueMatches);
      if (match && match.similarity >= RELATED_SIMILARITY_THRESHOLD) {
        const log = await createEvaluationLog({
          personId,
          lens: "value",
          polarity: concern ? "concern" : "positive",
          sourceJournalId: journalId,
          valueSnapshot: match.text,
          snapshotText: excerpt,
          rationale: `Journal の言動を Values「${match.text.slice(0, 40)}」適合の候補として仮置き（意味的関連度 ${match.similarity.toFixed(2)}・要レビュー。監視チェックリスト化しない）`,
        });
        created.push(log);
      }
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
