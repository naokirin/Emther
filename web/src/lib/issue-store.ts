import { randomUUID } from "node:crypto";
import { loadJSON, saveJSON } from "@/lib/persistence";
import { recordChangeEvent } from "@/lib/knowledge-store";
import { ensureNameCandidatesAllowed, maskForStorage, maskNames, unmaskNames } from "@/lib/people-directory";
import type { MaskOptions } from "@/lib/name-candidate-confirmation";

// 個人情報の分離（ユーザー指摘対応）: title・charter（why/what/how）はEMが自由記述する
// フィールドで人物名を含み得るため、保存前にensureNameCandidatesAllowed（未登録候補の確認）と
// maskForStorage（既登録名のPERSON_n置換）を通す。未変更フィールドは表示値比較でスキップし、
// 複数フィールドのNERは1回にまとめる。tagsは構造的なラベル（例: "技術的負債"）であり
// 個人名ではないため対象外（既知名の軽量maskNamesのみ）。EM向けの表示（Dashboard等）は、
// これを返すAPIルート側でunmaskNamesを通してから応答する。

// docs 3.7「双方向のIssueトラッキング基盤」の最小実装。
// v5設計書はIssueが独自の実行計画・ロードマップを持つ想定だが、MVPでは
// 「Yieldと壁打ちチャットはAgent Runにそのまま委譲し、Issueは
//  タイトル・Why/What/How・Action Itemsチェックリストだけを永続的に持つ薄いラッパー」にしている。
// agentRunIdが無いIssue（EMが直接起票）と、既存のAgent Runに紐づくIssue
// （AIのYieldをEMがIssue化したもの）の両方を許容するのが「双方向性」に対応する部分。

export type ActionItem = {
  id: string;
  text: string;
  done: boolean;
};

// docs/em_ui_ux_issue.md 4節「ステータス管理の導入」対応。@/lib/typesのIssueStatusと
// 同じ内容（他のIssue関連型と同じく意図的に型を分離している）。
export type IssueStatus = "not_started" | "in_progress" | "blocked" | "done";

// 介入ポートフォリオの優先帯（@/lib/types の IssuePriority と同じ。型は意図的に分離）。
export type IssuePriority = "focus" | "normal" | "parked";

// ユーザー依頼「EMがIssueに対して考えたこと・取ったアクション・結果を反映する」対応。
// Action Items（やる/やった）とは別に、進行中に思いついた時点でひとこと書き足すだけの
// 自由記述ログ。構造化フォーム（考えたこと欄／アクション欄／結果欄を分ける）にすると
// 記入の手間が増えて使われなくなるため、Quick Journal・EM自身のKeep/Problem/Tryと同じ
// 低摩擦な追記ログにする（種別を分けず、EMが自由に書く）。
export type IssueLogEntry = {
  id: string;
  text: string;
  createdAt: number;
};

// Issueは重要な意思決定の単位であり、計画・実行の前に
// 「Why（生む価値・誰のため・なぜ今か）」「What（何を・どこまで・どのくらい・完了の定義）」
// 「How（どのように・なぜその方法か・前提と制約）」を明らかにしておくべき、という要求に対応。
// 各項目は空文字列（＝未整理）を許容する——分からないことを分からないまま隠さず、
// 「まだ明らかになっていない」を明示できるようにするのが狙い（Team Vitalsの評価不能と同じ考え方）。
export type IssueCharter = {
  why: string;
  what: string;
  how: string;
};

