import { cosineSimilarity, embedText } from "./embeddings";
import { unmaskNames } from "./people-directory";
import { listActiveWorldModelElements, type WorldModelElement } from "./world-model-store";

// prompt を膨らませないため、索引は持たず関連の強い少数だけを全文で載せる。
const FULL_INJECT_LIMIT = 5;
const RELEVANT_LIMIT = 4;
const FALLBACK_PINNED_LIMIT = 3;
const STATEMENT_MAX_CHARS = 200;
// related-context の RELATED_SIMILARITY_THRESHOLD と同じ値（同モデルで検証済みの閾値）。
const SIMILARITY_THRESHOLD = 0.4;

// 要素は編集で updatedAt が変わるため、ID+updatedAt をキーにして再計算を最小にする。
const embeddingCache = new Map<string, number[]>();

async function embeddingOf(e: WorldModelElement): Promise<number[]> {
  const key = `${e.id}:${e.updatedAt}`;
  const hit = embeddingCache.get(key);
  if (hit) return hit;
  // 保存はマスク済みだが、クエリは実名のため、意味空間を揃えて unmask してから埋め込む（related-context と同じ）。
  const v = await embedText(unmaskNames(`${e.title}\n${e.statement}`));
  embeddingCache.set(key, v);
  return v;
}

async function pickRelevant(active: WorldModelElement[], queryText: string): Promise<WorldModelElement[]> {
  const query = queryText.trim();
  if (query) {
    try {
      const q = await embedText(query);
      const scored: Array<{ e: WorldModelElement; score: number }> = [];
      for (const e of active) {
        scored.push({ e, score: cosineSimilarity(q, await embeddingOf(e)) });
      }
      const hits = scored
        .filter((s) => s.score >= SIMILARITY_THRESHOLD)
        .sort((a, b) => b.score - a.score)
        .slice(0, RELEVANT_LIMIT)
        .map((s) => s.e);
      return hits;
    } catch {
      // 埋め込みが使えないときは固定済みだけを載せる。
    }
  }
  return pinnedFallback(active);
}

function pinnedFallback(active: WorldModelElement[]): WorldModelElement[] {
  return active
    .filter((e) => e.status === "pinned")
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, FALLBACK_PINNED_LIMIT);
}

function fullLine(e: WorldModelElement): string {
  const parts = [`- [${e.id}] (${e.kind}${e.status === "pinned" ? "/固定" : ""}) ${e.title}: ${e.statement.slice(0, STATEMENT_MAX_CHARS)}`];
  if (e.relationship) {
    const { parties, aspect, stance } = e.relationship;
    parts.push(`  関係: ${parties.map((p) => p.id).join(" ↔ ")}（${aspect}/${stance}）`);
  }
  if (e.userNote) parts.push(`  EMの注釈: ${e.userNote}`);
  return parts.join("\n");
}

/**
 * 採用済み・固定の組織モデル要素をシステムプロンプト用に整形する。
 * 少数なら全件、多数ならクエリに関連する少数のみ（索引は持たず、要素の増加に耐える）。
 * stale は前提として注入しない。
 */
export async function buildWorldModelContextBlock(queryText: string): Promise<string> {
  const active = listActiveWorldModelElements();
  if (active.length === 0) return "";

  const header = [
    "組織モデル（EMが採用・固定した、EMから観測できる範囲の組織の実態の見立て。分析の前提として使い、新しい観測がこれと食い違うときは食い違いとして明示すること）:",
    "提案が組織モデルの要素に基づく・食い違う場合は、proposalブロックに worldModelRefs（下記[ID]の配列）を付けてください。",
  ];

  const picked = active.length <= FULL_INJECT_LIMIT ? active : await pickRelevant(active, queryText);
  if (picked.length === 0) return "";
  const omitted = active.length - picked.length;
  return [
    ...header,
    ...picked.map(fullLine),
    ...(omitted > 0 ? [`（他に ${omitted} 件の要素があるが、この件との関連が弱いため省略）`] : []),
  ].join("\n");
}

/** Journal 起点の run は、日次で EM の確認負荷が増えないよう食い違いと新規だけを返す（蒸留は全種類）。 */
export const JOURNAL_WORLD_MODEL_ACTIONS = ["contradict", "new"] as const;
const JOURNAL_NEW_LIMIT = 2;

export function isJournalWorldModelOrigin(origin: string | undefined): boolean {
  return origin === "auto-anomaly" || origin === "auto-journal-batch";
}

export function filterJournalWorldModelChanges<T extends { action: string }>(changes: T[]): T[] {
  const allowed = changes.filter((c) => (JOURNAL_WORLD_MODEL_ACTIONS as readonly string[]).includes(c.action));
  let news = 0;
  return allowed.filter((c) => c.action !== "new" || ++news <= JOURNAL_NEW_LIMIT);
}

export function buildJournalWorldModelInstruction(): string {
  return [
    "組織モデルとの差分（任意）: この Journal が上記の組織モデル要素と食い違う場合だけ action=contradict で、targetId に[ID]・reason・必要なら置き換え案 statement を返してください。",
    "既存要素に当てはまらない実態が複数の観測で繰り返し見えるときだけ action=new（kind・title・statement・reason）を最大2件まで。裏付け（confirm）や単発の出来事は返さないこと。",
    "人物は PERSON_n のまま、個人の能力・性格の評価は書かず、関係や状況の描写に限る。該当が無ければブロック自体を省略してよい。",
    "```world-model",
    '[{ "action": "contradict", "targetId": "…", "reason": "…", "statement": "…", "evidenceJournalIds": [] }]',
    "```",
  ].join("\n");
}
