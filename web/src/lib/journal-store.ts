import { randomUUID } from "node:crypto";
import { extractFirstJsonObject, runLocalChat } from "@/lib/local-model";
import { maskForStorage, maskNames, registerName, unmaskNames } from "@/lib/people-directory";
import { recordEvent, listEvents, getEventById, type KnowledgeEvent } from "@/lib/knowledge-store";
import { embedText } from "@/lib/embeddings";
import { getRulesAndConstraints } from "@/lib/settings-store";
import { startRun } from "@/lib/agent-runtime";

// 重要: ジャーナルには人名・心情などの機微情報が含まれうるため、この抽出処理は
// 外部サービス（claude -p を含む）に一切送信せず、完全にローカル（Transformers.js / WASM,
// ONNX Runtime）で完結させる。docs 3.2「サニタイズ（秘匿化）」および業務要求3「情報の壁と
// セキュリティ」に対応するための必須要件であり、コストや速度のための最適化ではない。
// 抽出したpeopleはpeople-directory.tsに登録し、Agent Runtime（クラウド）に送る際の
// 匿名化（docs/memo.md）に再利用する。
//
// 永続化: docs/memo.md「H: 永続化データモデルの設計」対応で、Journalの投稿は
// `knowledge-store.ts`のKnowledgeEvent（kind: "fact", entityType: "journal"）として
// SQLiteに記録する（`journal.json`という別ファイルへの二重管理はしない）。
// JournalEntryはそのfactイベントをUI/Agent Runtime向けの形に変換したビューでしかない。

export type Urgency = "low" | "mid" | "high";
export type Sentiment = "positive" | "negative" | "neutral";

export type JournalEntry = {
  id: string;
  rawText: string;
  tags: string[];
  people: string[];
  urgency: Urgency;
  sentiment: Sentiment;
  summary: string;
  createdAt: number;
};

// 個人情報の分離（ユーザー指摘対応）: KnowledgeEventのtext/summary/peopleはPERSON_n ID
// でマスクされた内部表現。これはそのマスクされた状態のJournalEntryを返す（agent-runtime.ts
// 等、内部利用向け）。EM向けの表示にはtoJournalEntryView()を使うこと。
function eventToJournalEntry(e: KnowledgeEvent): JournalEntry {
  return {
    id: e.id,
    rawText: e.text,
    tags: e.tags,
    people: e.people,
    urgency: (e.urgency as Urgency) ?? "mid",
    sentiment: (e.sentiment as Sentiment) ?? "neutral",
    summary: e.summary ?? "",
    createdAt: e.occurredAt,
  };
}

export function toJournalEntryView(entry: JournalEntry): JournalEntry {
  return {
    ...entry,
    rawText: unmaskNames(entry.rawText),
    summary: unmaskNames(entry.summary),
    people: entry.people.map(unmaskNames),
    tags: entry.tags.map(unmaskNames),
  };
}

const SYSTEM_PROMPT = [
  "あなたはメモから情報を抽出し、JSONだけを出力するツールです。説明や前置きは一切書かず、JSONオブジェクト1つだけを出力してください。",
  'フォーマット: {"tags": string[], "people": string[], "urgency": "low"|"mid"|"high", "sentiment": "positive"|"negative"|"neutral", "summary": string}',
  "tagsは日本語の短い単語（例: 技術的負債, 1on1）。peopleは文中の人物名（敬称はそのまま、例: Aさん）。",
  "メモに書かれていない情報を推測で埋めないこと。該当が無ければ空配列にすること。",
].join("\n");

// 人物が「いる」例と「いない」例の両方を見せることで、0.5Bモデルがpeopleを
// 空配列に倒しがちな傾向を緩和する。
const FEW_SHOT_EXAMPLES: Array<{ user: string; assistant: string }> = [
  {
    user: "経営会議。Q3のエンタープライズ向けリリース日が2週間前倒しになった。",
    assistant: JSON.stringify({
      tags: ["経営会議", "スケジュール変更"],
      people: [],
      urgency: "high",
      sentiment: "negative",
      summary: "Q3のリリース日が2週間前倒しになった",
    }),
  },
  {
    user: "CさんのPRレビューが非常に速く、品質も良い。褒めた。",
    assistant: JSON.stringify({
      tags: ["PRレビュー", "パフォーマンス"],
      people: ["Cさん"],
      urgency: "low",
      sentiment: "positive",
      summary: "Cさんのレビューが速く高品質だったので褒めた",
    }),
  },
];

