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

      <h3 style={{ fontSize: "0.875rem", marginTop: 16, marginBottom: 4 }}>Journalの自動分析</h3>
      <label
        className={styles.axisTooltip}
        style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.875rem", marginBottom: 6 }}
        data-tooltip="投稿直後は起動しません。「この内容で確定」後に条件一致で起動"
      >
        <input
          type="checkbox"
          checked={draft.autoAnomalyDetectionEnabled}
          onChange={(e) => onChange({ autoAnomalyDetectionEnabled: e.target.checked })}
        />
        Journalを確定（校正）したとき、条件に合うエントリをLead Agentが自動分析する
      </label>
      <div className={styles.field} style={{ maxWidth: 280, opacity: draft.autoAnomalyDetectionEnabled ? 1 : 0.5 }}>
        <label>自動起動する緊急度
        <select
          value={draft.autoJournalUrgencyFilter}
          disabled={!draft.autoAnomalyDetectionEnabled}
          onChange={(e) =>
            onChange({
              autoJournalUrgencyFilter: e.target.value as RulesAndConstraints["autoJournalUrgencyFilter"],
            })
          }
        >
          <option value="all">すべて</option>
          <option value="mid_or_higher">mid以上</option>
          <option value="high_only">highのみ</option>
        </select></label>
      </div>
      <div className={styles.field} style={{ maxWidth: 280, opacity: draft.autoAnomalyDetectionEnabled ? 1 : 0.5 }}>
        <label>自動起動する感情（pos/neg）
        <select
          value={draft.autoJournalSentimentFilter}
          disabled={!draft.autoAnomalyDetectionEnabled}
          onChange={(e) =>
            onChange({
              autoJournalSentimentFilter: e.target.value as RulesAndConstraints["autoJournalSentimentFilter"],
            })
          }
        >
          <option value="all">すべて</option>
          <option value="negative_only">negativeのみ</option>
        </select></label>
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
    </>
  );
}
