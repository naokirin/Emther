import styles from "../../styles/page.module.css";
import type { RulesAndConstraints } from "@emther/core/types";

type Props = {
  draft: RulesAndConstraints;
  onChange: (patch: Partial<RulesAndConstraints>) => void;
};

const WEEKDAY_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "日" },
  { value: 1, label: "月" },
  { value: 2, label: "火" },
  { value: 3, label: "水" },
  { value: 4, label: "木" },
  { value: 5, label: "金" },
  { value: 6, label: "土" },
];

export function AutomationSettingsGroup({ draft, onChange }: Props) {
  const journalHours = draft.autoJournalBatchHours?.length ? draft.autoJournalBatchHours : [7];
  const distillWeekdays = draft.autoDistillationWeekdays?.length ? draft.autoDistillationWeekdays : [1];

  function setJournalHourAt(index: number, hour: number) {
    const next = [...journalHours];
    next[index] = Math.min(23, Math.max(0, Math.round(hour)));
    onChange({ autoJournalBatchHours: next });
  }

  function addJournalHour() {
    const candidate = journalHours.length > 0 ? Math.min(23, journalHours[journalHours.length - 1] + 1) : 7;
    onChange({ autoJournalBatchHours: [...journalHours, candidate] });
  }

  function removeJournalHour(index: number) {
    if (journalHours.length <= 1) return;
    onChange({ autoJournalBatchHours: journalHours.filter((_, i) => i !== index) });
  }

  function toggleDistillWeekday(day: number) {
    const set = new Set(distillWeekdays);
    if (set.has(day)) {
      if (set.size <= 1) return;
      set.delete(day);
    } else {
      set.add(day);
    }
    onChange({ autoDistillationWeekdays: [...set].sort((a, b) => a - b) });
  }

  return (
    <>
      <h3 style={{ fontSize: "0.875rem", marginTop: 0, marginBottom: 4 }}>AIエージェントの自動起動</h3>

      <h3 style={{ fontSize: "0.875rem", marginTop: 16, marginBottom: 4 }}>Journalの集約解釈</h3>
      <label
        className={styles.axisTooltip}
        style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.875rem", marginBottom: 6 }}
        data-tooltip="1件ごとには反応せず、前回解釈以降のJournalをまとめてLead Agentが解釈します。時刻は複数指定できます。個別分析はJournal詳細から明示的に相談してください"
      >
        <input
          type="checkbox"
          checked={draft.autoJournalBatchEnabled}
          onChange={(e) => onChange({ autoJournalBatchEnabled: e.target.checked })}
        />
        指定時刻以降に、前回以降のJournalをまとめてLead Agentに解釈させる
      </label>
      <div style={{ opacity: draft.autoJournalBatchEnabled ? 1 : 0.5 }}>
        <p style={{ fontSize: "0.8rem", margin: "0 0 6px", color: "var(--muted, #666)" }}>
          起動時刻（サーバーのローカル時刻、0〜23時。複数可）
        </p>
        {journalHours.map((hour, index) => (
          <div key={index} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <div className={styles.field} style={{ maxWidth: 120, margin: 0 }}>
              <label>
                <input
                  type="number"
                  min={0}
                  max={23}
                  disabled={!draft.autoJournalBatchEnabled}
                  value={hour}
                  onChange={(e) => setJournalHourAt(index, Number(e.target.value))}
                />
              </label>
            </div>
            <button
              type="button"
              className={styles.btnOutline}
              disabled={!draft.autoJournalBatchEnabled || journalHours.length <= 1}
              onClick={() => removeJournalHour(index)}
            >
              削除
            </button>
          </div>
        ))}
        <button
          type="button"
          className={styles.btnOutline}
          disabled={!draft.autoJournalBatchEnabled}
          onClick={addJournalHour}
        >
          時刻を追加
        </button>
      </div>

      <h3 style={{ fontSize: "0.875rem", marginTop: 16, marginBottom: 4 }}>提案更新時の自動分析</h3>
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.875rem", marginBottom: 6 }}>
        <input
          type="checkbox"
          checked={draft.autoSuggestionUpdateAnalysisEnabled}
          onChange={(e) => onChange({ autoSuggestionUpdateAnalysisEnabled: e.target.checked })}
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

      <h3 style={{ fontSize: "0.875rem", marginTop: 16, marginBottom: 4 }}>状況の蒸留</h3>
      <label
        className={styles.axisTooltip}
        style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.875rem", marginBottom: 6 }}
        data-tooltip="候補テーマを出します。採用するまで前提には入りません。曜日は複数選択できます"
      >
        <input
          type="checkbox"
          checked={draft.autoDistillationEnabled}
          onChange={(e) => onChange({ autoDistillationEnabled: e.target.checked })}
        />
        指定曜日・時刻以降に自動で状況蒸留を起動する
      </label>
      <div style={{ opacity: draft.autoDistillationEnabled ? 1 : 0.5, marginBottom: 8 }}>
        <p style={{ fontSize: "0.8rem", margin: "0 0 6px", color: "var(--muted, #666)" }}>曜日（複数可）</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {WEEKDAY_OPTIONS.map((opt) => (
            <label key={opt.value} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "0.875rem" }}>
              <input
                type="checkbox"
                disabled={!draft.autoDistillationEnabled}
                checked={distillWeekdays.includes(opt.value)}
                onChange={() => toggleDistillWeekday(opt.value)}
              />
              {opt.label}
            </label>
          ))}
        </div>
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

      <h3 style={{ fontSize: "0.875rem", marginTop: 16, marginBottom: 4 }}>週次レビュー</h3>
      <label
        className={styles.axisTooltip}
        style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.875rem", marginBottom: 6 }}
        data-tooltip="今週のJournal・提案・組織イベントを横断し、概観・解釈・前週比較・見落としの問い・学び・来週への問いをLead Agentが提示します（レポート画面から手動でも起動できます）"
      >
        <input
          type="checkbox"
          checked={draft.autoWeeklyReportEnabled}
          onChange={(e) => onChange({ autoWeeklyReportEnabled: e.target.checked })}
        />
        毎週、指定曜日・時刻以降に自動で週次レビューを起動する
      </label>
      <div className={styles.field} style={{ maxWidth: 200, opacity: draft.autoWeeklyReportEnabled ? 1 : 0.5 }}>
        <label>曜日（サーバーのローカル時刻）
        <select
          disabled={!draft.autoWeeklyReportEnabled}
          value={draft.autoWeeklyReportWeekday}
          onChange={(e) => onChange({ autoWeeklyReportWeekday: Number(e.target.value) })}
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
      <div className={styles.field} style={{ maxWidth: 160, opacity: draft.autoWeeklyReportEnabled ? 1 : 0.5 }}>
        <label>時刻（0〜23時）
        <input
          type="number"
          min={0}
          max={23}
          disabled={!draft.autoWeeklyReportEnabled}
          value={draft.autoWeeklyReportHour}
          onChange={(e) => onChange({ autoWeeklyReportHour: Number(e.target.value) })}
        /></label>
      </div>

      <h3 style={{ fontSize: "0.875rem", marginTop: 16, marginBottom: 4 }}>月次レビュー</h3>
      <label
        className={styles.axisTooltip}
        style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.875rem", marginBottom: 6 }}
        data-tooltip="今月のJournal・提案・組織イベント・EM自身の行動を横断し、概観・解釈・先月比較・見落としの問い・学び・来月への問いをLead Agentが提示します（レポート画面から手動でも起動できます）"
      >
        <input
          type="checkbox"
          checked={draft.autoMonthlyReportEnabled}
          onChange={(e) => onChange({ autoMonthlyReportEnabled: e.target.checked })}
        />
        毎月、指定日・時刻以降に自動で月次レビューを起動する
      </label>
      <div className={styles.field} style={{ maxWidth: 160, opacity: draft.autoMonthlyReportEnabled ? 1 : 0.5 }}>
        <label>起動する日（1〜28日、サーバーのローカル時刻）
        <input
          type="number"
          min={1}
          max={28}
          disabled={!draft.autoMonthlyReportEnabled}
          value={draft.autoMonthlyReportDay}
          onChange={(e) => onChange({ autoMonthlyReportDay: Math.min(28, Math.max(1, Number(e.target.value))) })}
        /></label>
      </div>
      <div className={styles.field} style={{ maxWidth: 160, opacity: draft.autoMonthlyReportEnabled ? 1 : 0.5 }}>
        <label>時刻（0〜23時）
        <input
          type="number"
          min={0}
          max={23}
          disabled={!draft.autoMonthlyReportEnabled}
          value={draft.autoMonthlyReportHour}
          onChange={(e) => onChange({ autoMonthlyReportHour: Number(e.target.value) })}
        /></label>
      </div>
    </>
  );
}
