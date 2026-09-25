// 複数ページ（Dashboard / Suggestions / Suggestion詳細 / Organization Context）から共有する型定義。

import { effectiveAdviceText, type AdviceStructured } from "./advice";

export type { AdviceStructured, AdviceGroup, AdviceFollowUp } from "./advice";

// Issue/Teamの変更履歴（KnowledgeEvent）を画面表示するためのクライアント向け型。
// サーバー側の実体（@/lib/knowledge-store）とは意図的に型を分離している
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
  // 関連チーム（複数可）。内部・APIとも Team.id。表示名は teamNames（Viewでのみ埋まる）。
  teamIds: string[];
  teamNames?: string[];
  urgency: "low" | "mid" | "high";
  sentiment: "positive" | "negative" | "neutral";
  summary: string;
  createdAt: number;
  // EMが一度でも校正（確認）操作を通したかどうか。
  confirmed: boolean;
  // urgencyは書き換えず、「今どこで管理されているか」を別軸で持たせる。
  resolvedSuggestionId?: string;
  resolvedSuggestionTitle?: string;
  resolutionNote?: string;
  // Journalから自動分析／手動相談が立ったときの Lead run。supersedes後も現行版から辿れる。
  sourceConsultRunId?: string;
  // 外部ログ取り込み由来。
  sourceDumpId?: string;
  sourceChunkId?: string;
  // sentimentは観測値のまま残しつつ、EMが確認済み・対応不要と判断した事実を別軸で持つ。
  noActionNeededAt?: number;
  noActionNeededNote?: string;
  // 重複記録・誤入力等のJournalを一覧・AIの判断材料から除外する（記録自体は削除しない）。
  archivedAt?: number;
  // センシティブ設定。UI 一覧から既定で除外する（エージェント／分析入力からは除外しない）。
  sensitiveAt?: number;
};

export function journalResolutionLabel(entry: JournalEntry): string {
  if (entry.resolvedSuggestionId) return "対応済み/提案化済み";
  if (entry.resolutionNote) return "対応済み";
  return "";
}

// JournalEntryCard.tsxの解決表示と同じ判定基準（提案で追跡中、または
// メモが残っている）。/journal一覧の「対応済みを除外」フィルタと表示ラベルの
// 両方でこの1箇所を参照し、判定基準がずれないようにする。
export function isJournalEntryResolved(entry: JournalEntry): boolean {
  return !!(entry.resolvedSuggestionId || entry.resolutionNote);
}

// 結論文から提案タイトル候補を作る。AIが「〜を提案化して追跡すべきと判断します」のような
// 判断メタを conclusion に書くことが多く、そのままタイトルにすると途中で切れて見える。
// suggestionTitle フィールドが無い旧出力・フォールバック向けのヒューリスティック。
// 旧プロンプト（"Issue化"表記）で生成済みの過去テキストにも同じ整形を適用できるよう、
// 新旧両方の表記パターンを残す。
const CONCLUSION_TITLE_META_SUFFIXES = [
  /を?(?:提案|Issue)化して追跡すべきだ?と?判断します[。．.]?$/u,
  /を?(?:提案|Issue)として追跡すべきだ?と?判断します[。．.]?$/u,
  /を?(?:提案|Issue)化して追跡すべきです[。．.]?$/u,
  /を?(?:提案|Issue)として追跡すべきです[。．.]?$/u,
  /を?(?:提案|Issue)化すべきだ?と?判断します[。．.]?$/u,
  /を?(?:提案|Issue)化を検討すべきだ?と?判断します[。．.]?$/u,
  /(?:提案|Issue)化を検討すべきだ?と?判断します[。．.]?$/u,
  /(?:提案|Issue)化を検討します[。．.]?$/u,
  /を?(?:提案|Issue)化して追跡すべきだ?$/u,
  /を?(?:提案|Issue)として追跡すべきだ?$/u,
  /を?(?:提案|Issue)化すべきだ?$/u,
  /と判断します[。．.]?$/u,
  /と考えます[。．.]?$/u,
];

export function suggestionTitleFromConclusion(conclusion: string): string {
  let text = conclusion.trim().replace(/\s+/g, " ");
  if (!text) return text;
  for (const re of CONCLUSION_TITLE_META_SUFFIXES) {
    const next = text.replace(re, "").trim();
    if (next) text = next;
  }
  return text.replace(/[。．.]+$/u, "").trim() || conclusion.trim();
}

