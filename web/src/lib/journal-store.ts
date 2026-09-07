import { randomUUID } from "node:crypto";
import { extractFirstJsonObject, runLocalChat } from "@/lib/local-model";
import { maskForStorage, maskNames, registerName, unmaskNames } from "@/lib/people-directory";
import { recordEvent, listEvents, getEventById, type KnowledgeEvent } from "@/lib/knowledge-store";
import { embedText } from "@/lib/embeddings";
import { getRulesAndConstraints } from "@/lib/settings-store";
import { startRun } from "@/lib/agent-runtime";
import { parseBulkJournalText, parseDateMarkerLine } from "@/lib/journal-date-parser";
import { getIssue, toIssueView } from "@/lib/issue-store";

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
  // docs/em_human_story_and_ux.md P1-9対応。EMが一度でも校正（確認）操作を通したかどうか。
  // supersedesが無い＝記録直後のローカルモデル抽出そのまま、という目印になる。
  confirmed: boolean;
  // docs/em_human_story_and_ux.md 改修依頼対応。urgencyは書き換えず、「今どこで管理
  // されているか」を別軸で持たせる。resolvedIssueIdが設定されている場合、
  // resolvedIssueTitleはtoJournalEntryView()が表示用に解決する（内部表現には無い）。
  resolvedIssueId?: string;
  resolvedIssueTitle?: string;
  resolutionNote?: string;
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
    confirmed: e.supersedes !== undefined,
    resolvedIssueId: e.resolvedIssueId,
    resolutionNote: e.resolutionNote,
  };
}