// 親子関係は1階層のみ（孫Issue禁止）。docs 3.8「動的Issue実行管理」のズームイン/アウトの
// 最小実装で、複雑さを避けるため「親（トップレベル）」と「子（サブIssue）」の2種類しか無く、
// 子が自分の子（＝孫）を持つことは許可しない。
export type Issue = {
  id: string;
  title: string;
  agentRunId?: string;
  // 相談から昇格したときの元 Run。agentRunId は更新分析で差し替わるため、生成元は別フィールドで残す。
  sourceRunId?: string;
  // Journal から直接起票、または Journal 由来の相談から昇格したときの元エントリ。
  sourceJournalId?: string;
  charter: IssueCharter;
  actionItems: ActionItem[];
  logEntries: IssueLogEntry[];
  parentId?: string;
  status: IssueStatus;
  priority: IssuePriority;
  focusOrder?: number;
  archived: boolean;
  // docs/issue_tracker_contract.md §3。archived=追わない（一覧退避）。効果測定には使わない。
  archivedAt?: number;
  // docs/issue_tracker_contract.md §3／案α。status=done になった時刻。介入効果の起点。
  doneAt?: number;
  tags: string[];
  // docs/memo.md「H. 戦略→Issue→結果の一本線」対応。このIssueがどのKeyResultに
  // 貢献するかの紐付け（任意）。IDのみ保持し、実体（Objective/KeyResult）は
  // org-context-store.ts側にある。
  keyResultId?: string;
  // docs/memo.md「I. チーム単位の憲法」対応。このIssueがどのチームに関するものかの
  // 紐付け（任意）。
  teamId?: string;
  // docs/knowledge_distillation.md 後続1。title+charter のローカル埋め込み（横断類似検索用）。
  embedding?: number[];
  createdAt: number;
  updatedAt: number;
};

function emptyCharter(): IssueCharter {
  return { why: "", what: "", how: "" };
}

// docs/memo.md TODO「Issueにカテゴリ・タグ付けをしたい」への対応。Journalのtagsと同じ
// 表記ゆれ吸収（trim・空文字除去・重複除去）をここでも行う。
// 個人情報の分離（ユーザー指摘対応）: EMがタグに人物名を含めてしまうケース（例:
// 「#Aさん案件」）に備え、既知の登録済み名前をmaskNames（軽量・部分一致）で置換する。
function normalizeTags(tags: string[]): string[] {
  return Array.from(new Set(tags.map((t) => maskNames(t.trim())).filter(Boolean)));
}

// docs/em_ui_ux_issue.md 4節対応。statusフィールド追加前のIssueには、既存の事実
// （actionItems/logEntries）から機械的に推定した初期値を補う。
// docs/issue_tracker_contract.md §3: archived は done を意味しない。ただし status 未設定の
// 旧データで archived だけ立っているものは、当時の「アーカイブ＝閉じる」語義のため done とみなす。
function inferStatus(issue: Issue): IssueStatus {
  if (issue.status) return issue.status;
  if (issue.archived) return "done";
  if (issue.actionItems.some((a) => a.done) || issue.logEntries.length > 0) return "in_progress";
  return "not_started";
}

function normalizeIssue(raw: Issue): Issue {
  const status = raw.status ?? inferStatus(raw);
  // doneAt 欠落の done Issue は効果窓が消えないよう archivedAt/updatedAt で補完する。
  const doneAt =
    status === "done" ? (raw.doneAt ?? raw.archivedAt ?? raw.updatedAt) : undefined;
  return {
    ...raw,
    charter: raw.charter ?? emptyCharter(),
    archived: raw.archived ?? false,
    tags: raw.tags ?? [],
    logEntries: raw.logEntries ?? [],
    status,
    doneAt,
    priority: raw.priority ?? "normal",
    focusOrder: (raw.priority ?? "normal") === "focus" ? (raw.focusOrder ?? 0) : undefined,
  };
}

// 永続化ファイルに旧バージョン（charter/tagsフィールド追加前）のIssueが残っていても
// 壊れないよう、読み込み時に補完する。
const issues: Issue[] = loadJSON<Issue[]>("issues.json", []).map(normalizeIssue);

// focus 同士の focusOrder を読み込み時に連番へ正規化する（旧データの重複0対策）。
{
  const focus = issues
    .filter((i) => i.priority === "focus")
    .sort((a, b) => (a.focusOrder ?? 0) - (b.focusOrder ?? 0));
  focus.forEach((i, idx) => {
    i.focusOrder = idx;
  });
}

function persist(): void {
  saveJSON("issues.json", issues);
}

