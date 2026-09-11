import { randomUUID } from "node:crypto";
import { extractFirstJsonObject, runLocalChat } from "@/lib/local-model";
import { getPersonId, ensureNameCandidatesAllowed, maskForStorage, maskNames, registerName, unmaskNames } from "@/lib/people-directory";
import type { MaskOptions } from "@/lib/name-candidate-confirmation";

// 人物詳細など「この人に紐づけて書く」導線から、EMが明示した人物名を作成時に渡すため。
// 校正（PATCH）の people と同様、明示指定は registerName してよい（NER自動抽出とは別経路）。
export type AddJournalOpts = MaskOptions & {
  people?: string[];
};
import {
  recordEvent,
  listEvents,
  listEventsPage,
  findEventOffset,
  listEventFacets,
  getEventById,
  getEventHeadById,
  listEventLineageIds,
  type EventPageFilter,
  type KnowledgeEvent,
} from "@/lib/knowledge-store";
import { embedText } from "@/lib/embeddings";
import { getRulesAndConstraints, matchesJournalAutoFilters } from "@/lib/settings-store";
import { listRuns, startJournalAnalysis, startJournalAutoAnalysis, type AgentRun } from "@/lib/agent-runtime";
import { parseBulkJournalText, parseDateMarkerLine } from "@/lib/journal-date-parser";
import { getIssue, toIssueView } from "@/lib/issue-store";

// 重要: ジャーナルには人名・心情などの機微情報が含まれうるため、この抽出処理は
// 外部サービス（claude -p を含む）に一切送信せず、完全にローカル（Transformers.js / WASM,
// ONNX Runtime）で完結させる。docs 3.2「サニタイズ（秘匿化）」および業務要求3「情報の壁と
// セキュリティ」に対応するための必須要件であり、コストや速度のための最適化ではない。
// 抽出したpeopleのうち、既にpeople-directoryへ登録済みの人物だけを紐付ける。
// ローカルLLMの新規検出結果では自動登録しない（誤登録対策）。未登録の人名らしい語句は
// 保存前にEMへ「未マスクのまま進めてよいか」を確認する。
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
  // Journalから自動分析／手動相談が立ったときの Lead run。supersedes後も現行版から辿れる。
  sourceConsultRunId?: string;
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

export function toJournalEntryView(entry: JournalEntry, consultIndex?: Map<string, string>): JournalEntry {
  const resolvedIssue = entry.resolvedIssueId ? getIssue(entry.resolvedIssueId) : undefined;
  const index = consultIndex ?? buildSourceConsultIndex();
  return {
    ...entry,
    rawText: unmaskNames(entry.rawText),
    summary: unmaskNames(entry.summary),
    people: entry.people.map(unmaskNames),
    tags: entry.tags.map(unmaskNames),
    resolvedIssueTitle: resolvedIssue ? toIssueView(resolvedIssue).title : undefined,
    resolutionNote: entry.resolutionNote ? unmaskNames(entry.resolutionNote) : undefined,
    sourceConsultRunId: index.get(entry.id),
  };
}

export function toJournalEntryViews(entries: JournalEntry[]): JournalEntry[] {
  const index = buildSourceConsultIndex();
  return entries.map((entry) => toJournalEntryView(entry, index));
}

export function buildSourceConsultIndex(): Map<string, string> {
  const best = new Map<string, { runId: string; updatedAt: number }>();
  for (const run of listRuns()) {
    if (run.agentName !== "Lead Agent" || !run.sourceJournalId) continue;
    for (const journalId of listEventLineageIds(run.sourceJournalId)) {
      const prev = best.get(journalId);
      if (!prev || run.updatedAt > prev.updatedAt) {
        best.set(journalId, { runId: run.id, updatedAt: run.updatedAt });
      }
    }
  }
  const index = new Map<string, string>();
  for (const [journalId, value] of best) {
    index.set(journalId, value.runId);
  }
  return index;
}

