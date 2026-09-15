import styles from "@/app/page.module.css";
import type { RulesAndConstraints } from "@/lib/types";

type Props = {
  draft: RulesAndConstraints;
  onChange: (patch: Partial<RulesAndConstraints>) => void;
};

export function AutomationSettingsGroup({ draft, onChange }: Props) {
  return (
    <>
      <h3 style={{ fontSize: "0.875rem", marginTop: 0, marginBottom: 4 }}>AIエージェントの自動起動</h3>

      <h3 style={{ fontSize: "0.875rem", marginTop: 16, marginBottom: 4 }}>Journalの集約解釈（日次バッチ）</h3>
      <label
        className={styles.axisTooltip}
        style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.875rem", marginBottom: 6 }}
        data-tooltip="1件ごとには反応せず、直近のJournalをまとめて1日1回Lead Agentが解釈します。個別分析はJournal詳細から明示的に相談してください"
      >
        <input
          type="checkbox"
          checked={draft.autoJournalBatchEnabled}
          onChange={(e) => onChange({ autoJournalBatchEnabled: e.target.checked })}
        />
        毎日、指定時刻以降に直近のJournalをまとめてLead Agentに解釈させる
      </label>
      <div className={styles.field} style={{ maxWidth: 160, opacity: draft.autoJournalBatchEnabled ? 1 : 0.5 }}>
        <label>Journal集約解釈を生成する時刻（サーバーのローカル時刻、0〜23時）
        <input
          type="number"
          min={0}
          max={23}
          disabled={!draft.autoJournalBatchEnabled}
          value={draft.autoJournalBatchHour}
          onChange={(e) => onChange({ autoJournalBatchHour: Number(e.target.value) })}
        /></label>
      </div>

      <h3 style={{ fontSize: "0.875rem", marginTop: 16, marginBottom: 4 }}>提案更新時の自動分析</h3>
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.875rem", marginBottom: 6 }}>
        <input
          type="checkbox"
          checked={draft.autoIssueUpdateAnalysisEnabled}
          onChange={(e) => onChange({ autoIssueUpdateAnalysisEnabled: e.target.checked })}
        />
        タイトルやメモを更新したら、Lead Agentが自動で再分析する（同一提案は約45秒デバウンス）
      </label>

      <h3 style={{ fontSize: "0.875rem", marginTop: 16, marginBottom: 4 }}>朝のサマリー（バッチ）</h3>
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.875rem", marginBottom: 6 }}>
        <input
          type="checkbox"
          checked={draft.autoMorningSummaryEnabled}
          onChange={(e) => onChange({ autoMorningSummaryEnabled: e.target.checked })}
        />
        毎朝、指定時刻以降に自動で「朝のサマリー」をLead Agentに作成させる
      </label>
      <div className={styles.field} style={{ maxWidth: 160 }}>
        <label>朝のサマリーを生成する時刻（サーバーのローカル時刻、0〜23時）
        <input
          type="number"
          min={0}
          max={23}
          value={draft.autoMorningSummaryHour}
          onChange={(e) => onChange({ autoMorningSummaryHour: Number(e.target.value) })}
        /></label>
      </div>

      <h3 style={{ fontSize: "0.875rem", marginTop: 16, marginBottom: 4 }}>状況の蒸留（週次バッチ）</h3>
      <label
        className={styles.axisTooltip}
        style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.875rem", marginBottom: 6 }}
        data-tooltip="候補テーマを出します。採用するまで前提には入りません"
      >
        <input
          type="checkbox"
          checked={draft.autoDistillationEnabled}
          onChange={(e) => onChange({ autoDistillationEnabled: e.target.checked })}
        />
        毎週、指定曜日・時刻以降に自動で状況蒸留を起動する
      </label>
      <div className={styles.field} style={{ maxWidth: 200, opacity: draft.autoDistillationEnabled ? 1 : 0.5 }}>
        <label>曜日（サーバーのローカル時刻）
        <select
          disabled={!draft.autoDistillationEnabled}
          value={draft.autoDistillationWeekday}
          onChange={(e) => onChange({ autoDistillationWeekday: Number(e.target.value) })}
        >
          <option value={0}>日曜</option>
          <option value={1}>月曜</option>
          <option value={2}>火曜</option>
          <option value={3}>水曜</option>
          <option value={4}>木曜</option>
          <option value={5}>金曜</option>
          <option value={6}>土曜</option>
        </select></label>
      </div>
      <div className={styles.field} style={{ maxWidth: 160, opacity: draft.autoDistillationEnabled ? 1 : 0.5 }}>
        <label>時刻（0〜23時）
        <input
          type="number"
          min={0}
          max={23}
          disabled={!draft.autoDistillationEnabled}
          value={draft.autoDistillationHour}
          onChange={(e) => onChange({ autoDistillationHour: Number(e.target.value) })}
        /></label>
      </div>

      <h3 style={{ fontSize: "0.875rem", marginTop: 16, marginBottom: 4 }}>学びの提案（週次バッチ）</h3>
      <label
        className={styles.axisTooltip}
        style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.875rem", marginBottom: 6 }}
        data-tooltip="組織の観測・解釈とEM自身の振り返りを横断し、参考になりそうな学びを提示します（評価ではありません）"
      >
        <input
          type="checkbox"
          checked={draft.autoGrowEnabled}
          onChange={(e) => onChange({ autoGrowEnabled: e.target.checked })}
        />
        毎週、指定曜日・時刻以降に自動でEM自身の学びの提案を生成する
      </label>
      <div className={styles.field} style={{ maxWidth: 200, opacity: draft.autoGrowEnabled ? 1 : 0.5 }}>
        <label>曜日（サーバーのローカル時刻）
        <select
          disabled={!draft.autoGrowEnabled}
          value={draft.autoGrowWeekday}
          onChange={(e) => onChange({ autoGrowWeekday: Number(e.target.value) })}
        >
          <option value={0}>日曜</option>
          <option value={1}>月曜</option>
          <option value={2}>火曜</option>
          <option value={3}>水曜</option>
          <option value={4}>木曜</option>
          <option value={5}>金曜</option>
          <option value={6}>土曜</option>
        </select></label>
      </div>
      <div className={styles.field} style={{ maxWidth: 160, opacity: draft.autoGrowEnabled ? 1 : 0.5 }}>
        <label>時刻（0〜23時）
        <input
          type="number"
          min={0}
          max={23}
          disabled={!draft.autoGrowEnabled}
          value={draft.autoGrowHour}
          onChange={(e) => onChange({ autoGrowHour: Number(e.target.value) })}
        /></label>
      </div>
    </>
  );
}
