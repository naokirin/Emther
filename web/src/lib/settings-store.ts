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
  // 予算/レート制限時にgemini CLIへのフォールバックを試みる。既定は空（全エージェント
  // フォールバック無効）——挙動が変わるフォールバックはEMの明示的な opt-in を必須にする。
  geminiFallbackAgents: string[];
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
  geminiFallbackAgents: [],
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