function isUrgency(v: unknown): v is Urgency {
  return v === "low" || v === "mid" || v === "high";
}

function isSentiment(v: unknown): v is Sentiment {
  return v === "positive" || v === "negative" || v === "neutral";
}

export async function addJournalEntry(rawText: string): Promise<JournalEntry> {
  const content = await runLocalChat(
    [
      { role: "system", content: SYSTEM_PROMPT },
      ...FEW_SHOT_EXAMPLES.flatMap((ex) => [
        { role: "user" as const, content: ex.user },
        { role: "assistant" as const, content: ex.assistant },
      ]),
      { role: "user", content: rawText },
    ],
    200,
  );

  const jsonText = extractFirstJsonObject(content);
  if (!jsonText) {
    throw new Error("ローカルモデルの出力からJSONを抽出できませんでした");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let structured: any;
  try {
    structured = JSON.parse(jsonText);
  } catch {
    throw new Error("ローカルモデルの出力が不正なJSONでした");
  }

  // 個人情報の分離（ユーザー指摘対応）: peopleはPERSON_n ID配列として保存する
  // （registerNameは新規なら発行・既存なら既存IDを返す）。
  const peopleNames: string[] = Array.isArray(structured.people)
    ? structured.people.filter((p: unknown): p is string => typeof p === "string")
    : [];
  const people = peopleNames.map((p) => registerName(p));

  const now = Date.now();

  // docs/memo.md「H: Phase 3」ローカル完結のベクトル検索用の埋め込み。埋め込み生成に
  // 失敗しても（モデル読み込み失敗等）Journal自体の保存は諦めない——意味的検索は
  // あくまで補助的な機能であり、Journal記録という主目的をブロックすべきではない。
  // 埋め込みはローカル生成・ローカル利用のみ（クラウドへは一切送らない）なので、
  // 生のrawTextから計算してよい（マスクすると人物名という意味的シグナルを失うため）。
  let embedding: number[] | undefined;
  try {
    embedding = await embedText(rawText);
  } catch {
    embedding = undefined;
  }

  // 個人情報の分離（ユーザー指摘対応）: text/summaryはSQLite（クラウドプロンプト構築の
  // 経路からも読まれるストア）に保存する前にmaskForStorageでPERSON_n IDへ置換する。
  const maskedText = await maskForStorage(rawText);
  const rawSummary = typeof structured.summary === "string" ? structured.summary : "";
  const maskedSummary = rawSummary ? await maskForStorage(rawSummary) : "";

  // 個人情報の分離（実機検証で発見した実際の漏洩経路）: ローカルモデルの抽出精度の限界で、
  // tagsに人物名そのもの（例: 本来peopleに入るべき「花子さん」を含む文字列）が
  // 紛れ込むことがある。tags自体は新規検出（NER）は不要だが、既知の登録済み名前を
  // 部分一致で置換するmaskNames（同期・軽量）は必ず通す。
  const rawTags: string[] = Array.isArray(structured.tags)
    ? structured.tags.filter((t: unknown): t is string => typeof t === "string")
    : [];
  const maskedTags = rawTags.map((t) => maskNames(t));

  // 「一時的な感情・発言」というJournalの性質上、既定ではkind:"fact"・
  // ttlDaysをSettings（journalFactTtlDays）から適用する。公式方針や長期プロファイルの
  // ように「常に有効」な情報を記録したい場合はrecordEvent()を別途直接使う想定
  // （現時点ではJournalは常にfact扱い、context分類の精緻化は今後の課題）。
  const event = recordEvent({
    kind: "fact",
    context: "observation",
    entityType: "journal",
    people,
    text: maskedText,
    tags: maskedTags,
    urgency: isUrgency(structured.urgency) ? structured.urgency : "mid",
    sentiment: isSentiment(structured.sentiment) ? structured.sentiment : "neutral",
    summary: maskedSummary,
    occurredAt: now,
    id: randomUUID(),
    ttlDays: getRulesAndConstraints().journalFactTtlDays,
    embedding,
  });

  // docs/first_implession 3.6/3.7対応: 「イベント駆動」トリガー＋「AIによる異常検知経由の
  // ドラフトIssue起票」。緊急度highのJournalが登録された時に限り、Lead Agentへ自動で
  // 分析タスクを投げる。Issueを直接作成はせず、通常のAgent Runとして起動するだけ——
  // 既存の「📌 このRunをIssueにする」導線をEMが使うかどうかで、起票の最終判断は
  // 必ず人間に残す（業務要求7 Human-in-the-Loop）。既定はOFF（EMの明示opt-inが必要）。
  if (event.urgency === "high" && getRulesAndConstraints().autoAnomalyDetectionEnabled) {
    void startRun(
      "Lead Agent",
      [
        "Journalに緊急度highのエントリが追加されました。内容を確認し、Issueとして追跡すべき実質的な問題かどうかを判断してください。",
        "問題だと判断した場合は、通常の提案形式（結論・参照ファクト・判断ロジック・棄却した代替案）で示し、結論の中でIssue化を検討する旨を明記してください。",
        "単なる一時的な感情の吐露などで追跡不要と判断した場合は、その旨を簡潔に述べてください（無理にIssue化を勧めないこと）。",
        "",
        `対象のJournalエントリ: "${rawText}"`,
      ].join("\n"),
      "auto-anomaly",
    ).catch(() => {
      // 自動分析の起動失敗でJournal記録自体は失敗させない（あくまで補助機能）。
    });
  }

  return eventToJournalEntry(event);
}

export function listJournalEntries(): JournalEntry[] {
  const events = listEvents({ entityType: "journal", kind: "fact" });
  // docs/memo.md「C」対応。イベントは不変のまま、supersedesで置き換えられた（＝EMが
  // 修正した）版だけを一覧から除外する。履歴自体はSQLiteに残り続ける（削除しない）。
  const supersededIds = new Set(events.map((e) => e.supersedes).filter((id): id is string => !!id));
  return events.filter((e) => !supersededIds.has(e.id)).map(eventToJournalEntry);
}

// docs/memo.md「C. Journalセンシング→行動」対応。ローカルモデルの抽出精度には限界があり、
// EMがtags/people/urgencyをその場で校正できないと「AI抽出のまま組織の事実になる」ことに
// なってしまう。イベントソーシングの不変性は保ったまま、新しいfactイベントを
// supersedesで繋いで記録することで「修正」を表現する（元イベントは削除・上書きしない）。
export async function updateJournalEntry(
  id: string,
  patch: { tags?: string[]; people?: string[]; urgency?: Urgency },
): Promise<JournalEntry | undefined> {
  const original = getEventById(id);
  if (!original || original.entityType !== "journal") return undefined;

  const people = patch.people !== undefined ? patch.people.map((p) => registerName(p)) : original.people;
  const tags = patch.tags !== undefined ? patch.tags.map((t) => maskNames(t)) : original.tags;
  const urgency = patch.urgency !== undefined && isUrgency(patch.urgency) ? patch.urgency : original.urgency ?? "mid";

  const event = recordEvent({
    kind: original.kind,
    context: original.context,
    entityType: original.entityType,
    entityId: original.entityId,
    people,
    text: original.text,
    tags,
    urgency,
    sentiment: original.sentiment,
    summary: original.summary,
    occurredAt: original.occurredAt,
    ttlDays: original.ttlDays,
    supersedes: id,
    sourceJournalId: original.sourceJournalId,
    embedding: original.embedding,
  });

  return eventToJournalEntry(event);
}