/** embedding だけ更新する（updatedAt は触らない）。related-context から呼ぶ。 */
export function persistIssueEmbedding(issueId: string, embedding: number[]): Issue | undefined {
  const issue = getIssue(issueId);
  if (!issue) return undefined;
  issue.embedding = embedding;
  persist();
  return issue;
}

// 個人情報の分離（ユーザー指摘対応）: 上のCRUD関数・listIssues/getIssue等はマスクされた
// （PERSON_n ID化された）テキストを返す内部表現。EM向けのAPI応答を組み立てる境界だけで、
// この関数を通して実名へ復元する（agent-runtime.tsから呼んではいけない）。
export function toIssueView(issue: Issue): Issue {
  return {
    ...issue,
    title: unmaskNames(issue.title),
    charter: {
      why: unmaskNames(issue.charter.why),
      what: unmaskNames(issue.charter.what),
      how: unmaskNames(issue.charter.how),
    },
    actionItems: issue.actionItems.map((a) => ({ ...a, text: unmaskNames(a.text) })),
    logEntries: issue.logEntries.map((l) => ({ ...l, text: unmaskNames(l.text) })),
    tags: issue.tags.map(unmaskNames),
    // 埋め込みはローカル検索用の内部データ。API応答には載せない。
    embedding: undefined,
  };
}

// agent-runtime ↔ related-context の循環を避けつつ、起票・charter/タイトル更新後に embedding を更新する。
async function scheduleIssueEmbedding(issueId: string): Promise<void> {
  try {
    const { refreshIssueEmbedding } = await import("@/lib/related-context");
    await refreshIssueEmbedding(issueId);
  } catch {
    // 埋め込みは補助。Issue 本体の保存を止めない。
  }
}