// 定型の指示文＋本文という長いtaskをそのまま提案タイトルに使うと、単純なslice(0, n)では
// 文の途中でちぎれ、省略されたことも分からない見た目になる。提案タイトルを作る全箇所で
// この1箇所を通し、上限超過時は句読点付近で切って「…」を付ける。
// （句点で自然に終わった場合は「…」を付けない。）
export function truncateForTitle(text: string, maxLength = 80): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (trimmed.length <= maxLength) return trimmed;
  const budget = maxLength - 1;
  const head = trimmed.slice(0, budget);
  const minKeep = Math.floor(budget * 0.5);
  const isBreak = (ch: string) => /[。．.！!？?、，,；;：:\n\s]/u.test(ch);
  const isTerminal = (ch: string) => /[。．.！!？?]/u.test(ch);
  let breakAt = -1;
  for (let i = head.length - 1; i >= minKeep; i--) {
    if (isBreak(head[i]!)) {
      breakAt = i;
      break;
    }
  }
  const cut =
    breakAt >= 0
      ? head.slice(0, isTerminal(head[breakAt]!) || /[、，,；;：:]/u.test(head[breakAt]!) ? breakAt + 1 : breakAt).trimEnd()
      : head.trimEnd();
  if (/[。．.！!？?]$/u.test(cut)) return cut;
  return `${cut}…`;
}

/** チーム単位のミッション／制約。 */
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
  // 既定はtrue(＝自分が管理するチーム)。パートナー／ステークホルダー等、所属メンバーの
  // 1on1やIssueをEMが主体的に扱わないチームだけfalse。既存チームはorg-context-store側で
  // 読み込み時に`?? true`を補う（無指定は「自分のチーム」）。
  managedByEm: boolean;
  // 表記揺れ用の別名。
  aliases: string[];
  createdAt: number;
  updatedAt: number;
};

// 独立した親子フィールドは持たせず、チーム名自体を`/`区切りのパスとして解釈する
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

/** 見出し（必須の中核文）＋補足（解釈を閉じる説明・任意）。メモ欄とは別。 */
export type StatementElaboration = {
  statement: string;
  elaboration?: string;
};

export type OrgStrategy = {
  /** Mission の見出し */
  mission: string;
  missionElaboration?: string;
  /** Vision の見出し */
  vision: string;
  visionElaboration?: string;
  /**
   * Values 見出しの結合文字列（注入・後方互換用）。
   * 編集の正本は valueItems。
   */
  values: string;
  /** Values ×N（各件が見出し＋補足） */
  valueItems?: StatementElaboration[];
};

// Standing Background: 組織の長期背景事実＋判断への含意（Core Context）。
export type OrgBackgroundScope = "always" | "tagged";
export type OrgBackgroundStatus = "active" | "archived";
export type OrgBackgroundEntry = {
  id: string;
  title: string;
  fact: string;
  implication: string;
  occurredOn?: string;
  tags: string[];
  scope: OrgBackgroundScope;
  status: OrgBackgroundStatus;
  createdAt: number;
  updatedAt: number;
};

// Goalに向かう際に
// 守りたい判断原則（大切にすること／優先すること／やらないこと／判断に迷ったときの原則、など）。
// MVVのような固定欄にはせず、OrgBackgroundEntryに近い自由記述の複数エントリにする。
// categoryは分類のヒントであり必須ではない（方針4「入力項目を埋めることを目的にしない」）。
export type PolicyCategory = "value" | "priority" | "avoid" | "principle" | "other";

export type PolicyEntry = {
  id: string;
  /** 見出し（判断原則の中核文） */
  text: string;
  /** 補足（解釈を閉じる説明・任意）。メモではない。 */
  elaboration?: string;
  category?: PolicyCategory;
  /** 一覧の手動並び順（昇順）。 */
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
  archivedAt?: number;
};

// EMとして見据えている
// 「到達したい状態」。SMARTである必要はなく、曖昧な段階から登録してよい。
export type GoalHorizon = "long" | "mid" | "near";
export type GoalStatus = "active" | "achieved" | "abandoned";

export type Goal = {
  id: string;
  /** 見出し（到達したい状態の中核文） */
  title: string;
  /** 補足（解釈を閉じる説明・任意）。運用メモとは別。 */
  elaboration?: string;
  /** 運用メモ（非注入・任意） */
  note?: string;
  teamId?: string;
  /**
   * 上位 Goal の ID（多対多）。チーム階層とは独立。
   * 空・未定義＝上位リンクなし。下位側は他 Goal の parentGoalIds から導出する。
   */
  parentGoalIds?: string[];
  horizon?: GoalHorizon;
  status: GoalStatus;
  /** 一覧の手動並び順（昇順）。 */
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
};