const SYSTEM_PROMPT = [
  "あなたはメモから情報を抽出し、JSONだけを出力するツールです。説明や前置きは一切書かず、JSONオブジェクト1つだけを出力してください。",
  'フォーマット: {"tags": string[], "people": string[], "urgency": "low"|"mid"|"high", "sentiment": "positive"|"negative"|"neutral", "summary": string}',
  "tagsは日本語の短い単語（例: 技術的負債, 1on1）。peopleは文中の人物名（敬称はそのまま、例: Aさん）。",
  "メモに書かれていない情報を推測で埋めないこと。該当が無ければ空配列にすること。",
].join("\n");

// 人物が「いる」例と「いない」例の両方を見せることで、小型モデルがpeopleを
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
async function createJournalEventFromText(
  rawText: string,
  occurredAt: number,
  opts: AddJournalOpts = {},
): Promise<KnowledgeEvent> {
  await ensureNameCandidatesAllowed([rawText], opts);

  // docs/usage_issues U1: 構造化抽出は補助。モデルがJSONを返さない・呼び出し自体が
  // 失敗しても、本文の保存（Journalの主目的）は止めない。失敗時は未確認のまま既定値で残し、
  // EMが後から校正できる。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let structured: any = {};
  try {
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
    if (jsonText) {
      try {
        structured = JSON.parse(jsonText);
      } catch {
        structured = {};
      }
    }
  } catch {
    structured = {};
  }

  // 既登録の人物だけを紐付ける。ローカル抽出の新規名は自動登録しない
  // （EMが校正時にpeople欄へ明示したときだけregisterNameする）。
  // ただし opts.people（人物詳細からの「この人に紐づけて書く」等）はEMの明示指定なので
  // 校正時と同様に registerName し、抽出漏れでも必ず紐付くようにする。
  const peopleNames: string[] = Array.isArray(structured.people)
    ? structured.people.filter((p: unknown): p is string => typeof p === "string")
    : [];
  const extractedPeople = peopleNames
    .map((p) => getPersonId(p))
    .filter((id): id is string => id !== undefined);
  const explicitPeople = (opts.people ?? [])
    .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    .map((p) => registerName(p.trim()));
  const people = [...new Set([...extractedPeople, ...explicitPeople])];

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
export async function addJournalEntry(
  rawText: string,
  occurredAt: number = Date.now(),
  opts: AddJournalOpts = {},
): Promise<JournalEntry> {
  const event = await createJournalEventFromText(rawText, occurredAt, opts);

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
export async function addJournalEntriesBulk(rawText: string, opts: MaskOptions = {}): Promise<BulkJournalResult> {
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

  // まとめ入力は1件目で確認が要ると途中保存が残るのを避けるため、先に全行の候補を集約する。
  await ensureNameCandidatesAllowed(
    parsed.map((line) => line.text),
    opts,
  );

  const entries: JournalEntry[] = [];
  // ローカルモデル（WASM上の単一インスタンス）を前提にしており、並行実行の安全性が
  // 保証できないため、あえて逐次実行にしている（件数が多いほど時間はかかるが、
  // 「一括入力で疲弊しない」の主眼は連続クリックを無くすことにあり、待ち時間そのものは
  // 許容範囲と判断）。
  for (const line of parsed) {
    // 上で一括確認済みなので、各行では再検出をスキップする（allow付きで通す）。
    const event = await createJournalEventFromText(line.text, line.occurredAt, {
      allowUnmaskedCandidates: true,
    });
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

// ユーザー指摘「一覧の全件取得をページネーション化したい」対応。/journal（一覧・検索画面）
// 専用の検索フィルタ。query/tag/personはEM向けの実名表示のまま受け取り、内部で
// マスク後の表現（PERSON_n ID・マスク済みタグ）へ変換してからSQLへ渡す
// （knowledge_events.text/tags_json/people_jsonはマスクされた状態で保存されているため）。
export type JournalListFilter = {
  query?: string;
  tag?: string;
  person?: string;
  urgency?: Urgency;
  sentiment?: Sentiment;
  sinceMs?: number;
  excludeResolved?: boolean;
};

// 未登録の人物名（people-directoryにgetPersonIdで見つからない名前）が渡された場合、
// personExactをundefinedのまま返すとフィルタ自体が適用されず「絞り込み無し＝全件」に
// なってしまう（buildEventPageWhereはundefinedの条件をスキップするため）。どのPERSON_n IDにも
// 一致しない値を渡すことで、意図通り「該当なし」を返す。
const UNKNOWN_PERSON_SENTINEL = "__unknown_person__";

function toEventFilter(filter: JournalListFilter): EventPageFilter {
  return {
    entityType: "journal",
    kind: "fact",
    textQuery: filter.query ? maskNames(filter.query) : undefined,
    tagExact: filter.tag ? maskNames(filter.tag) : undefined,
    personExact: filter.person ? (getPersonId(filter.person) ?? UNKNOWN_PERSON_SENTINEL) : undefined,
    urgency: filter.urgency,
    sentiment: filter.sentiment,
    occurredAtFrom: filter.sinceMs,
    excludeResolved: filter.excludeResolved,
    excludeSuperseded: true,
  };
}

export function listJournalEntriesPage(
  filter: JournalListFilter,
  opts: { limit: number; offset: number },
): { entries: JournalEntry[]; total: number } {
  const { events, total } = listEventsPage(toEventFilter(filter), opts);
  return { entries: events.map(eventToJournalEntry), total };
}

// ユーザー指摘「Dashboardの『Journal未確認』から/journalへ飛んだ際、そのエントリが
// 載っているページへ自動的に移動したい」対応。ページネーション後もこの深いリンクを保つため、
// 対象エントリが現在のフィルタ・並び順で何件目に位置するかをサーバー側で求める。
// フィルタに合致しない（別のtag/urgency等で絞り込み中）場合はundefinedを返す。
export function findJournalEntryOffset(id: string, filter: JournalListFilter): number | undefined {
  const target = getEventById(id);
  if (!target || target.entityType !== "journal") return undefined;
  return findEventOffset({ occurredAt: target.occurredAt, recordedAt: target.recordedAt }, toEventFilter(filter));
}

// ユーザー指摘「一覧の全件取得をページネーション化したい」対応。絞り込みドロップダウン
// （タグ・人物）用の選択肢一覧。全件からの重複排除が必要なため、これ自体は全行を
// 走査するが、読むのはtags_json/people_jsonの2カラムのみ（本文・要約等は含まない）。
export function listJournalFacets(): { tags: string[]; people: string[] } {
  const { tags, people } = listEventFacets({ entityType: "journal", kind: "fact", excludeSuperseded: true });
  return {
    tags: tags.map(unmaskNames).sort((a, b) => a.localeCompare(b, "ja")),
    people: people.map(unmaskNames).sort((a, b) => a.localeCompare(b, "ja")),
  };
}

export function getCurrentJournalEntry(id: string): JournalEntry | undefined {
  const event = getEventHeadById(id);
  if (!event || event.entityType !== "journal") return undefined;
  return eventToJournalEntry(event);
}

export function listSourceJournalsForIssue(issueId: string, sourceJournalId?: string): JournalEntry[] {
  const byResolved = listJournalEntries().filter((e) => e.resolvedIssueId === issueId);
  const fromId = sourceJournalId ? getCurrentJournalEntry(sourceJournalId) : undefined;
  const map = new Map<string, JournalEntry>();
  for (const entry of byResolved) map.set(entry.id, entry);
  if (fromId) map.set(fromId.id, fromId);
  return [...map.values()];
}

export async function linkJournalToIssue(
  journalId: string,
  issueId: string,
  opts: MaskOptions = {},
): Promise<JournalEntry | undefined> {
  const current = getCurrentJournalEntry(journalId);
  if (!current) return undefined;
  if (current.resolvedIssueId === issueId) return current;
  return updateJournalEntry(current.id, { resolvedIssueId: issueId }, opts);
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
  opts: MaskOptions = {},
): Promise<JournalEntry | undefined> {
  const original = getEventById(id);
  if (!original || original.entityType !== "journal") return undefined;

  // EMが校正フォームで明示した人物名は登録してよい（ローカルLLMの自動登録とは別経路）。
  const people = patch.people !== undefined ? patch.people.map((p) => registerName(p)) : original.people;
  const tags = patch.tags !== undefined ? patch.tags.map((t) => maskNames(t)) : original.tags;
  const urgency = patch.urgency !== undefined && isUrgency(patch.urgency) ? patch.urgency : original.urgency ?? "mid";
  // docs/em_human_story_and_ux.md 改修依頼「通常投入でも日付レベルの訂正を扱えるように」
  // 対応。まとめ入力から生成された（または単に日付を勘違いした）エントリの発生日を、
  // 校正のタイミングで直せるようにする。
  const occurredAt = patch.occurredAt !== undefined ? patch.occurredAt : original.occurredAt;
  const resolvedIssueId =
    patch.resolvedIssueId !== undefined ? (patch.resolvedIssueId ?? undefined) : original.resolvedIssueId;

  const textsToCheck: string[] = [];
  const rawTextInput = patch.rawText?.trim();
  if (rawTextInput !== undefined) textsToCheck.push(rawTextInput);
  if (patch.resolutionNote !== undefined && patch.resolutionNote) textsToCheck.push(patch.resolutionNote.trim());
  if (textsToCheck.length > 0) await ensureNameCandidatesAllowed(textsToCheck, opts);

  const resolutionNote =
    patch.resolutionNote !== undefined
      ? patch.resolutionNote
        ? await maskForStorage(patch.resolutionNote.trim())
        : undefined
      : original.resolutionNote;

  // docs/em_human_story_and_ux.md 改修依頼「Journalの本文を編集できるようにする」対応。
  // 記録時の言い間違い等の訂正用であり、tags/people/urgency/summaryの再抽出は行わない
  // （EMが必要なら別途手動で合わせて調整する）。新しい文面から新規の人物名が出てくる
  // 可能性があるため、候補確認のうえ既知名のみマスクする。
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
  // 再度起動しない）。緊急度・感情の閾値はSettingsのフィルタで調整する。
  // 投稿直後は起動しない（誤抽出での偽緊急事態を防ぐ）。フィルタ外・自動OFF時は
  // requestJournalAnalysis で明示起動できる。
  const sentiment = (event.sentiment as Sentiment) ?? "neutral";
  if (original.supersedes === undefined && matchesJournalAutoFilters(urgency, sentiment)) {
    void startJournalAutoAnalysis(event.text, event.id).catch(() => {
      // 自動分析の起動失敗でJournalの校正自体は失敗させない（あくまで補助機能）。
    });
  }

  return eventToJournalEntry(event);
}

// docs/usage_issues U16。自動フィルタ外・自動OFF・修正なし確定後でも、EMが明示して分析を起動する。
// 未確認（AI抽出のまま）では起動しない——投稿時点起動と同じ誤検知リスクを避ける。
export async function requestJournalAnalysis(
  id: string,
  opts: MaskOptions = {},
): Promise<{ entry: JournalEntry; run: AgentRun } | undefined> {
  const entry = getCurrentJournalEntry(id);
  if (!entry) return undefined;
  if (!entry.confirmed) {
    throw new Error("未確認のJournalは分析できません。先に内容を確定してください。");
  }
  const run = await startJournalAnalysis(entry.rawText, entry.id, {
    ...opts,
    trigger: "manual",
    onUnconfirmedNames: "throw",
  });
  if (!run) {
    throw new Error("分析の起動に失敗しました");
  }
  return { entry, run };
}
