import { loadJSON, saveJSON } from "@/lib/persistence";
import type { CliName, ModelTier } from "@/lib/types";

// docs 3.1.1「判定閾値およびデータ欠如とみなす期間はCore Context（Rules_and_Constraints）
// 側で定義」に対応するパラメータ群。ただしこれは「組織のMVV/体制」のような
// ナレッジ（Organization Context）ではなく、アプリの動作を調整する設定値の性質が強いため、
// org-context-store（Organization Context）とは分離し、独立したSettingsとして持つ。

// Journal自動分析の緊急度フィルタ。「すべて」「mid以上」「highのみ」。
export type AutoJournalUrgencyFilter = "all" | "mid_or_higher" | "high_only";
// Journal自動分析の感情フィルタ。「すべて」「negativeのみ」。
export type AutoJournalSentimentFilter = "all" | "negative_only";

export const AUTO_JOURNAL_URGENCY_FILTERS = ["all", "mid_or_higher", "high_only"] as const;
export const AUTO_JOURNAL_SENTIMENT_FILTERS = ["all", "negative_only"] as const;

export type RulesAndConstraints = {
  teamWindowDays: number;
  minEntriesForJudgement: number;
  teamBadSentimentMax: number;
  teamWarnSentimentMax: number;
  coverageWindowDays: number;
  coverageGoodRatio: number;
  coverageWarnRatio: number;
  // 「動いていると思ったら止まっていた」を防ぐための閾値（docs/memo.md TODO対応）。
  // statusが"active"のままログ更新（updatedAt）がこの秒数以上無い場合は「応答なし」と
  // みなしてEMに警告表示する（実プロセスは殺さない、あくまでシグナル）。
  agentStaleAfterSeconds: number;
  // 上記よりさらに長くログ更新が無い場合は、ハングした子プロセスとみなして
  // 実際にkillし、"error"へ確定させる（ゾンビプロセス化を防ぐ自己修復）。
  agentKillAfterSeconds: number;
  // docs/memo.md「H: 永続化データモデルの設計」対応。Journalの投稿はkind:"fact"の
  // KnowledgeEventとして記録されるが、一時的な感情・発言は時間とともに現在の判断への
  // 重みを失わせるべき（ファクトと解釈の分離）。この日数を過ぎたJournalファクトは
  // Agent Runtimeへの注入対象から外れる（削除はされない、履歴としては残る）。
  journalFactTtlDays: number;
  // docs/first_implession 3.6「トリガー（起動条件）: イベント駆動・バッチ駆動」対応。
  // どちらも既定OFF（EMの明示opt-inが必須。自律実行によるコスト発生を勝手に始めない）。
  // イベント駆動: Journal校正時、下記の緊急度・感情フィルタに合うエントリならLead Agentへ分析を投げる。
  autoAnomalyDetectionEnabled: boolean;
  // Journal自動分析の緊急度フィルタ。既定は従来互換の high_only。
  autoJournalUrgencyFilter: AutoJournalUrgencyFilter;
  // Journal自動分析の感情フィルタ。既定は all（従来互換＝感情で絞らない）。
  autoJournalSentimentFilter: AutoJournalSentimentFilter;
  // IssueのWhy/What/How・経過ログが実質更新されたとき、紐付きRunの継続分析 or 新規Lead起動。
  // 既定OFF（コスト発生のopt-in）。
  autoIssueUpdateAnalysisEnabled: boolean;
  // バッチ駆動: 毎日この時刻（EMのブラウザではなくサーバーのローカル時刻）以降、最初のwatchdog
  // tickで一度だけLead Agentへ朝のサマリー作成タスクを投げる。
  autoMorningSummaryEnabled: boolean;
  autoMorningSummaryHour: number;
  // ユーザー指摘「設定変更時に、それまで起動していなかったエージェントが一気に並列で
  // 起動することがある」対応。エージェントは1体につき1つのCLI子プロセス（claude/agy/
  // cursor-agent）を起動するため、無制限に並列起動を許すとメモリを大量消費し環境が
  // 不安定になる。ここで同時に「実行中」にできるCLI子プロセス数の上限を設け、
  // 超過分はキューイングして順番に起動する（agent-runtime.tsのacquireRunSlot）。
  maxParallelAgentRuns: number;
  // docs/em_ui_ux_issue.md 2.2/4節「AI主導トリアージ・上限N件への圧縮」対応。Morning Modeで
  // 前面に出す「判断待ち（decision）」「観測不足（observation）」レーンそれぞれの表示上限。
  // 超過分は非表示にはせず、「もっと見る」で追加表示できる。
  decisionQueueLimit: number;
  observationQueueLimit: number;
  // docs/em_ui_ux_issue.md 4節「AIによる進捗アシスト」対応。介入（Issue）が何日動きが無ければ
  // 「観測不足」として朝キューに再浮上させるかの閾値。既定14日は過去のP1-10対応での
  // チューニング値を維持し、EMが好みに応じて短くできるようにする。
  staleInterventionDays: number;
  // ユーザー要望「エージェントが使うモデルを設定で事前に決めたい」対応。AGENT_OPTIONSの
  // 値をキーにした、エージェント種別ごとのモデル系統（claude CLIの--modelが受け付ける
  // エイリアス。バージョンは固定しない）指定。キーが無い（または空文字列の）エージェントは
  // claude CLIの既定モデルのまま動く（既定は全エージェント未設定＝既存の挙動を変えない）。
  agentModelTiers: Partial<Record<string, ModelTier>>;
  // ユーザー要望「エージェント種別ごとのモデル系統に関して、Cursor/agyについても調整
  // できるようにしたい」対応。claudeと違い、agy/cursorのモデルはエイリアスではなく
  // バージョン付きの具体名でしか指定できない実機確認済みの制約があるため、自由入力の
  // 文字列にする。キーが無い（または空文字列の）エージェントはagent-runtime.tsの
  // 既定モデル定数のまま動く。
  agentAgyModels: Partial<Record<string, string>>;
  agentCursorModels: Partial<Record<string, string>>;
  // ユーザー指摘「AIツールの優先度設定が増えたことでフォールバック設定との競合が
  // 発生している」「エージェントごとに設定できる必要はない、全体で1つで大丈夫」
  // 「claude codeが外せないようになっている」対応。以前のcliPriorityOrder
  // （全エージェント共通の並び順）+ agyFallbackAgents/cursorFallbackAgents
  // （エージェント種別ごとのON/OFF）を、全エージェント共通の単一のCLI優先順位
  // リストへ統合したもの。配列に含まれるCLIだけが候補（除外＝配列から外す）で、
  // 含まれる順が試行順（優先度）。claudeも含め除外可能（空配列にはできない）。
  // 詳細は@/lib/types.tsの同名の型を参照。
  cliOrder: CliName[];
};