// Theme(採用済み)へのGoal紐づけAI提案。HITLパターン（永続化はしない。採用は既存PATCH経由）。
export type GoalLinkSourceKind = "theme";

export type GoalLinkSuggestion = {
  sourceKind: GoalLinkSourceKind;
  sourceId: string;
  sourceTitle: string;
  goalIds: string[];
  rationale: string;
  labels: { goals: string[] };
};

// CLI優先順位の候補。並びは設定（cliOrder）で入れ替え・除外できる。
// claudeも他と同様に除外可（最低1つは候補として残す必要があり、空配列にはできない）。
export const CLI_OPTIONS = ["claude", "agy", "cursor"] as const;
export type CliName = (typeof CLI_OPTIONS)[number];
export const CLI_LABELS: Record<CliName, string> = {
  claude: "Claude Code CLI",
  agy: "agy（Gemini）",
  cursor: "Cursor CLI",
};

// デバウンス待ちの自動エージェント起動予定（提案更新分析など）。
// agent-runtimeが発行し、GET /api/agents経由でUIへ公開する。
export type PendingAgentStartKind = "suggestion-update";
export type PendingAgentStart = {
  id: string;
  kind: PendingAgentStartKind;
  /** UI向け短い説明（例: 「課題の更新分析」） */
  label: string;
  firesAt: number;
  suggestionId?: string;
  suggestionTitle?: string;
  detail?: string;
};

