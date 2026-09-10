// 複数ページ（Dashboard / Issues / Issue詳細 / Organization Context）から共有する型定義。

// docs/memo.md「H: Phase 2」対応。Issue/Teamの変更履歴（KnowledgeEvent）を画面表示するための
// クライアント向け型。サーバー側の実体（@/lib/knowledge-store）とは意図的に型を分離している
// （TeamやIssue等、他の型とも同じ既存の慣習に合わせている）。
export type KnowledgeEvent = {
  id: string;
  kind: "fact" | "interpretation";
  context: "official" | "observation" | "casual" | "complaint" | "profile";
  text: string;
  tags: string[];
  occurredAt: number;
  recordedAt: number;
};

export type JournalEntry = {
  id: string;
  rawText: string;
  tags: string[];
  people: string[];
  urgency: "low" | "mid" | "high";
  sentiment: "positive" | "negative" | "neutral";
  summary: string;
  createdAt: number;
  // docs/em_human_story_and_ux.md P1-9対応。EMが一度でも校正（確認）操作を通したかどうか。
  confirmed: boolean;
  // docs/em_human_story_and_ux.md 改修依頼対応。urgencyは書き換えず、「今どこで管理
  // されているか」を別軸で持たせる。
  resolvedIssueId?: string;
  resolvedIssueTitle?: string;
  resolutionNote?: string;
};

export function journalResolutionLabel(entry: JournalEntry): string {
  if (entry.resolvedIssueId) return "対応済み/Issue化済み";
  if (entry.resolutionNote) return "対応済み";
  return "";
}

// JournalEntryCard.tsxの解決表示と同じ判定基準（Issueで追跡中、または
// 対応メモが残っている）。/journal一覧の「対応済みを除外」フィルタと表示ラベルの
// 両方でこの1箇所を参照し、判定基準がずれないようにする。
export function isJournalEntryResolved(entry: JournalEntry): boolean {
  return !!(entry.resolvedIssueId || entry.resolutionNote);
}

