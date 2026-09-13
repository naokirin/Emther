import styles from "@/app/page.module.css";
import type { RulesAndConstraints } from "@/lib/types";

type Props = {
  draft: RulesAndConstraints;
  onChange: (patch: Partial<RulesAndConstraints>) => void;
};

export function MorningModeSettingsGroup({ draft, onChange }: Props) {
  return (
    <>
      <h3 style={{ fontSize: "0.8125rem", marginTop: 0, marginBottom: 4 }}>Morning Modeの上限件数</h3>
      <div className={styles.field} style={{ maxWidth: 160 }}>
        <label title="超過分は「もっと見る」で追加表示">
          判断待ち（decision）レーンの上限件数
        <input
          type="number"
          min={1}
          value={draft.decisionQueueLimit}
          onChange={(e) => onChange({ decisionQueueLimit: Number(e.target.value) })}
        /></label>
      </div>
      <div className={styles.field} style={{ maxWidth: 160 }}>
        <label>観測不足（observation）レーンの上限件数
        <input
          type="number"
          min={1}
          value={draft.observationQueueLimit}
          onChange={(e) => onChange({ observationQueueLimit: Number(e.target.value) })}
        /></label>
      </div>
    </>
  );
}