// 未登録の人名候補があり、登録せず未マスクのまま外部送信してよいかEM確認待ち。
export type PendingUnmaskedSendKind = "start-run" | "decide-run";
export type PendingUnmaskedSend = {
  id: string;
  kind: PendingUnmaskedSendKind;
  candidates: string[];
  label: string;
  suggestionId?: string;
  suggestionTitle?: string;
  agentName?: string;
  task?: string;
  origin?:
    | "manual"
    | "auto-anomaly"
    | "auto-summary"
    | "auto-suggestion-update"
    | "auto-distill"
    | "auto-grow"
    | "auto-journal-batch"
    | "auto-weekly-report"
    | "auto-monthly-report";
  linkedSuggestionId?: string;
  sourceJournalId?: string;
  /** Themes「AIと壁打ち」起点の相談 */
  consultIntent?: "theme";
  /** 何でも相談で経営／役員目線レビューを必須consultするとき */
  requiredConsultAgents?: string[];
  runId?: string;
  message?: string;
  /** 提案更新分析のdecide-run確認時に、チーム先行並列を行うか */
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
  // 提案のタイトル・メモ更新時の自動分析（既定OFF）。
  autoSuggestionUpdateAnalysisEnabled: boolean;
  autoMorningSummaryEnabled: boolean;
  autoMorningSummaryHour: number;
  // Journalをまとめて解釈するバッチ（settings-storeと同義）。既定OFF。
  // 起動時刻は複数指定可。材料は前回カバー以降（最大7日）。
  autoJournalBatchEnabled: boolean;
  autoJournalBatchHours: number[];
  // 状況蒸留（既定OFF）。曜日は複数選択可。
  autoDistillationEnabled: boolean;
  autoDistillationWeekdays: number[];
  autoDistillationHour: number;
  // EM自身の学びの提案（Grow）の週次バッチ（既定OFF）。
  autoGrowEnabled: boolean;
  autoGrowWeekday: number;
  autoGrowHour: number;
  // 週次・月次レビューの自動起動（既定OFF）。
  autoWeeklyReportEnabled: boolean;
  autoWeeklyReportWeekday: number;
  autoWeeklyReportHour: number;
  autoMonthlyReportEnabled: boolean;
  autoMonthlyReportDay: number;
  autoMonthlyReportHour: number;
  // 同時に「実行中」にできるエージェント（CLI子プロセス）数の上限。
  // 超過分はキューイングされ、Agent Runの一覧でstatus:"queued"として見える。
  maxParallelAgentRuns: number;
  // claude CLIの1ターンあたりの予算上限（USD、--max-budget-usd）。既定0.5。
  // Opus既定環境では引き上げが必要なことがある。agy/cursorには効かない。
  perTurnBudgetUsd: number;
  // 提案紐付きLead起動時に関連specialistを先行並列起動し、Leadが統合する（既定ON）。
  teamParallelKickoffEnabled: boolean;
  // Morning Modeで前面に出す「判断待ち」「観測不足」レーンそれぞれの表示上限。
  // 超過分は非表示にはせず、「もっと見る」で追加表示できる。
  decisionQueueLimit: number;
  observationQueueLimit: number;
  // 未確認・確認保留の提案が何日動きが無ければ
  // 「停滞」として強調するかの閾値。既定14日。
  staleInterventionDays: number;
  // AGENT_OPTIONSの値をキーにした、エージェント種別ごとのモデル系統指定。キーが無い
  // （または値が空文字列の）エージェントはclaude CLIの既定モデルのまま動く。
  agentModelTiers: Partial<Record<string, ModelTier>>;
  // agy/cursorのモデルは（エイリアスではなく）バージョン付きの具体名でしか指定できない
  // 実機確認済みの制約があるため、系統選択のプルダウンではなく自由入力の文字列にする。
  // キーが無い（または空文字列の）エージェントはagent-runtime.tsの既定モデル定数のまま動く。
  agentAgyModels: Partial<Record<string, string>>;
  agentCursorModels: Partial<Record<string, string>>;
  // エージェント種別ごとのモデル（agentModelTiers等）とは別に、reference-lookup専用の
  // 単一モデル設定を持つ。
  // claudeはagentModelTiersと同じtierエイリアス（空文字列="CLIの既定のまま"）。cursorは
  // agentCursorModelsと同じ自由入力の具体名だが、Cursor CLIのHooks不具合
  // （Autoモデルルーティング時にpreToolUseフックが発火しない既知バグ）を踏まえ、
  // "auto"はAPI側（/api/settings/rules）で拒否する。agyはこの検索を安全上の理由で
  // サポートしない（agyはヘッドレス実行時に全ツール呼び出しを構造的に自動拒否する仕様の
  // ため、hooksによる制約が使えずWebSearch自体を実行できない）ため、モデル設定自体を
  // 持たない（常に非アクティブ）。
  referenceLookupClaudeModel: ModelTier | "";
  referenceLookupCursorModel: string;
  // 全エージェント共通の単一CLI優先順位。配列に含まれるCLIだけが候補（除外は外すだけで表現）、
  // 含まれる順が試行順。claudeも他と同様に除外可（空配列は不可、最低1つは残す）。
  // 既定["claude"]（＝agy/cursorは無効、既存の挙動を変えない）。
  cliOrder: CliName[];
  // Peopleの PERSON_n を利用者本人（EM）として紐付ける任意設定。未設定は null。
  selfPersonId: string | null;
  // Journal抽出等のローカルチャットモデルプリセット（既定 "350m"）。埋め込みは対象外。
  localChatModelPreset: "350m" | "0.5b" | "1.2b" | "1.2b-jp" | "1.5b";
  // 関連束・紐づけ heuristic 等で、MiniLM cosine 後段に日本語 tiny reranker を使う（既定 OFF）。
  // ON 時のみ遅延ロード。失敗時は従来の cosine / overlap にフォールバック。
  localRerankEnabled: boolean;
};

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

// Issue管理を廃し、AIの提案を
 // EMが確認するための第一級エンティティ。アクション管理は対象外。
// unreviewed（未着手）と
// deferred（いったん保留）の間に、「今まさに検討している最中」を明示できる状態を挟む。
export type SuggestionReviewStatus = "unreviewed" | "in_review" | "deferred" | "done";

export const SUGGESTION_REVIEW_STATUSES: SuggestionReviewStatus[] = ["unreviewed", "in_review", "deferred", "done"];

export const SUGGESTION_REVIEW_STATUS_META: Record<
  SuggestionReviewStatus,
  { icon: string; label: string; hint: string }
> = {
  unreviewed: { icon: "🆕", label: "未確認", hint: "まだ内容を確認していない" },
  in_review: { icon: "🔎", label: "確認中", hint: "内容を確認・検討している最中" },
  deferred: { icon: "👀", label: "確認保留", hint: "いったん保留し、後で見直す" },
  done: { icon: "✅", label: "確認済み", hint: "もう追わない（Emther上では閉じる）" },
};

/** 確認の優先度。値は旧 IssuePriority と同一（移行コスト最小）。 */
export type ConfirmPriority = "focus" | "normal" | "parked";

export const CONFIRM_PRIORITIES: ConfirmPriority[] = ["focus", "normal", "parked"];