export function listIssues(): Issue[] {
  return [...issues].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getIssue(id: string): Issue | undefined {
  return issues.find((i) => i.id === id);
}

// docs 3.1「動的ロード」: そのAgent Runが紐づくIssueのWhy/What/Howを
// エージェントへの前提として注入するために使う（agent-runtime.ts）。
export function getIssueByRunId(agentRunId: string): Issue | undefined {
  return issues.find((i) => i.agentRunId === agentRunId);
}

// ユーザー依頼「Journal等からIssueを生成する際、AIエージェントチームに内容を埋めさせる」
// 対応。createIssue時点ではまだ存在しないAgent Runを、作成後に紐づけるための関数
// （agent-runtime.ts側のstartRunから、Claude呼び出しを開始する前に呼ぶことで、
// buildSystemPrompt/getIssueByRunIdが常に紐付き済みの状態を見られるようにする）。
export function linkIssueRun(issueId: string, agentRunId: string): Issue | undefined {
  const issue = getIssue(issueId);
  if (!issue) return undefined;
  issue.agentRunId = agentRunId;
  issue.updatedAt = Date.now();
  persist();
  return issue;
}

export function listChildIssues(parentId: string): Issue[] {
  return issues.filter((i) => i.parentId === parentId).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function createIssue(
  title: string,
  agentRunId?: string,
  charter?: Partial<IssueCharter>,
  parentId?: string,
  tags?: string[],
  keyResultId?: string,
  teamId?: string,
  opts: MaskOptions & { priority?: IssuePriority; sourceJournalId?: string; sourceRunId?: string } = {},
): Promise<Issue> {
  if (parentId) {
    const parent = getIssue(parentId);
    if (!parent) {
      throw new Error("親Issueが見つかりません");
    }
    if (parent.parentId) {
      throw new Error("この親Issue自体が子Issueのため、これ以上下に分解できません（親子関係は1階層まで）");
    }
  }

  const { priority: requestedPriority, sourceJournalId, sourceRunId, ...maskOpts } = opts;
  const titleTrimmed = title.trim();
  const whyTrimmed = charter?.why?.trim() ?? "";
  const whatTrimmed = charter?.what?.trim() ?? "";
  const howTrimmed = charter?.how?.trim() ?? "";
  await ensureNameCandidatesAllowed([titleTrimmed, whyTrimmed, whatTrimmed, howTrimmed], maskOpts);

  // maskForStorageは既知名の同期置換のみなので並列化してよい（NERは上で1回済）。
  const [maskedTitle, maskedWhy, maskedWhat, maskedHow] = await Promise.all([
    maskForStorage(titleTrimmed),
    whyTrimmed ? maskForStorage(whyTrimmed) : Promise.resolve(""),
    whatTrimmed ? maskForStorage(whatTrimmed) : Promise.resolve(""),
    howTrimmed ? maskForStorage(howTrimmed) : Promise.resolve(""),
  ]);

  const now = Date.now();
  const issue: Issue = {
    id: randomUUID(),
    title: maskedTitle,
    agentRunId,
    sourceRunId: sourceRunId ?? agentRunId,
    sourceJournalId,
    charter: {
      why: maskedWhy,
      what: maskedWhat,
      how: maskedHow,
    },
    actionItems: [],
    logEntries: [],
    parentId,
    status: "not_started",
    priority: "normal",
    archived: false,
    tags: normalizeTags(tags ?? []),
    keyResultId,
    teamId,
    createdAt: now,
    updatedAt: now,
  };
  issues.push(issue);
  persist();
  recordChangeEvent("issue", issue.id, `Issueを起票: 「${issue.title}」${parentId ? "（サブIssue）" : ""}`);
  let result = issue;
  if (requestedPriority && requestedPriority !== "normal") {
    result = setIssuePriority(issue.id, requestedPriority) ?? issue;
  }
  await scheduleIssueEmbedding(result.id);
  return getIssue(result.id) ?? result;
}

// 既存のIssueの「上位」に新しいIssueを作り、既存のIssueをその子として付け替える
// （＝ズームアウト。大きな課題として括り直す）。既存のIssueが既に子（親を持つ）か、
// 既に自分の子を持っている場合は2階層を超えてしまうため拒否する。
export async function createParentIssue(
  childId: string,
  title: string,
  charter?: Partial<IssueCharter>,
  opts: MaskOptions = {},
): Promise<Issue> {
  const child = getIssue(childId);
  if (!child) {
    throw new Error("対象のIssueが見つかりません");
  }
  if (child.parentId) {
    throw new Error("このIssueは既に子Issueのため、さらに上位Issueを作ることはできません（親子関係は1階層まで）");
  }
  if (issues.some((i) => i.parentId === childId)) {
    throw new Error("このIssueには既に子Issueがあるため、上位Issueを作ると2階層を超えてしまいます");
  }

  const titleTrimmed = title.trim();
  const whyTrimmed = charter?.why?.trim() ?? "";
  const whatTrimmed = charter?.what?.trim() ?? "";
  const howTrimmed = charter?.how?.trim() ?? "";
  await ensureNameCandidatesAllowed([titleTrimmed, whyTrimmed, whatTrimmed, howTrimmed], opts);

  const [maskedTitle, maskedWhy, maskedWhat, maskedHow] = await Promise.all([
    maskForStorage(titleTrimmed),
    whyTrimmed ? maskForStorage(whyTrimmed) : Promise.resolve(""),
    whatTrimmed ? maskForStorage(whatTrimmed) : Promise.resolve(""),
    howTrimmed ? maskForStorage(howTrimmed) : Promise.resolve(""),
  ]);

  const now = Date.now();
  const parent: Issue = {
    id: randomUUID(),
    title: maskedTitle,
    charter: {
      why: maskedWhy,
      what: maskedWhat,
      how: maskedHow,
    },
    actionItems: [],
    logEntries: [],
    status: "not_started",
    priority: "normal",
    archived: false,
    tags: [],
    createdAt: now,
    updatedAt: now,
  };
  issues.push(parent);
  child.parentId = parent.id;
  child.updatedAt = now;
  persist();
  recordChangeEvent("issue", parent.id, `Issueを起票: 「${parent.title}」（「${child.title}」の上位Issueとして）`);
  recordChangeEvent("issue", child.id, `上位Issue「${parent.title}」の下に再編されました`);
  await scheduleIssueEmbedding(parent.id);
  return getIssue(parent.id) ?? parent;
}

const CHARTER_FIELD_LABEL: Record<keyof IssueCharter, string> = { why: "Why", what: "What", how: "How" };

// agent-runtime ↔ issue-storeの循環参照を避けるため動的import。
// クライアントが保存直後に refreshRuns しても pending を取りこぼさないよう、
// レスポンス返却前に reactToIssueUpdate（同期・デバウンス登録のみ）まで完了させる。
async function scheduleIssueUpdateAnalysis(
  issueId: string,
  trigger: "charter" | "log",
  detail: string,
): Promise<void> {
  try {
    const { reactToIssueUpdate } = await import("@/lib/agent-runtime");
    reactToIssueUpdate(issueId, trigger, detail);
  } catch {
    // 自動分析の予約失敗でIssue更新自体は失敗させない。
  }
}

export async function updateIssueCharter(
  issueId: string,
  patch: Partial<IssueCharter>,
  opts: MaskOptions = {},
): Promise<Issue | undefined> {
  const issue = getIssue(issueId);
  if (!issue) return undefined;

  // 表示値（unmask後）と比較して未変更のフィールドはローカルNERも再マスクもスキップする。
  // Why/What/How・タグの一括保存では多くのフィールドが無変更のまま送られるため、ここが体感速度の本体。
  const charterKeys = Object.keys(CHARTER_FIELD_LABEL) as (keyof IssueCharter)[];
  const changedIncoming: Partial<Record<keyof IssueCharter, string>> = {};
  for (const key of charterKeys) {
    if (patch[key] === undefined) continue;
    const trimmed = patch[key]!.trim();
    if (trimmed === unmaskNames(issue.charter[key])) continue;
    changedIncoming[key] = trimmed;
  }

  const textsToCheck = Object.values(changedIncoming).filter(Boolean);
  if (textsToCheck.length > 0) await ensureNameCandidatesAllowed(textsToCheck, opts);

  const maskedEntries = await Promise.all(
    (Object.keys(changedIncoming) as (keyof IssueCharter)[]).map(async (key) => {
      const trimmed = changedIncoming[key]!;
      return [key, trimmed ? await maskForStorage(trimmed) : ""] as const;
    }),
  );

  const next: IssueCharter = { ...issue.charter };
  for (const [key, masked] of maskedEntries) {
    next[key] = masked;
  }

  // 実際に値が変わったフィールドだけを変更履歴に残す（無変化の保存操作でノイズを増やさない）。
  const changedFields = charterKeys.filter((k) => next[k] !== issue.charter[k]);
  if (changedFields.length === 0) return issue;

  issue.charter = next;
  issue.updatedAt = Date.now();
  persist();
  recordChangeEvent(
    "issue",
    issue.id,
    `${changedFields.map((k) => CHARTER_FIELD_LABEL[k]).join("・")}を更新しました`,
  );
  const detail = changedFields.map((k) => CHARTER_FIELD_LABEL[k]).join("・");
  await scheduleIssueEmbedding(issue.id);
  await scheduleIssueUpdateAnalysis(issue.id, "charter", detail);
  return getIssue(issue.id) ?? issue;
}

// docs/em_human_story_and_ux.md 改修依頼「Issueのタイトルを変更できるようにする」対応。
// 起票後に文脈が変わった・言葉を整えたい場合の訂正用。空文字は拒否する（Issueのタイトルは
// 一覧・Timeline・関連Issue表示等、常に何らかの見出しとして参照されるため）。
export async function setIssueTitle(
  issueId: string,
  title: string,
  opts: MaskOptions = {},
): Promise<Issue | undefined> {
  const issue = getIssue(issueId);
  if (!issue) return undefined;
  const trimmed = title.trim();
  if (!trimmed) throw new Error("titleは必須です");
  // 表示値と同一ならNER・再マスクをスキップ（無変更の再保存を軽くする）。
  if (trimmed === unmaskNames(issue.title)) return issue;
  await ensureNameCandidatesAllowed([trimmed], opts);
  const masked = await maskForStorage(trimmed);
  if (masked === issue.title) return issue;
  const previousTitle = issue.title;
  issue.title = masked;
  issue.updatedAt = Date.now();
  persist();
  recordChangeEvent("issue", issue.id, `タイトルを変更しました:「${previousTitle}」→「${masked}」`);
  await scheduleIssueEmbedding(issue.id);
  return getIssue(issue.id) ?? issue;
}

// docs/em_ui_ux_issue.md 4節対応。「未着手」のまま実際に着手の事実（Action Item・経過ログの
// 追加）が生じたら、EMの操作を挟まず機械的に「進行中」へ昇格する。blocked/doneは
// EMの明示判断（§2.4「人・優先順位に触れる介入は常にYield」の思想）なので上書きしない。
function bumpToInProgressIfNotStarted(issue: Issue): void {
  if (issue.status === "not_started") issue.status = "in_progress";
}

export type AddActionItemOptions = MaskOptions & {
  // trueのとき配列先頭へ挿入し、未完了の「次の一手」（issueNextAction）にする。
  asNext?: boolean;
};

export async function addActionItem(
  issueId: string,
  text: string,
  opts: AddActionItemOptions = {},
): Promise<Issue | undefined> {
  const issue = getIssue(issueId);
  if (!issue) return undefined;
  const trimmed = text.trim();
  if (!trimmed) return issue;
  const { asNext, ...maskOpts } = opts;
  await ensureNameCandidatesAllowed([trimmed], maskOpts);
  const masked = await maskForStorage(trimmed);
  const item = { id: randomUUID(), text: masked, done: false };
  if (asNext) {
    issue.actionItems.unshift(item);
  } else {
    issue.actionItems.push(item);
  }
  bumpToInProgressIfNotStarted(issue);
  issue.updatedAt = Date.now();
  persist();
  recordChangeEvent(
    "issue",
    issue.id,
    asNext ? `次の一手としてAction Itemを追加: 「${masked}」` : `Action Itemを追加: 「${masked}」`,
  );
  return issue;
}

// 指定した未完了Action Itemを配列先頭へ移し、次の一手にする。
export function setActionItemAsNext(issueId: string, itemId: string): Issue | undefined {
  const issue = getIssue(issueId);
  if (!issue) return undefined;
  const index = issue.actionItems.findIndex((a) => a.id === itemId);
  if (index < 0) return undefined;
  const [item] = issue.actionItems.splice(index, 1);
  if (item.done) {
    // 完了済みを次の一手にはできない——元の位置へ戻す。
    issue.actionItems.splice(index, 0, item);
    return undefined;
  }
  issue.actionItems.unshift(item);
  bumpToInProgressIfNotStarted(issue);
  issue.updatedAt = Date.now();
  persist();
  recordChangeEvent("issue", issue.id, `「${item.text}」を次の一手にしました`);
  return issue;
}

// Action Itemを子Issueへ昇格する。親が既に子Issueの場合は1階層制限で拒否。
// 元のAction Itemは完了にし、二重管理（親のチェックと子のstatus）を避ける。
export async function promoteActionItemToChildIssue(
  issueId: string,
  itemId: string,
  opts: MaskOptions = {},
): Promise<{ parent: Issue; child: Issue } | undefined> {
  const issue = getIssue(issueId);
  if (!issue) return undefined;
  if (issue.parentId) {
    throw new Error("子IssueのAction Itemはさらに子Issueへ昇格できません（親子関係は1階層まで）");
  }
  const item = issue.actionItems.find((a) => a.id === itemId);
  if (!item) return undefined;

  const child = await createIssue(item.text, undefined, undefined, issueId, undefined, undefined, undefined, opts);
  item.done = true;
  bumpToInProgressIfNotStarted(issue);
  issue.updatedAt = Date.now();
  persist();
  recordChangeEvent("issue", issue.id, `Action Item「${item.text}」を子Issueへ昇格しました`);
  return { parent: issue, child };
}

// ユーザー依頼「EMがIssueに対して考えたこと・取ったアクション・結果を反映する」対応。
// addActionItemと同じ最小限の作りだが、done等の状態を持たない単純な追記のみ（種別を
// 分けない自由記述のため、後から編集・削除もしない——イベントソーシング的な記録として
// 積み上げるだけにする）。recordChangeEventも呼ぶため、Timelineにも自然に現れる。
export async function addLogEntry(
  issueId: string,
  text: string,
  opts: MaskOptions = {},
): Promise<Issue | undefined> {
  const issue = getIssue(issueId);
  if (!issue) return undefined;
  const trimmed = text.trim();
  if (!trimmed) return issue;
  await ensureNameCandidatesAllowed([trimmed], opts);
  const masked = await maskForStorage(trimmed);
  issue.logEntries.push({ id: randomUUID(), text: masked, createdAt: Date.now() });
  bumpToInProgressIfNotStarted(issue);
  issue.updatedAt = Date.now();
  persist();
  recordChangeEvent("issue", issue.id, `経過ログを追加: 「${masked}」`);
  await scheduleIssueUpdateAnalysis(issue.id, "log", masked);
  return issue;
}

export function toggleActionItem(issueId: string, itemId: string): Issue | undefined {
  const issue = getIssue(issueId);
  if (!issue) return undefined;
  const item = issue.actionItems.find((a) => a.id === itemId);
  if (!item) return undefined;
  item.done = !item.done;
  bumpToInProgressIfNotStarted(issue);
  issue.updatedAt = Date.now();
  persist();
  recordChangeEvent("issue", issue.id, `Action Item「${item.text}」を${item.done ? "完了" : "未完了"}にしました`);
  return issue;
}

// 誤登録の取り消し用。完了済みも含め配列から除去する（アーカイブではなくハード削除）。
// 「次の一手」を消した場合は、残りの未完了先頭が自然に次の一手になる。
export function removeActionItem(issueId: string, itemId: string): Issue | undefined {
  const issue = getIssue(issueId);
  if (!issue) return undefined;
  const index = issue.actionItems.findIndex((a) => a.id === itemId);
  if (index < 0) return undefined;
  const [item] = issue.actionItems.splice(index, 1);
  issue.updatedAt = Date.now();
  persist();
  recordChangeEvent("issue", issue.id, `Action Item「${item.text}」を削除しました`);
  return issue;
}

// docs/em_ui_ux_issue.md 4節対応。statusはEMがカンバン・詳細画面から明示的に切り替える
// （blocked/doneは事実から自動推定しない。§2.4の思想と同じ）。
// docs/issue_tracker_contract.md §3: done への遷移で doneAt を立て、離脱で消す（介入効果の起点）。
export function setIssueStatus(issueId: string, status: IssueStatus): Issue | undefined {
  const issue = getIssue(issueId);
  if (!issue) return undefined;
  if (issue.status === status) return issue;
  issue.status = status;
  if (status === "done") {
    issue.doneAt = Date.now();
  } else {
    issue.doneAt = undefined;
  }
  issue.updatedAt = Date.now();
  persist();
  recordChangeEvent("issue", issue.id, `ステータスを変更しました: ${status}`);
  return issue;
}

function compactFocusOrders(): void {
  const focus = issues
    .filter((i) => i.priority === "focus")
    .sort((a, b) => (a.focusOrder ?? 0) - (b.focusOrder ?? 0));
  focus.forEach((i, idx) => {
    i.focusOrder = idx;
  });
}

const PRIORITY_LABEL: Record<IssuePriority, string> = {
  focus: "フォーカス",
  normal: "通常",
  parked: "保留",
};

// 週〜月の見通し（B）と今日のフォーカス順（A）。focus 同士は focusOrder で並べる。
export function setIssuePriority(issueId: string, priority: IssuePriority): Issue | undefined {
  const issue = getIssue(issueId);
  if (!issue) return undefined;
  if (issue.priority === priority) return issue;
  const prev = issue.priority;
  if (priority === "focus") {
    const maxOrder = Math.max(
      -1,
      ...issues.filter((i) => i.priority === "focus").map((i) => i.focusOrder ?? 0),
    );
    issue.priority = "focus";
    issue.focusOrder = maxOrder + 1;
  } else {
    issue.priority = priority;
    issue.focusOrder = undefined;
    if (prev === "focus") compactFocusOrders();
  }
  issue.updatedAt = Date.now();
  persist();
  recordChangeEvent("issue", issue.id, `優先度を変更しました: ${PRIORITY_LABEL[priority]}`);
  return issue;
}

// フォーカス帯の中だけで前後入れ替え（今日の介入順）。
export function moveFocusIssue(issueId: string, direction: "up" | "down"): Issue | undefined {
  const issue = getIssue(issueId);
  if (!issue || issue.priority !== "focus") return undefined;
  compactFocusOrders();
  const focus = issues
    .filter((i) => i.priority === "focus")
    .sort((a, b) => (a.focusOrder ?? 0) - (b.focusOrder ?? 0));
  const idx = focus.findIndex((i) => i.id === issueId);
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (idx < 0 || swapIdx < 0 || swapIdx >= focus.length) return issue;
  const tmp = focus[idx].focusOrder;
  focus[idx].focusOrder = focus[swapIdx].focusOrder;
  focus[swapIdx].focusOrder = tmp;
  const now = Date.now();
  focus[idx].updatedAt = now;
  focus[swapIdx].updatedAt = now;
  persist();
  recordChangeEvent("issue", issue.id, `フォーカス順を${direction === "up" ? "前" : "後"}へ動かしました`);
  return issue;
}

// docs/memo.md TODO「Issueのアーカイブなどができないのでできるようにする」への対応。
// 親子関係のカスケードは行わない（親をアーカイブしても子は独立してアーカイブ状態を持つ）。
// これは複雑さを避けるための意図的な簡略化で、一覧側は既定でトップレベルの
// 未アーカイブIssueのみを表示し、EMが明示的にトグルした場合のみアーカイブ済みも表示する。
export function setIssueArchived(issueId: string, archived: boolean): Issue | undefined {
  const issue = getIssue(issueId);
  if (!issue) return undefined;
  if (issue.archived === archived) return issue;
  issue.archived = archived;
  // docs/issue_tracker_contract.md §3: archived は「追わない」であり status/doneAt を触らない。
  issue.archivedAt = archived ? Date.now() : undefined;
  issue.updatedAt = Date.now();
  persist();
  recordChangeEvent("issue", issue.id, archived ? "アーカイブしました" : "アーカイブを解除しました");
  return issue;
}

// docs/memo.md「H. 戦略→Issue→結果の一本線」対応。keyResultIdはIDそのもの（自由記述では
// ない）なのでmaskForStorageは不要——agentRunId/parentIdと同じ扱い。
export function setIssueKeyResult(issueId: string, keyResultId: string | null): Issue | undefined {
  const issue = getIssue(issueId);
  if (!issue) return undefined;
  const next = keyResultId ?? undefined;
  if ((issue.keyResultId ?? null) === (next ?? null)) return issue;
  issue.keyResultId = next;
  issue.updatedAt = Date.now();
  persist();
  recordChangeEvent("issue", issue.id, next ? "Key Resultに紐付けました" : "Key Resultの紐付けを解除しました");
  return issue;
}

// docs/memo.md「I. チーム単位の憲法」対応。teamIdはIDそのものなのでmaskForStorageは不要
// （agentRunId/parentId/keyResultIdと同じ扱い）。
export function setIssueTeam(issueId: string, teamId: string | null): Issue | undefined {
  const issue = getIssue(issueId);
  if (!issue) return undefined;
  const next = teamId ?? undefined;
  if ((issue.teamId ?? null) === (next ?? null)) return issue;
  issue.teamId = next;
  issue.updatedAt = Date.now();
  persist();
  recordChangeEvent("issue", issue.id, next ? "チームに紐付けました" : "チームの紐付けを解除しました");
  return issue;
}

export function setIssueTags(issueId: string, tags: string[]): Issue | undefined {
  const issue = getIssue(issueId);
  if (!issue) return undefined;
  const next = normalizeTags(tags);
  if (next.join(",") === issue.tags.join(",")) return issue;
  issue.tags = next;
  issue.updatedAt = Date.now();
  persist();
  recordChangeEvent("issue", issue.id, `タグを更新しました: ${next.join(", ") || "(なし)"}`, next);
  return issue;
}
