import { loadJSON, saveJSON } from "@/lib/persistence";

// docs 3.1.1「判定閾値およびデータ欠如とみなす期間はCore Context（Rules_and_Constraints）
// 側で定義」に対応するパラメータ群。ただしこれは「組織のMVV/体制」のような
// ナレッジ（Organization Context）ではなく、アプリの動作を調整する設定値の性質が強いため、
// org-context-store（Organization Context）とは分離し、独立したSettingsとして持つ。

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
  // docs/memo.md TODO「Claude Codeが使えない場合にGemini CLIを使うようにする」への対応。
  // ここに含まれるエージェント名（AGENT_OPTIONSの値）だけが、claude CLIの実行失敗・
  // 予算/レート制限時に`agy`（複数モデルに対応したCLI。Geminiモデルを指定して呼び出す）
  // へのフォールバックを試みる。既定は空（全エージェントフォールバック無効）——
  // 挙動が変わるフォールバックはEMの明示的な opt-in を必須にする。
  agyFallbackAgents: string[];
  // docs/memo.md「サポートするAIエージェントCLIにCursor CLIを追加する」対応。
  // claude→agyの順で試して依然として失敗している場合に限り、ここに含まれる
  // エージェント名だけがCursor CLI（cursor-agent）へのフォールバックを試みる。
  // 既定は空（全エージェントフォールバック無効）。
  cursorFallbackAgents: string[];
  // docs/first_implession 3.6「トリガー（起動条件）: イベント駆動・バッチ駆動」対応。
  // どちらも既定OFF（EMの明示opt-inが必須。自律実行によるコスト発生を勝手に始めない）。
  // イベント駆動: Journalに緊急度highのエントリが追加された時、Lead Agentへ自動で分析タスクを投げる。
  autoAnomalyDetectionEnabled: boolean;
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
  // 超過分は非表示にはせず、既存の折りたたみ展開で引き続き確認できる。
  decisionQueueLimit: number;
  observationQueueLimit: number;
  // docs/em_ui_ux_issue.md 4節「AIによる進捗アシスト」対応。介入（Issue）が何日動きが無ければ
  // 「観測不足」として朝キューに再浮上させるかの閾値。既定14日は過去のP1-10対応での
  // チューニング値を維持し、EMが好みに応じて短くできるようにする。
  staleInterventionDays: number;
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
  agyFallbackAgents: [],
  cursorFallbackAgents: [],
  autoAnomalyDetectionEnabled: false,
  autoMorningSummaryEnabled: false,
  autoMorningSummaryHour: 7,
  maxParallelAgentRuns: 2,
  decisionQueueLimit: 3,
  observationQueueLimit: 6,
  staleInterventionDays: 14,
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