export const CONFIRM_PRIORITY_META: Record<ConfirmPriority, { icon: string; label: string; hint: string }> = {
  focus: { icon: "🔥", label: "今すぐ確認", hint: "今日〜直近で内容を確認する" },
  normal: { icon: "➖", label: "通常", hint: "通常の確認順" },
  parked: { icon: "🅿️", label: "後で", hint: "確認を後回しにする" },
};

// メモの出所。user=詳細画面の手入力、agent=AI追記案の採用・整理 note・Charter 折り込み。
// 未設定は既存データ（バッジ非表示）。
export type SuggestionMemoSource = "user" | "agent";

export type SuggestionMemo = {
  id: string;
  text: string;
  createdAt: number;
  source?: SuggestionMemoSource;
};

// メモ（EMが自由に書き足す
// 経過記録）とは別に、AIが提案時点で示した結論・根拠・ロジックと、この提案を実際に計画・
// 進行・検証するうえでの実務的なアドバイスを、判断・提案（Agent）パネル（紐づくAgent Runが
// 差し替わると内容も変わりうる）とは独立に、提案自体に1件だけ残す。
// アドバイスは AI の半構造化（adviceStructured）と、EM 編集の非構造（adviceOverride）を分ける。
// 表示は adviceOverride → 旧 advice → adviceStructured の順。AI 更新（refresh）は structured
// のみ差し替え、override は保持する。
/** Explore段階の観点。Expand（別解釈）/ Challenge（前提への問い）とは別。 */
export type ExplorationKind =
  | "blind_spot"
  | "missing_evidence"
  | "contradiction"
  | "drift"
  | "unexplored_area";

/** EMが見ていない可能性のある領域。断定せず観測ギャップ・確認質問として提示する。最大3件。 */
export type ExplorationFinding = {
  kind: ExplorationKind;
  /** 観測ギャップの記述（「重要な問題です」等の断定は避ける） */
  observation: string;
  /** Goal / Policy / 過去記録との関連性 */
  relevance: string;
  /** EMへの確認質問（任意） */
  confirmationQuestion?: string;
};

export type SuggestionDetail = {
  conclusion: string;
  facts: string[];
  logic: string;
  // 起票時点の Expand / Challenge（無い旧detailは未定義）。
  expansions?: string[];
  challenges?: string[];
  // 起票時点の Explore（無い旧detailは未定義）。最大3件。
  explorations?: ExplorationFinding[];
  /** @deprecated 旧フリーテキスト。新規は adviceStructured / adviceOverride を使う */
  advice?: string;
  adviceStructured?: AdviceStructured;
  /** EMが編集した非構造テキスト。あれば表示は常にこちらを優先 */
  adviceOverride?: string;
  updatedAt: number;
};

export type Suggestion = {
  id: string;
  title: string;
  reviewStatus: SuggestionReviewStatus;
  confirmPriority: ConfirmPriority;
  focusOrder?: number;
  memos: SuggestionMemo[];
  detail?: SuggestionDetail;
  agentRunId?: string;
  sourceRunId?: string;
  sourceJournalId?: string;
  teamId?: string;
  themeId?: string;
  embedding?: number[];
  createdAt: number;
  updatedAt: number;
  reviewedAt?: number;
  // reviewStatusとは
  // 独立に持たせる（「確認済み（もう追わない）」＝有効に完了、との混同を避けるため）。
  // 重複起票・誤操作等で「もう存在しなかったことにしたい」ときに使う。
  archivedAt?: number;
  // reviewStatusとは独立（後回しに限らず、未確認・確認中でも設定できる）。
  // 日付レベルの粒度（lib/journal-date-parser.tsのdateStringToNoonTimestampと同じ、
  // その日の正午のタイムスタンプ）で持つ。
  reviewDueAt?: number;
};

export function isSuggestionOpen(s: Pick<Suggestion, "reviewStatus" | "archivedAt">): boolean {
  return s.reviewStatus !== "done" && !s.archivedAt;
}

export function isSuggestionReviewOverdue(
  s: Pick<Suggestion, "reviewStatus" | "archivedAt" | "reviewDueAt">,
  now: number,
): boolean {
  return isSuggestionOpen(s) && s.reviewDueAt !== undefined && s.reviewDueAt < now;
}

export function isSuggestionStrategyUnlinked(s: Pick<Suggestion, "themeId">): boolean {
  return !s.themeId;
}

