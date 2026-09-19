import styles from "@/app/page.module.css";
import type { RulesAndConstraints } from "@core/types";

type Props = {
  draft: RulesAndConstraints;
  onChange: (patch: Partial<RulesAndConstraints>) => void;
};

export function AgentRunSettingsGroup({ draft, onChange }: Props) {
  return (
    <>
      <h3 style={{ fontSize: "0.875rem", marginTop: 0, marginBottom: 4 }}>Agent Runの同時実行数</h3>
      <div className={styles.field} style={{ maxWidth: 160 }}>
        <label className={styles.axisTooltip} data-tooltip="超過分はキューイングされます">
          同時に実行できるAgent Runの最大数
        <input
          type="number"
          min={1}
          value={draft.maxParallelAgentRuns}
          onChange={(e) => onChange({ maxParallelAgentRuns: Number(e.target.value) })}
        /></label>
      </div>

      <h3 style={{ fontSize: "0.875rem", marginTop: 20, marginBottom: 4 }}>1ターンあたりの予算上限（claude）</h3>
      <div className={styles.field} style={{ maxWidth: 160 }}>
        <label className={styles.axisTooltip} data-tooltip="Claude CLIの --max-budget-usd。agy / Cursor には非適用">
          1ターンの上限（USD）
        <input
          type="number"
          min={0.01}
          step={0.1}
          value={draft.perTurnBudgetUsd}
          onChange={(e) => onChange({ perTurnBudgetUsd: Number(e.target.value) })}
        /></label>
      </div>

      <h3 style={{ fontSize: "0.875rem", marginTop: 20, marginBottom: 4 }}>提案分析時のチーム先行並列</h3>
      <label
        className={styles.axisTooltip}
        style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.875rem", marginBottom: 6 }}
        data-tooltip="関連specialistを先に並列起動しLeadが統合。コスト増のためOFF可"
      >
        <input
          type="checkbox"
          checked={draft.teamParallelKickoffEnabled}
          onChange={(e) => onChange({ teamParallelKickoffEnabled: e.target.checked })}
        />
        提案に紐づくLead起動時、関連specialistを先行並列起動しLeadが最終判断する（既定ON）
      </label>

      <h3 style={{ fontSize: "0.875rem", marginTop: 20, marginBottom: 4 }}>Agent Runの無応答検知</h3>
      <div className={styles.field}>
        <label>この秒数、ログ更新が無ければ「応答なし」と表示する
        <input
          type="number"
          value={draft.agentStaleAfterSeconds}
          onChange={(e) => onChange({ agentStaleAfterSeconds: Number(e.target.value) })}
        /></label>
      </div>
      <div className={styles.field}>
        <label>この秒数を超えたらハングした子プロセスとみなし、強制終了してErrorに確定する
        <input
          type="number"
          value={draft.agentKillAfterSeconds}
          onChange={(e) => onChange({ agentKillAfterSeconds: Number(e.target.value) })}
        /></label>
      </div>

      <h3 style={{ fontSize: "0.875rem", marginTop: 20, marginBottom: 4 }}>Journalファクトの有効期間（TTL）</h3>
      <div className={styles.field}>
        <label className={styles.axisTooltip} data-tooltip="過ぎるとAgent注入対象外（履歴は残る）">
          Journalファクトの有効日数
        <input
          type="number"
          value={draft.journalFactTtlDays}
          onChange={(e) => onChange({ journalFactTtlDays: Number(e.target.value) })}
        /></label>
      </div>
    </>
  );
}
