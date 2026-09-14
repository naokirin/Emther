import styles from "@/app/page.module.css";
import type { RulesAndConstraints } from "@/lib/types";

type Props = {
  draft: RulesAndConstraints;
  onChange: (patch: Partial<RulesAndConstraints>) => void;
};

export function VitalsSettingsGroup({ draft, onChange }: Props) {
  return (
    <>
      <h3 style={{ fontSize: "0.875rem", marginTop: 0, marginBottom: 4 }}>Team Vital</h3>
      <div className={styles.field}>
        <label>判定に使う参照期間（日）
        <input
          type="number"
          value={draft.teamWindowDays}
          onChange={(e) => onChange({ teamWindowDays: Number(e.target.value) })}
        /></label>
      </div>
      <div className={styles.field}>
        <label>判定に最低限必要なジャーナル件数（未満は評価不能）
        <input
          type="number"
          value={draft.minEntriesForJudgement}
          onChange={(e) => onChange({ minEntriesForJudgement: Number(e.target.value) })}
        /></label>
      </div>
      <div className={styles.field}>
        <label>「要注意」と判定する感情スコア平均の閾値（以下でbad）
        <input
          type="number"
          step="0.01"
          value={draft.teamBadSentimentMax}
          onChange={(e) => onChange({ teamBadSentimentMax: Number(e.target.value) })}
        /></label>
      </div>
      <div className={styles.field}>
        <label>「やや注意」と判定する感情スコア平均の閾値（未満でwarn）
        <input
          type="number"
          step="0.01"
          value={draft.teamWarnSentimentMax}
          onChange={(e) => onChange({ teamWarnSentimentMax: Number(e.target.value) })}
        /></label>
      </div>

      <h3 style={{ fontSize: "0.875rem", marginTop: 20, marginBottom: 4 }}>1on1 Coverage</h3>
      <div className={styles.field}>
        <label>判定に使う参照期間（日）
        <input
          type="number"
          value={draft.coverageWindowDays}
          onChange={(e) => onChange({ coverageWindowDays: Number(e.target.value) })}
        /></label>
      </div>
      <div className={styles.field}>
        <label>「良好」と判定するカバー率（以上でgood）
        <input
          type="number"
          step="0.01"
          value={draft.coverageGoodRatio}
          onChange={(e) => onChange({ coverageGoodRatio: Number(e.target.value) })}
        /></label>
      </div>
      <div className={styles.field}>
        <label>「要注意」と判定するカバー率（以上でwarn、未満でbad）
        <input
          type="number"
          step="0.01"
          value={draft.coverageWarnRatio}
          onChange={(e) => onChange({ coverageWarnRatio: Number(e.target.value) })}
        /></label>
      </div>

      <h3 style={{ fontSize: "0.875rem", marginTop: 20, marginBottom: 4 }}>停滞Issue検知</h3>
      <div className={styles.field} style={{ maxWidth: 160 }}>
        <label title="着手済みでこの日数以上動いていなければ停滞中として表示">
          停滞とみなす日数
        <input
          type="number"
          min={1}
          value={draft.staleInterventionDays}
          onChange={(e) => onChange({ staleInterventionDays: Number(e.target.value) })}
        /></label>
      </div>
    </>
  );
}