/** 未確認・確認保留のまま長く動いていない提案。 */
export function isSuggestionStalled(s: Pick<Suggestion, "reviewStatus" | "updatedAt">, now: number, staleDays: number): boolean {
  if (s.reviewStatus === "done") return false;
  return now - s.updatedAt > staleDays * 24 * 60 * 60 * 1000;
}

// タイトル・メモ・
// 詳細（結論/根拠/ロジック/アドバイス）を対象に、大小文字を区別せず部分一致で検索する。
export function suggestionMatchesKeyword(
  s: Pick<Suggestion, "title" | "memos" | "detail">,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystacks: string[] = [s.title, ...s.memos.map((m) => m.text)];
  if (s.detail) {
    haystacks.push(s.detail.conclusion, s.detail.logic, ...s.detail.facts);
    if (s.detail.expansions?.length) haystacks.push(...s.detail.expansions);
    if (s.detail.challenges?.length) haystacks.push(...s.detail.challenges);
    const adviceText = effectiveAdviceText(s.detail);
    if (adviceText) haystacks.push(adviceText);
  }
  return haystacks.some((h) => h.toLowerCase().includes(q));
}

export function compareSuggestionsByConfirmPriority(a: Suggestion, b: Suggestion): number {
  const rank: Record<ConfirmPriority, number> = { focus: 0, normal: 1, parked: 2 };
  const pa = a.confirmPriority ?? "normal";
  const pb = b.confirmPriority ?? "normal";
  if (rank[pa] !== rank[pb]) return rank[pa] - rank[pb];
  if (pa === "focus" && pb === "focus") {
    const oa = a.focusOrder ?? Number.MAX_SAFE_INTEGER;
    const ob = b.focusOrder ?? Number.MAX_SAFE_INTEGER;
    if (oa !== ob) return oa - ob;
  }
  return b.updatedAt - a.updatedAt;
}

// 提案の計画・実行前に明らかにしておくべき3要素。各項目は空文字列（＝未整理）を許容する。
// AIが提案の起票時・更新時にWhy/What/Howの下書きを出すためだけに使う（Suggestion本体は
// この形で構造化して保持しない。採用時はメモへ折り込む）。
export type SuggestionCharter = {
  why: string;
  what: string;
  how: string;
};

