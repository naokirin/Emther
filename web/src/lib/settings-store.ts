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