// ユーザー指摘対応: 異常検知runなど、EMが書いた短い文ではなく定型の指示文＋本文という
// 長いtaskをそのままIssueタイトルに使うと、単純なslice(0, n)では文の途中（しかも
// 肝心の本文へ辿り着く前）でちぎれ、省略されたことも分からない見た目になっていた。
// Issueタイトルを作る全箇所でこの1箇所を通し、上限超過時は「…」を付けて明示する。
export function truncateForTitle(text: string, maxLength = 60): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 1).trimEnd()}…`;
}

// docs/memo.md「I. チーム単位の憲法（ミッション／制約）」対応。
export type TeamCharter = {
  mission: string;
  constraints: string;
};

export type Team = {
  id: string;
  name: string;
  members: string[];
  charter: TeamCharter;
  archived: boolean;
  // ユーザー要望「部下(自分が管理するチームのメンバー)とそれ以外を分けたい」対応。
  // 既定はtrue(＝自分が管理するチーム)。パートナーチーム・ステークホルダーチームなど、
  // 所属メンバーの1on1実施やIssueをEMが主体的に扱わないチームだけfalseにする想定。
  // 既存チームの移行はorg-context-store.ts側で読み込み時に`?? true`を補う（既定を
  // 変えずに済むよう、無指定は「自分のチーム」として扱う）。
  managedByEm: boolean;
  // ユーザー要望「チーム名についても表記揺れ対応できると嬉しい」対応。
  aliases: string[];
  createdAt: number;
  updatedAt: number;
};

// docs/memo.md TODO「チームの組織階層を入力できるようにする（チーム名で `/` をつけると
// 組織階層をつけられるようにする）」への対応。独立した親子フィールドは持たせず、
// チーム名自体を`/`区切りのパスとして解釈する軽量な設計にしている
// （例: "Engineering / Team A" → ["Engineering", "Team A"]）。
// `/`の前後の空白は名前の一部とみなさない。
export function teamPathSegments(name: string): string[] {
  return name
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
}

// 保存・比較用の正規化名（区切りは"/"、前後の余分な空白を除去）。
export function normalizeTeamName(name: string): string {
  const segments = teamPathSegments(name);
  return segments.length > 0 ? segments.join("/") : name.trim();
}

// 表示用（パンくず風に" / "区切りで見せる）。
export function teamDisplayName(name: string): string {
  const segments = teamPathSegments(name);
  return segments.length > 0 ? segments.join(" / ") : name;
}

export type OrgStrategy = {
  mission: string;
  vision: string;
  values: string;
};

// docs/memo.md「H. 戦略→Issue→結果の一本線」対応。以前は自由記述1本の`okr`文字列だった
// OKRを、Objective（目標）ごとにKeyResult（主要な結果）を持つ最小構造に置き換える。
// 進捗は手動入力ではなく、KeyResultへ紐付いたIssueのうち active（!archived）の
// status=done 件数から機械的に出す（docs/issue_tracker_contract.md §4）。
export type KeyResult = {
  id: string;
  title: string;
};

export type Objective = {
  id: string;
  title: string;
  // ユーザー要望「目標のカスケーディング構成」対応。未指定＝組織全体のトップレベル目標、
  // 指定時はそのチーム自身の目標（＝上位の組織目標を達成するための下位目標）。
  teamId?: string;
  keyResults: KeyResult[];
  createdAt: number;
  updatedAt: number;
};

export type KeyResultProgress = {
  keyResultId: string;
  total: number;
  done: number;
};

export type ObjectiveWithProgress = Objective & {
  progress: KeyResultProgress[];
};

// ユーザー要望「利用するAIツールの優先度を設定で変更できるようにしたい」対応。以前は
// claude→agy→cursorの順が固定だったが、この並びを設定で入れ替えられるようにする。
// ユーザー指摘「claude codeが外せないようになっているので外せるようにしておいて
// ほしい」対応で、claudeも他の2つと同様に除外できる（最低1つは候補として残す
// 必要があり、配列を空にはできない）。
export const CLI_OPTIONS = ["claude", "agy", "cursor"] as const;
export type CliName = (typeof CLI_OPTIONS)[number];
export const CLI_LABELS: Record<CliName, string> = {
  claude: "Claude Code CLI",
  agy: "agy（Gemini）",
  cursor: "Cursor CLI",
};

// デバウンス待ちの自動エージェント起動予定（Issue更新分析など）。
// agent-runtimeが発行し、GET /api/agents経由でUIへ公開する。
export type PendingAgentStartKind = "issue-update";
export type PendingAgentStart = {
  id: string;
  kind: PendingAgentStartKind;
  /** UI向け短い説明（例: 「課題の更新分析」） */
  label: string;
  firesAt: number;
  issueId?: string;
  issueTitle?: string;
  detail?: string;
};

// 未登録の人名候補があり、登録せず未マスクのまま外部送信してよいかEM確認待ち。
export type PendingUnmaskedSendKind = "start-run" | "decide-run";
export type PendingUnmaskedSend = {
  id: string;
  kind: PendingUnmaskedSendKind;
  candidates: string[];
  label: string;
  issueId?: string;
  issueTitle?: string;
  agentName?: string;
  task?: string;
  origin?: "manual" | "auto-anomaly" | "auto-summary" | "auto-issue-update";
  linkedIssueId?: string;
  runId?: string;
  message?: string;
  /** Issue更新分析のdecide-run確認時に、チーム先行並列を行うか */
  teamParallelKickoff?: boolean;
};

export type RulesAndConstraints = {
  teamWindowDays: number;
  minEntriesForJudgement: number;
  teamBadSentimentMax: number;
  teamWarnSentimentMax: number;
  coverageWindowDays: number;
  coverageGoodRatio: number;
  coverageWarnRatio: number;
  agentStaleAfterSeconds: number;
  agentKillAfterSeconds: number;
  journalFactTtlDays: number;
  autoAnomalyDetectionEnabled: boolean;
  // Journal自動分析の緊急度フィルタ（settings-storeと同義）。
  autoJournalUrgencyFilter: "all" | "mid_or_higher" | "high_only";
  // Journal自動分析の感情フィルタ（settings-storeと同義）。
  autoJournalSentimentFilter: "all" | "negative_only";
  // Issue Why/What/How・経過ログ更新時の自動分析（既定OFF）。
  autoIssueUpdateAnalysisEnabled: boolean;
  autoMorningSummaryEnabled: boolean;
  autoMorningSummaryHour: number;
  // ユーザー指摘「設定変更時に、それまで起動していなかったエージェントが一気に並列で
  // 起動することがある」対応。同時に「実行中」にできるエージェント（CLI子プロセス）数の
  // 上限。超過分はキューイングされ、Agent Runの一覧でstatus:"queued"として見える。
  maxParallelAgentRuns: number;
  // Issue紐付きLead起動時に関連specialistを先行並列起動し、Leadが統合する（既定ON）。
  teamParallelKickoffEnabled: boolean;
  // docs/em_ui_ux_issue.md 2.2/4節「AI主導トリアージ・上限N件への圧縮」対応。Morning Modeで
  // 前面に出す「判断待ち（decision）」「観測不足（observation）」レーンそれぞれの表示上限。
  // 超過分は非表示にはせず、「もっと見る」で追加表示できる。
  decisionQueueLimit: number;
  observationQueueLimit: number;
  // docs/em_ui_ux_issue.md 4節「AIによる進捗アシスト」対応。介入（Issue）が何日動きが無ければ
  // 「観測不足」として朝キューに再浮上させるかの閾値。既定14日は過去のP1-10対応でのチューニング
  // 値を維持し、EMが好みに応じて短くできるようにする。
  staleInterventionDays: number;
  // AGENT_OPTIONSの値をキーにした、エージェント種別ごとのモデル系統指定。キーが無い
  // （または値が空文字列の）エージェントはclaude CLIの既定モデルのまま動く。
  agentModelTiers: Partial<Record<string, ModelTier>>;
  // ユーザー要望「エージェント種別ごとのモデル系統に関して、Cursor/agyについても調整
  // できるようにしたい」対応。claudeのagentModelTiersと違い、agy/cursorのモデルは
  // （エイリアスではなく）バージョン付きの具体名でしか指定できない実機確認済みの制約が
  // あるため、系統選択のプルダウンではなく自由入力の文字列にする。キーが無い（または
  // 空文字列の）エージェントはagent-runtime.tsの既定モデル定数のまま動く。
  agentAgyModels: Partial<Record<string, string>>;
  agentCursorModels: Partial<Record<string, string>>;
  // ユーザー指摘「AIツールの優先度設定が増えたことでフォールバック設定との競合が発生
  // している」対応。以前はcliPriorityOrder（全エージェント共通の並び順）と
  // agyFallbackAgents/cursorFallbackAgents（エージェント種別ごとのON/OFF）という
  // 2つの設定が別々に存在し、「順番を変えたのに反映されない（OFFのままだから）」
  // といった混乱を招いていた。ユーザー指摘「エージェントごとに設定できる必要はない、
  // 全体で1つで大丈夫」対応で、エージェント種別ごとではなく全エージェント共通の
  // 単一のCLI優先順位リストへ統合する——配列に含まれるCLIだけが候補になり
  // （＝「除外」は配列から外すことで表現する）、含まれる順が試行順になる
  // （＝「優先度」）。ユーザー指摘「claude codeが外せないようになっている」対応で、
  // claudeも他の2つと同様に除外できる（配列を空にはできず、最低1つは必ず候補に残す）。
  // 既定["claude"]（＝agy/cursorは無効、既存の挙動を変えない）。
  cliOrder: CliName[];
};

// docs/memo.md TODO「動いていると思ったら止まっていた、を防ぐ」への対応。
// statusが"active"のままログ更新（updatedAt）が閾値以上無ければ「応答なし」とみなす。
// 実際にkillするかどうかの判断はサーバー側（agent-runtime.tsのwatchdog）の責務で、
// これはあくまで表示用の軽量な判定（Team Vitalsの「評価不能」判定と同じ考え方）。
export function isRunStale(status: string, updatedAt: number, staleAfterSeconds: number): boolean {
  return status === "active" && Date.now() - updatedAt > staleAfterSeconds * 1000;
}

export type VitalStatus = "good" | "warn" | "bad" | "unknown";

export type TeamVital = {
  teamId: string;
  teamName: string;
  status: VitalStatus;
  label: string;
  reason: string;
  members: string[];
  managedByEm: boolean;
};

export type CoverageVital = {
  status: VitalStatus;
  covered: number;
  total: number;
  reason: string;
  uncoveredMembers: string[];
};

export type OrgVitals = {
  teams: TeamVital[];
  oneOnOneCoverage: CoverageVital;
};

export type ActionItem = {
  id: string;
  text: string;
  done: boolean;
};

// Action Items進行管理（Next Action）: 未完了のうち配列先頭が「次の一手」。
// 残り未完了は backlog、完了済みは完了リスト。タスクトラッカー化せず、介入の焦点を1件に絞る。
export function issueNextAction(issue: Issue): ActionItem | undefined {
  return issue.actionItems.find((a) => !a.done);
}

export function issueBacklogActionItems(issue: Issue): ActionItem[] {
  const next = issueNextAction(issue);
  return issue.actionItems.filter((a) => !a.done && a.id !== next?.id);
}

// Dashboard横断表示の上限。朝キューを増やしすぎない（docs/em_ui_ux_issue.md §2）。
export const INTERVENTION_NEXT_ACTION_LIMIT = 3;

// Action Item（この介入の一手）と子Issue（別の介入物語）の境界。UIヘルプとAIプロンプトで共有する。
export const ACTION_ITEM_VS_SUB_ISSUE_HELP =
  "判断の目安: 「この介入の次の一手か？」→ Action Item。「独自の Why/What/How を持つ別の介入か？」→ 子Issue。";

// docs/em_ui_ux_issue.md 4節「ステータス管理の導入」対応。archived（2値）だけでは
// 「進行中」と「ブロッカーあり」を区別できないため、別軸のステータスを持たせる。
// blocked/doneへの遷移はEMの明示操作を主とし、not_started→in_progressだけは
// 事実（Action Item追加・経過ログ追加）から機械的に自動昇格させる（issue-store.ts参照）。
export type IssueStatus = "not_started" | "in_progress" | "blocked" | "done";

export const ISSUE_STATUSES: IssueStatus[] = ["not_started", "in_progress", "blocked", "done"];

export const ISSUE_STATUS_META: Record<IssueStatus, { icon: string; label: string }> = {
  not_started: { icon: "⚪️", label: "未着手" },
  in_progress: { icon: "🔵", label: "進行中" },
  blocked: { icon: "🟡", label: "ブロッカーあり(Waiting)" },
  done: { icon: "✅", label: "完了（解決）" },
};

// ユーザー依頼「EMがIssueに対して考えたこと・取ったアクション・結果を反映する」対応。
// 進行中に思いついた時点でひとこと書き足すだけの自由記述ログ（種別を分けない）。
export type IssueLogEntry = {
  id: string;
  text: string;
  createdAt: number;
};

// Issueの計画・実行前に明らかにしておくべき3要素。各項目は空文字列（＝未整理）を許容する。
export type IssueCharter = {
  why: string;
  what: string;
  how: string;
};

export type IssuePriority = "focus" | "normal" | "parked";

export const ISSUE_PRIORITIES: IssuePriority[] = ["focus", "normal", "parked"];

export const ISSUE_PRIORITY_META: Record<IssuePriority, { icon: string; label: string; hint: string }> = {
  focus: { icon: "🔥", label: "フォーカス", hint: "今週〜今月で進める介入。朝の次の一手の主対象" },
  normal: { icon: "➖", label: "通常", hint: "進行中だが、いまの主戦場ではない" },
  parked: { icon: "🅿️", label: "保留", hint: "様子見・後回し。朝キューには載せない" },
};

export type Issue = {
  id: string;
  title: string;
  agentRunId?: string;
  charter: IssueCharter;
  actionItems: ActionItem[];
  logEntries: IssueLogEntry[];
  parentId?: string;
  status: IssueStatus;
  // 介入ポートフォリオの優先帯。focus=今週〜今月の主戦場、parked=朝キュー外。
  // 未設定の旧データは normal 扱い（issue-store の読み込み補完）。
  priority: IssuePriority;
  // focus 同士の順序（小さいほど先）。priority !== "focus" のときは未定義。
  focusOrder?: number;
  archived: boolean;
  // docs/issue_tracker_contract.md §3。archived=追わない（一覧退避）。効果測定には使わない。
  archivedAt?: number;
  // docs/issue_tracker_contract.md §3／案α。status=done になった時刻。介入効果の起点。
  doneAt?: number;
  tags: string[];
  // docs/memo.md「H. 戦略→Issue→結果の一本線」対応。このIssueがどのKey Resultに
  // 貢献するかの紐付け（任意）。
  keyResultId?: string;
  // docs/memo.md「I. チーム単位の憲法」対応。このIssueがどのチームに関するものかの
  // 紐付け（任意）。Agent Runtimeへの動的ロードで、そのチームのMission/制約だけを
  // 絶対の前提として注入するために使う。
  teamId?: string;
  createdAt: number;
  updatedAt: number;
};

// 一覧・Dashboard横断の並び: focus（focusOrder）→ normal（更新新しい順）→ parked。
export function compareIssuesByPriority(a: Issue, b: Issue): number {
  const rank: Record<IssuePriority, number> = { focus: 0, normal: 1, parked: 2 };
  const pa = a.priority ?? "normal";
  const pb = b.priority ?? "normal";
  if (rank[pa] !== rank[pb]) return rank[pa] - rank[pb];
  if (pa === "focus" && pb === "focus") {
    const oa = a.focusOrder ?? Number.MAX_SAFE_INTEGER;
    const ob = b.focusOrder ?? Number.MAX_SAFE_INTEGER;
    if (oa !== ob) return oa - ob;
  }
  return b.updatedAt - a.updatedAt;
}

export function charterFilledCount(charter: IssueCharter): number {
  return [charter.why, charter.what, charter.how].filter((v) => v.trim().length > 0).length;
}

// docs/issue_tracker_contract.md §3。朝キュー・ボード・停滞の共通定義。
export function isIssueActive(issue: Pick<Issue, "archived" | "status">): boolean {
  return !issue.archived && issue.status !== "done";
}

// docs/em_ui_ux_issue.md 4節「進捗の視覚化」＋ docs/issue_tracker_contract.md §4。
// Action Items の完了数に、子 Issue のうち !archived かつ status=done を合算する。
// アーカイブした子は分母からも外す（追わない＝進捗対象外）。suggested* はここには来ない。
// 0/0 のときは「項目なし」であって「100%完了」ではないため、呼び出し側で区別すること。
export function issueProgress(issue: Issue, childIssues: Issue[] = []): { done: number; total: number } {
  const actionDone = issue.actionItems.filter((a) => a.done).length;
  const activeChildren = childIssues.filter((c) => !c.archived);
  const childDone = activeChildren.filter((c) => c.status === "done").length;
  return { done: actionDone + childDone, total: issue.actionItems.length + activeChildren.length };
}

// docs/em_ui_ux_issue.md 4節「AIによる進捗アシスト」対応。旧page.tsxのstaleInterventions
// ロジック（14日間動きが無い介入の検知）を共有ヘルパーへ切り出し、一覧・ボード双方の
// 表示から再利用できるようにする。着手前（charter未整理かつAction Item無し）は対象外。
export function isIssueStalled(issue: Issue, now: number, staleDays: number): boolean {
  if (!isIssueActive(issue) || issue.parentId) return false;
  if (charterFilledCount(issue.charter) === 0 && issue.actionItems.length === 0) return false;
  return now - issue.updatedAt > staleDays * 24 * 60 * 60 * 1000;
}

// docs/em_ui_ux_issue.md 5節「Yield種別カードUI」対応。§2.3のDecide/Inform/Commitの区別を
// YieldRequestに持たせる。AIプロンプト側の指示は@/lib/agent-runtime.tsのbuildSystemPrompt、
// パースはextractYieldを参照。省略された場合は既存run（後方互換）としてUI側でフォールバック推定する。
export type YieldKind = "decide" | "inform" | "commit";

export const YIELD_KIND_META: Record<YieldKind, { icon: string; label: string; description: string }> = {
  decide: { icon: "🔀", label: "Decide", description: "複数の案から選んでください" },
  inform: { icon: "📋", label: "Inform", description: "判断に必要な前提情報を教えてください" },
  commit: { icon: "🤝", label: "Commit", description: "介入の実行・人への働きかけ・優先順位変更を決めてください" },
};

// docs/memo.md「F. Product Agentの追加」対応。People(人)/Process(組織運営)/Tech(実装)の
// 3象限に、Product(顧客価値・優先順位・ロードマップ)を足して4象限を埋める。
export const AGENT_OPTIONS = ["Lead Agent", "People Agent", "Process Agent", "Tech Agent", "Product Agent"];

// ユーザー要望「エージェントが使うモデルを設定で事前に決めたい」対応。Claude Codeの
// 「計画立案はOpus、単純な分析はSonnet」のような使い分けに倣い、エージェント種別ごとに
// モデルの"系統"（claude CLIの--modelが受け付けるエイリアス）を指定できるようにする。
// モデルは日々更新されるため、特定バージョン（例: claude-sonnet-5-20260101）ではなく
// 系統名にとどめる。空文字列は「claude CLIの既定モデルのまま」を意味し、既定値
//（DEFAULT_RULES.agentModelTiers = {}）では全エージェントが未設定＝既存の挙動を変えない。
export const MODEL_TIER_OPTIONS = ["sonnet", "opus", "fable", "haiku"] as const;
export type ModelTier = (typeof MODEL_TIER_OPTIONS)[number];

// docs/memo.md「G. Issueに『介入の型』を足す」対応。実装タスク箱ではなく「仕組み・人・組織への
// 介入」へIssueの切り口を寄せるためのプリセット。保存先は既存のtags（新規フィールドは増やさない）で、
// why/what/howはあくまでプレースホルダー（初期文面のヒント）として使い、EMが実際に入力した内容は
// 上書きしない。
export type InterventionType = { label: string; why: string; what: string; how: string };

export const INTERVENTION_TYPES: InterventionType[] = [
  {
    label: "役割明確化",
    why: "誰が何に責任を持つか曖昧で、手戻り／待ちが発生している",
    what: "各役割の責任範囲と意思決定権限を明文化し、関係者間で合意する",
    how: "現状のタスク分担を棚卸しし、責任者不在の領域を洗い出してオーナーを割り当てる",
  },
  {
    label: "意思決定プロセス",
    why: "決まる場所が無く、現場が止まったりエスカレーションが遅れる",
    what: "何を誰がどの場で決めるかのプロセスを定義し、関係者に周知する",
    how: "現状の意思決定の流れを可視化し、詰まっているポイントに承認者・会議体を設ける",
  },
  {
    label: "依存関係の切り方",
    why: "チーム間の依存が強く、片方の遅延がもう片方をブロックしている",
    what: "依存関係を整理し、疎結合にできる境界（インターフェース・契約）を定義する",
    how: "依存元・依存先のタスクを洗い出し、非同期化やインターフェース固定で結合度を下げる",
  },
  {
    label: "1on1設計",
    why: "1on1の頻度・目的が曖昧で、メンバーの状態変化を拾えていない",
    what: "対象メンバーとの1on1の頻度・アジェンダ・記録方法を決める",
    how: "カレンダーに定例枠を確保し、Quick Journalへの記録をセットで運用する",
  },
  {
    label: "プロセス変更",
    why: "既存のプロセスがチームの実態に合わず、無駄な手戻りや待ちが生まれている",
    what: "どのプロセスをどう変えるか、変更後の運用ルールを定義する",
    how: "現状のプロセスの課題を洗い出し、小さく試して効果を見ながら本格導入する",
  },
  {
    label: "優先順位／スコープ",
    why: "何を優先すべきかの基準が無く、並行タスクで摩耗が起きている",
    what: "優先順位の基準とスコープの境界を明確にし、関係者と合意する",
    how: "影響度・緊急度などの基準を決め、バックログを並べ替えて共有する",
  },
  {
    label: "心理的安全性",
    why: "発言や失敗の共有がしづらい空気があり、問題の発見・共有が遅れている",
    what: "チームが安心して意見や懸念を言える状態を作る",
    how: "1on1やチームふりかえりで小さな懸念から拾い、対応した結果を可視化する",
  },
  {
    label: "採用・オンボーディング",
    why: "採用基準やオンボーディングの流れが定まっておらず、立ち上がりが遅い",
    what: "採用基準とオンボーディングの流れ・完了条件を明確にする",
    how: "必要スキル・カルチャーフィットの基準を整理し、最初の30/60/90日の計画を作る",
  },
];

export const VITAL_ICON: Record<VitalStatus, string> = {
  good: "🟢",
  warn: "🟡",
  bad: "🔴",
  unknown: "⚪️",
};

export const URGENCY_LABEL: Record<JournalEntry["urgency"], string> = {
  low: "Urgency: Low",
  mid: "Urgency: Mid",
  high: "Urgency: High",
};

// docs/memo.md「J. Peopleを第一級ハブに」対応。新規の永続化エンティティは持たず、
// 既存のpeople-directory／Journal fact・解釈／チーム所属／関連Issueを人物軸で束ねた
// 集約ビュー（@/lib/people-hub.tsのサーバー側の型と対応）。
export type PersonTrend = { positive: number; negative: number; neutral: number };

// 改修依頼「Peopleを労務SaaS的な視覚スコア表示に」対応。Team Vitals
// （lib/vitals.tsのcomputeOrgVitals、平均sentimentスコア＋設定可能な閾値）と同じ
// 「ネガティブ優勢→bad／件数不足→unknown」という判定思想を踏襲するが、こちらは
// 一覧カードの軽量な視覚表示用なので、Team Vitalsのような設定可能な閾値
// （RulesAndConstraints）は持たない単純な多数決にする。
// ユーザー指摘「バイタルがIssueの状況(停滞・ブロッカー)に対して問題無いように見える」対応。
// hasConcerningIssue（ブロッカーあり・停滞中の関連Issueが1件でもあるか）がtrueの場合、
// Journalのsentimentだけでは"good"/"unknown"に見えていても、少なくとも"warn"へ引き上げる
// （"warn"/"bad"は据え置き＝Issueの状況で評価を下げることはあっても甘くはしない）。
export function personVitalStatus(trend: PersonTrend, hasConcerningIssue = false): VitalStatus {
  const total = trend.positive + trend.negative + trend.neutral;
  const base: VitalStatus = total < 2 ? "unknown" : trend.negative > trend.positive ? "bad" : trend.negative === trend.positive && trend.negative > 0 ? "warn" : "good";
  if (hasConcerningIssue && (base === "good" || base === "unknown")) return "warn";
  return base;
}

// ユーザー指摘「人のスコアを、どのくらい気をかけるべきかのバイタル表示にしたい」対応。
// lib/vitals.ts（Team Vitals）の文言（bad="要注意"／warn="やや注意"／good="安定"）と
// 揃え、アプリ全体で同じVitalStatusの意味付けにする。
export const PERSON_VITAL_LABEL: Record<VitalStatus, string> = {
  good: "安定",
  warn: "やや注意",
  bad: "要注意",
  unknown: "評価不能",
};

export type PersonSummary = {
  id: string;
  name: string;
  // ユーザー要望「メンバーの表記揺れに対応できる仕組みが欲しい」対応。
  aliases: string[];
  teamNames: string[];
  trend: PersonTrend;
  factCount: number;
  isDirectReport: boolean;
  hasConcerningIssue: boolean;
};

export type PersonFact = {
  id: string;
  text: string;
  tags: string[];
  sentiment?: "positive" | "negative" | "neutral";
  urgency?: "low" | "mid" | "high";
  occurredAt: number;
};

export type PersonRelatedIssue = {
  id: string;
  title: string;
  archived: boolean;
  charter: IssueCharter;
};

export type PersonProfile = PersonSummary & {
  facts: PersonFact[];
  interpretations: { id: string; text: string; occurredAt: number }[];
  relatedIssues: PersonRelatedIssue[];
};

// docs/memo.md「L. 介入の閉ループ（やった→組織が変わったか）」対応。
// docs/em_human_story_and_ux.md P2-15対応でinProgressを追加（アーカイブ前の暫定値かどうか）。
export type ImpactWindow = { total: number; positive: number; negative: number };
export type IssueImpact = { windowDays: number; before: ImpactWindow; after: ImpactWindow; inProgress: boolean };

// docs/memo.md「N. 時系列変化をEMが読む物語に」対応。
export type TimelineEntityType = "journal" | "person" | "team" | "issue" | "org";

export type TimelineEntry = {
  id: string;
  entityType: TimelineEntityType;
  entityId?: string;
  entityLabel?: string;
  href?: string;
  text: string;
  occurredAt: number;
};

export const TIMELINE_ENTITY_TYPE_LABEL: Record<TimelineEntityType, string> = {
  issue: "Issue",
  team: "Team",
  org: "Objective",
  journal: "Journal",
  person: "Person",
};

// docs/memo.md TODO「Quick Journal、Issue進捗、各種イベントを週次・月次でレポーティングする
// 機能を追加する」対応。サーバー側の実体（@/lib/report-store）とは意図的に型を分離している
// （他のストアと同じ既存の慣習に合わせている）。
export type ReportPeriodType = "week" | "month";

export const REPORT_PERIOD_LABEL: Record<ReportPeriodType, string> = { week: "週次", month: "月次" };

export type ReportJournalStats = {
  total: number;
  byUrgency: { low: number; mid: number; high: number };
  bySentiment: { positive: number; negative: number; neutral: number };
  topTags: { tag: string; count: number }[];
  notableEntries: { id: string; summary: string; urgency: string; sentiment: string; occurredAt: number }[];
};

export type ReportIssueStats = {
  createdCount: number;
  doneCount?: number;
  archivedCount: number;
  openIncompleteCount: number;
  createdTitles: { id: string; title: string }[];
  doneTitles?: { id: string; title: string }[];
  archivedTitles: { id: string; title: string }[];
};

export type ReportEventStats = {
  total: number;
  byEntityType: Partial<Record<TimelineEntityType, number>>;
};

export type ReportStats = {
  journal: ReportJournalStats;
  issues: ReportIssueStats;
  events: ReportEventStats;
};

export type Report = {
  id: string;
  periodType: ReportPeriodType;
  periodStart: number;
  periodEnd: number;
  generatedAt: number;
  stats: ReportStats;
  note: string;
};

// docs/memo.md TODO「人間EM自体の成長に対する向き合いを作る。EM本人のバイタル、週次振り返りの
// 入力・改善方針機能を作る」対応。
export type EmCheckin = {
  id: string;
  mood: number;
  energy: number;
  stress: number;
  note: string;
  createdAt: number;
};

// 改修依頼「週次振り返りを『思いついたときに書き込み、レポートの週次で振り返る』
// 仕組みに」対応。1件＝Keep/Problem/Tryのいずれか1つの気づきメモ。週単位の集計は
// 表示側（growth/page.tsx）でcreatedAtからグルーピングする。
export type ReflectionNoteType = "keep" | "problem" | "try";

export type EmReflectionNote = {
  id: string;
  type: ReflectionNoteType;
  text: string;
  createdAt: number;
};