export function suggestionOverviewFromLogs(logEntries: { text: string }[], maxLength = 140): string {
  const text = logEntries.at(-1)?.text.trim() ?? "";
  if (!text) return "メモはまだありません";
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

// Decide/Inform/Commitの区別をYieldRequestに持たせる。
// AIプロンプト側の指示はbuildSystemPrompt、パースはextractYieldを参照。
// 省略された場合は既存run（後方互換）としてUI側でフォールバック推定する。
export type YieldKind = "decide" | "inform" | "commit";

export const YIELD_KIND_META: Record<YieldKind, { icon: string; label: string; description: string }> = {
  decide: { icon: "🔀", label: "Decide", description: "複数の案から選んでください" },
  inform: { icon: "📋", label: "Inform", description: "判断に必要な前提情報を教えてください" },
  commit: { icon: "🤝", label: "Commit", description: "介入の実行・人への働きかけ・優先順位変更を決めてください" },
};

// People(人)/Process(組織運営)/Tech(実装)の
// 3象限に、Product(顧客価値・優先順位・ロードマップ)を足して4象限を埋める。
// Exec Agentは常時象限ではなく、何でも相談のオプトインで経営／役員／MVV目線の厳しい
// レビューを足す専門レンズ（Leadの必須consult先）。手動起動も可能なので選択肢に含める。
export const EXEC_AGENT_NAME = "Exec Agent";
export const AGENT_OPTIONS = [
  "Lead Agent",
  "People Agent",
  "Process Agent",
  "Tech Agent",
  "Product Agent",
  EXEC_AGENT_NAME,
];

// Claude Codeの
// 「計画立案はOpus、単純な分析はSonnet」のような使い分けに倣い、エージェント種別ごとに
// モデルの"系統"（claude CLIの--modelが受け付けるエイリアス）を指定できるようにする。
// モデルは日々更新されるため、特定バージョン（例: claude-sonnet-5-20260101）ではなく
// 系統名にとどめる。空文字列は「claude CLIの既定モデルのまま」を意味し、既定値
//（DEFAULT_RULES.agentModelTiers = {}）では全エージェントが未設定＝既存の挙動を変えない。
export const MODEL_TIER_OPTIONS = ["sonnet", "opus", "fable", "haiku"] as const;
export type ModelTier = (typeof MODEL_TIER_OPTIONS)[number];

// 実装タスク箱ではなく「仕組み・人・組織への
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

// 新規の永続化エンティティは持たず、
// 既存のpeople-directory／Journal fact・解釈／チーム所属／関連提案を人物軸で束ねた
// 集約ビュー（@/lib/people-hub.tsのサーバー側の型と対応）。
export type PersonTrend = { positive: number; negative: number; neutral: number };

// Team Vitals
// （lib/vitals.tsのcomputeOrgVitals、平均sentimentスコア＋設定可能な閾値）と同じ
// 「ネガティブ優勢→bad／件数不足→unknown」という判定思想を踏襲するが、こちらは
// 一覧カードの軽量な視覚表示用なので、Team Vitalsのような設定可能な閾値
// （RulesAndConstraints）は持たない単純な多数決にする。
// hasConcerningSuggestion（確認保留・停滞中の関連提案が1件でもあるか）がtrueの場合、
// Journalのsentimentだけでは"good"/"unknown"に見えていても、少なくとも"warn"へ引き上げる
// （"warn"/"bad"は据え置き＝提案の状況で評価を下げることはあっても甘くはしない）。
export function personVitalStatus(trend: PersonTrend, hasConcerningSuggestion = false): VitalStatus {
  const total = trend.positive + trend.negative + trend.neutral;
  const base: VitalStatus = total < 2 ? "unknown" : trend.negative > trend.positive ? "bad" : trend.negative === trend.positive && trend.negative > 0 ? "warn" : "good";
  if (hasConcerningSuggestion && (base === "good" || base === "unknown")) return "warn";
  return base;
}

// personVitalStatusの判定根拠（Journalのsentiment内訳／関連提案の停滞・確認保留）を、
// バッジのtitleツールチップ頼みにせず、詳細画面に文章として表示できるようにする。
export function personVitalReason(trend: PersonTrend, hasConcerningSuggestion = false): string {
  const total = trend.positive + trend.negative + trend.neutral;
  const reasons: string[] = [];
  if (total < 2) {
    reasons.push("直近Journalが少なく判断材料が不足しています");
  } else if (trend.negative > trend.positive) {
    reasons.push(`ネガティブなJournalが多いです（🙂${trend.positive} 🙁${trend.negative}）`);
  } else if (trend.negative === trend.positive && trend.negative > 0) {
    reasons.push(`ポジティブ・ネガティブが同数で拮抗しています（🙂${trend.positive} 🙁${trend.negative}）`);
  } else {
    reasons.push(`ポジティブなJournalが優勢、または気になる兆候はありません（🙂${trend.positive} 🙁${trend.negative}）`);
  }
  if (hasConcerningSuggestion) {
    reasons.push("停滞・確認保留ありの関連提案があります");
  }
  return reasons.join(" ／ ");
}

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
  aliases: string[];
  teamNames: string[];
  trend: PersonTrend;
  factCount: number;
  isDirectReport: boolean;
  // settings.selfPersonId と一致する人物。本人は部下一覧・1on1 Coverageから除外する。
  isSelf: boolean;
  hasConcerningSuggestion: boolean;
  // 退職等。誤登録削除とは別。メンバー一覧の既定表示・1on1 Coverage等から外す。
  archived: boolean;
};

export type PersonFact = {
  id: string;
  text: string;
  tags: string[];
  sentiment?: "positive" | "negative" | "neutral";
  urgency?: "low" | "mid" | "high";
  occurredAt: number;
  noActionNeededAt?: number;
  noActionNeededNote?: string;
};

export type PersonRelatedSuggestion = {
  id: string;
  title: string;
  archived: boolean;
  // charterそのものではなく要約テキスト。
  overview: string;
  concerning: boolean;
  concernAcknowledgedAt?: number;
  concernAcknowledgedNote?: string;
};

export type PersonProfile = PersonSummary & {
  facts: PersonFact[];
  interpretations: { id: string; text: string; occurredAt: number }[];
  relatedSuggestions: PersonRelatedSuggestion[];
};

// 日常の評価ログ（A/B）。
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
  valueSnapshot?: string;
  snapshotText: string;
  rationale: string;
  createdAt: number;
  updatedAt: number;
  noActionNeededAt?: number;
  noActionNeededNote?: string;
};

// 組織状況の統括解釈（テーマ）。
export type ThemeStatus = "candidate" | "adopted" | "dismissed";