export function toJournalEntryView(entry: JournalEntry): JournalEntry {
  const resolvedIssue = entry.resolvedIssueId ? getIssue(entry.resolvedIssueId) : undefined;
  return {
    ...entry,
    rawText: unmaskNames(entry.rawText),
    summary: unmaskNames(entry.summary),
    people: entry.people.map(unmaskNames),
    tags: entry.tags.map(unmaskNames),
    resolvedIssueTitle: resolvedIssue ? toIssueView(resolvedIssue).title : undefined,
    resolutionNote: entry.resolutionNote ? unmaskNames(entry.resolutionNote) : undefined,
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

// ローカルモデルでの抽出→保存までの一連処理。addJournalEntry（単発）と
// addJournalEntriesBulk（まとめ入力、1行ずつ同じ処理を回す）の両方から呼ぶ共通処理として
// 切り出してある。occurredAtは呼び出し側が決める（単発なら既定でDate.now()、まとめ入力なら
// 「まとめ投入した時刻」ではなく行ごとに解決した「出来事があった日」を渡す——後述）。
async function createJournalEventFromText(rawText: string, occurredAt: number): Promise<KnowledgeEvent> {
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
  return recordEvent({
    kind: "fact",
    context: "observation",
    entityType: "journal",
    people,
    text: maskedText,
    tags: maskedTags,
    urgency: isUrgency(structured.urgency) ? structured.urgency : "mid",
    sentiment: isSentiment(structured.sentiment) ? structured.sentiment : "neutral",
    summary: maskedSummary,
    occurredAt,
    id: randomUUID(),
    ttlDays: getRulesAndConstraints().journalFactTtlDays,
    embedding,
  });
}

// docs/em_human_story_and_ux.md 改修依頼「まとめて記録する仕組み」対応。occurredAtは
// 既定でDate.now()（＝これまでの単発投稿と同じ挙動）。EMが「今日ではなく先日の話」だと
// 分かっている場合だけ、呼び出し側（APIルート）が日付レベルの値を渡せるようにする。
export async function addJournalEntry(rawText: string, occurredAt: number = Date.now()): Promise<JournalEntry> {
  const event = await createJournalEventFromText(rawText, occurredAt);

  // docs/em_human_story_and_ux.md P1-9対応（旧実装からの変更）。以前はここ（登録直後、
  // ローカルモデルの生の抽出結果に対して）で自動検知を起動していたが、ローカルモデルの
  // 精度限界でurgency抽出を誤ると、EMが校正する前に「偽の緊急事態」としてクラウドの
  // Lead Agentが起動してしまう問題があった（docs/em_human_story_and_ux.md
  // 「(10) ローカルNER誤検出」とは別の、抽出精度そのものの問題）。そのため自動検知の
  // トリガーはupdateJournalEntry（EMが確認・校正した後）側に移し、ここでは記録のみ行う。
  return eventToJournalEntry(event);
}

export type BulkJournalResult = { entries: JournalEntry[]; skippedLines: number };

// docs/em_human_story_and_ux.md 改修依頼「まとめて記録する仕組み」対応。忙しくて後から
// まとめて書く場合に、1件ずつSubmitさせる負担を無くす。EMは自由記述のまま複数行を貼り、
// 「1行＝1つの出来事」・「その行だけが日付なら日付マーカー」という軽い約束事だけを守れば
// よい（固定フォーマットでの逐一入力は求めない）。
//
// 危険な暗黙の決めつけを避けるため:
// - 「まとめ投入した時刻」を全件のoccurredAtにはしない（危険——投入したタイミングと
//   出来事が起きたタイミングは別物）。行ごとに解決した「出来事があった日」の正午を
//   occurredAtにする（時刻までは求めない・ズレのリスクが低いので正午に丸める）。
// - 抽出結果はいずれも未確認（confirmed:false）のまま返る。自動検知はupdateJournalEntry
//   （EMが確認した後）側でしか起動しないため、まとめ入力で「偽の緊急事態」が連鎖的に
//   自動起動する心配はない。
export async function addJournalEntriesBulk(rawText: string): Promise<BulkJournalResult> {
  const now = Date.now();
  const MAX_LINES = 40;
  const allLines = rawText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  // 日付マーカー行は「消費される」のが正常動作なので、そちらは除いたうえで
  // MAX_LINESの上限で切り捨てられた件数だけをskippedLinesとして報告する。
  const totalContentLines = allLines.filter((l) => parseDateMarkerLine(l, now) === undefined).length;
  const parsed = parseBulkJournalText(rawText, now, MAX_LINES);
  const skippedLines = Math.max(0, totalContentLines - parsed.length);

  const entries: JournalEntry[] = [];
  // ローカルモデル（WASM上の単一インスタンス）を前提にしており、並行実行の安全性が
  // 保証できないため、あえて逐次実行にしている（件数が多いほど時間はかかるが、
  // 「一括入力で疲弊しない」の主眼は連続クリックを無くすことにあり、待ち時間そのものは
  // 許容範囲と判断）。
  for (const line of parsed) {
    const event = await createJournalEventFromText(line.text, line.occurredAt);
    entries.push(eventToJournalEntry(event));
  }
  return { entries, skippedLines };
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
  patch: {
    rawText?: string;
    tags?: string[];
    people?: string[];
    urgency?: Urgency;
    occurredAt?: number;
    // docs/em_human_story_and_ux.md 改修依頼対応。undefined=変更しない、null=解除、
    // string=設定、という3値の意味を持たせる（他フィールドと違い「未指定=既存値を保持」が
    // 「クリアできない」ことを意味してしまうため）。
    resolvedIssueId?: string | null;
    resolutionNote?: string | null;
  },
): Promise<JournalEntry | undefined> {
  const original = getEventById(id);
  if (!original || original.entityType !== "journal") return undefined;

  const people = patch.people !== undefined ? patch.people.map((p) => registerName(p)) : original.people;
  const tags = patch.tags !== undefined ? patch.tags.map((t) => maskNames(t)) : original.tags;
  const urgency = patch.urgency !== undefined && isUrgency(patch.urgency) ? patch.urgency : original.urgency ?? "mid";
  // docs/em_human_story_and_ux.md 改修依頼「通常投入でも日付レベルの訂正を扱えるように」
  // 対応。まとめ入力から生成された（または単に日付を勘違いした）エントリの発生日を、
  // 校正のタイミングで直せるようにする。
  const occurredAt = patch.occurredAt !== undefined ? patch.occurredAt : original.occurredAt;
  const resolvedIssueId =
    patch.resolvedIssueId !== undefined ? (patch.resolvedIssueId ?? undefined) : original.resolvedIssueId;
  const resolutionNote =
    patch.resolutionNote !== undefined
      ? patch.resolutionNote
        ? await maskForStorage(patch.resolutionNote.trim())
        : undefined
      : original.resolutionNote;

  // docs/em_human_story_and_ux.md 改修依頼「Journalの本文を編集できるようにする」対応。
  // 記録時の言い間違い等の訂正用であり、tags/people/urgency/summaryの再抽出は行わない
  // （EMが必要なら別途手動で合わせて調整する）。新しい文面から新規の人物名が出てくる
  // 可能性があるため、初回記録時と同じくmaskForStorage（NER検出＋マスク）を通す。
  const rawTextInput = patch.rawText?.trim();
  const text = rawTextInput !== undefined ? await maskForStorage(rawTextInput) : original.text;
  let embedding = original.embedding;
  if (rawTextInput !== undefined) {
    try {
      embedding = await embedText(rawTextInput);
    } catch {
      embedding = undefined;
    }
  }

  const event = recordEvent({
    kind: original.kind,
    context: original.context,
    entityType: original.entityType,
    entityId: original.entityId,
    people,
    text,
    tags,
    urgency,
    sentiment: original.sentiment,
    summary: original.summary,
    occurredAt,
    ttlDays: original.ttlDays,
    supersedes: id,
    sourceJournalId: original.sourceJournalId,
    embedding,
    resolvedIssueId,
    resolutionNote,
  });

  // docs/em_human_story_and_ux.md P1-9対応。自動検知は「EMが確認・校正した後」にだけ
  // 起動する。original.supersedes===undefinedは「まだ一度も確認されていない、記録直後の
  // 生の抽出結果」であることの目印（校正済みの版をさらに直すような後続の編集では
  // 再度起動しない）。
  if (urgency === "high" && original.supersedes === undefined && getRulesAndConstraints().autoAnomalyDetectionEnabled) {
    void startRun(
      "Lead Agent",
      [
        "Journalに緊急度highのエントリが追加されました（EMが内容を確認・校正済みです）。内容を確認し、Issueとして追跡すべき実質的な問題かどうかを判断してください。",
        "問題だと判断した場合は、通常の提案形式（結論・参照ファクト・判断ロジック・棄却した代替案）で示し、結論の中でIssue化を検討する旨を明記してください。",
        "単なる一時的な感情の吐露などで追跡不要と判断した場合は、その旨を簡潔に述べてください（無理にIssue化を勧めないこと）。",
        "",
        `対象のJournalエントリ: "${original.text}"`,
      ].join("\n"),
      "auto-anomaly",
    ).catch(() => {
      // 自動分析の起動失敗でJournalの校正自体は失敗させない（あくまで補助機能）。
    });
  }

  return eventToJournalEntry(event);
}