const DEFAULT_RULES: RulesAndConstraints = {
  teamWindowDays: 14,
  minEntriesForJudgement: 2,
  teamBadSentimentMax: -0.34,
  teamWarnSentimentMax: 0.2,
  coverageWindowDays: 30,
  coverageGoodRatio: 0.8,
  coverageWarnRatio: 0.4,
  agentStaleAfterSeconds: 120,
  agentKillAfterSeconds: 600,
  journalFactTtlDays: 90,
  autoAnomalyDetectionEnabled: false,
  autoJournalUrgencyFilter: "high_only",
  autoJournalSentimentFilter: "all",
  autoIssueUpdateAnalysisEnabled: false,
  autoMorningSummaryEnabled: false,
  autoMorningSummaryHour: 7,
  maxParallelAgentRuns: 2,
  decisionQueueLimit: 3,
  observationQueueLimit: 3,
  staleInterventionDays: 14,
  agentModelTiers: {},
  agentAgyModels: {},
  agentCursorModels: {},
  cliOrder: ["claude"],
};

let rules: RulesAndConstraints = {
  ...DEFAULT_RULES,
  ...loadJSON<Partial<RulesAndConstraints>>("settings-rules.json", {}),
};

function persistRules(): void {
  saveJSON("settings-rules.json", rules);
}

export function getRulesAndConstraints(): RulesAndConstraints {
  return rules;
}

export function updateRulesAndConstraints(patch: Partial<RulesAndConstraints>): RulesAndConstraints {
  rules = { ...rules, ...patch };
  persistRules();
  return rules;
}

/** Journal自動分析の緊急度・感情フィルタに現在のエントリが合うか。 */
export function matchesJournalAutoFilters(
  urgency: "low" | "mid" | "high",
  sentiment: "positive" | "negative" | "neutral",
): boolean {
  const { autoAnomalyDetectionEnabled, autoJournalUrgencyFilter, autoJournalSentimentFilter } = rules;
  if (!autoAnomalyDetectionEnabled) return false;

  const urgencyOk =
    autoJournalUrgencyFilter === "all"
      ? true
      : autoJournalUrgencyFilter === "mid_or_higher"
        ? urgency === "mid" || urgency === "high"
        : urgency === "high";
  if (!urgencyOk) return false;

  if (autoJournalSentimentFilter === "negative_only" && sentiment !== "negative") return false;
  return true;
}