export type OrgTheme = {
  id: string;
  /** 見出し（EMの今の焦点の中核文） */
  title: string;
  /** 補足（解釈を閉じる説明）。UI上は「補足」として扱う。 */
  summary: string;
  /** 背景・理由（運用メモに近い。補足とは別） */
  rationale: string;
  facts: string[];
  rootCause?: string;
  suggestedDirection?: string;
  evidenceJournalIds: string[];
  evidenceSuggestionIds: string[];
  // Goalへの明示リンク。
  goalIds?: string[];
  status: ThemeStatus;
  sourceRunId?: string;
  teamId?: string;
  /** 一覧の手動並び順（昇順）。 */
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
  adoptedAt?: number;
};

/** 採用テーマがGoalに未リンクか。警告表示用。 */
export function isThemeGoalUnlinked(theme: Pick<OrgTheme, "status" | "goalIds">): boolean {
  return theme.status === "adopted" && !(theme.goalIds?.length);
}

/** POST /api/suggestions/link/suggest の1件。HITL 用（未適用）。 */
export type SuggestionStrategyLinkSuggestion = {
  suggestionId: string;
  suggestionTitle: string;
  themeId: string | null;
  rationale: string;
  labels: { theme?: string };
};

export type SuggestedTheme = {
  title: string;
  summary: string;
  rationale: string;
  facts: string[];
  rootCause?: string;
  suggestedDirection?: string;
  evidenceJournalIds?: string[];
  evidenceSuggestionIds?: string[];
  goalIds?: string[];
};

export type ImpactWindow = { total: number; positive: number; negative: number };
export type SuggestionImpact = { windowDays: number; before: ImpactWindow; after: ImpactWindow; inProgress: boolean };

export type TimelineEntityType = "journal" | "person" | "team" | "suggestion" | "org";

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
  suggestion: "提案",
  team: "Team",
  org: "Org",
  journal: "Journal",
  person: "Person",
};

/** 週次・月次レポート。サーバー側の実体（@/lib/report-store）とは意図的に型を分離している。 */
export type ReportPeriodType = "week" | "month";

export const REPORT_PERIOD_LABEL: Record<ReportPeriodType, string> = { week: "週次", month: "月次" };

export type ReportJournalStats = {
  total: number;
  byUrgency: { low: number; mid: number; high: number };
  bySentiment: { positive: number; negative: number; neutral: number };
  topTags: { tag: string; count: number }[];
  notableEntries: { id: string; summary: string; urgency: string; sentiment: string; occurredAt: number }[];
};

export type ReportSuggestionStats = {
  createdCount: number;
  archivedCount: number;
  createdTitles: { id: string; title: string }[];
  archivedTitles: { id: string; title: string }[];
};

export type ReportEventStats = {
  total: number;
  byEntityType: Partial<Record<TimelineEntityType, number>>;
};

export type ReportStats = {
  journal: ReportJournalStats;
  suggestions: ReportSuggestionStats;
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

/** EM本人の気分・エネルギー等のチェックイン。 */
export type EmCheckin = {
  id: string;
  mood: number;
  energy: number;
  stress: number;
  // 1(余裕なし)〜5(余裕あり)。既存記録には無い場合がある。
  headroom?: number;
  note: string;
  createdAt: number;
};

// 1件＝Keep/Problem/Tryのいずれか1つの気づきメモ。週単位の集計は
// 表示側（growth/page.tsx）でcreatedAtからグルーピングする。
export type ReflectionNoteType = "keep" | "problem" | "try";

export type EmReflectionNote = {
  id: string;
  type: ReflectionNoteType;
  text: string;
  createdAt: number;
  // 付与されると /growth の「現在の改善方針」パネルから外れ、週次KPTには残る。
  archivedAt?: number;
};

// EM自身の学びの提示（Grow）。実体の正は@/lib/em-growth-store.tsだが、
// node:cryptoを使うサーバー専用のためクライアントから直接importできない
// （RulesAndConstraints等と同じ、サーバー/クライアントでの型複製パターン）。
export type GrowReference = {
  topic: string;
  isPrimarySource: boolean;
  note?: string;
  url?: string;
};

export type GrowSuggestionStatus = "unread" | "acknowledged" | "dismissed";

export type GrowSuggestion = {
  id: string;
  weekKey: string;
  title: string;
  rationale: string;
  evidenceSummary?: string;
  references: GrowReference[];
  status: GrowSuggestionStatus;
  sourceRunId?: string;
  generatedAt: number;
};
