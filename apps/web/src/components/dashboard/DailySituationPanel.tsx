import styles from "../../styles/page.module.css";
import {
  CONCERN_SIGNAL_LABEL,
  type DailySituation,
  type SituationItem,
} from "../../lib/daily-situation";
import type { WeeklyJournalTonePoint } from "@emther/core/daily-trends";

// 「材料（判断はEMがする）」として、変化・兆候・4週トーン比較の3カラム + 注目チップ
// 気になる兆候は組織レベルのパターン材料（個体ナビは「注目」チップ側）

function NarrativeList({ items, emptyText }: { items: SituationItem[]; emptyText: string }) {
  if (items.length === 0) return <p className={styles.situationEmpty}>{emptyText}</p>;
  return (
    <ul className={styles.situationList}>
      {items.map((item) => (
        <li key={item.id} className={styles.situationItem}>
          {item.onSelect ? (
            <button type="button" className={styles.situationItemBtn} onClick={item.onSelect}>
              {item.text}
            </button>
          ) : (
            item.text
          )}
        </li>
      ))}
    </ul>
  );
}

function WeeklyToneChart({ points }: { points: WeeklyJournalTonePoint[] }) {
  const maxTotal = Math.max(1, ...points.map((p) => p.total));
  const negSeries = points.map((p) => p.negative).join("→");

  return (
    <div className={styles.weeklyToneChart}>
      <div className={styles.weeklyToneBars} role="img" aria-label={`週次Journalトーン。ネガ ${negSeries}`}>
        {points.map((p) => {
          const h = Math.max(8, Math.round((p.total / maxTotal) * 84));
          const posH = p.total > 0 ? Math.round((p.positive / p.total) * h) : 0;
          const neuH = p.total > 0 ? Math.round((p.neutral / p.total) * h) : 0;
          const negH = Math.max(0, h - posH - neuH);
          return (
            <div key={p.weekStart} className={styles.weeklyToneCol}>
              <div className={styles.weeklyToneStack} style={{ height: h }}>
                {posH > 0 && <div className={styles.weeklyTonePos} style={{ height: posH }} />}
                {neuH > 0 && <div className={styles.weeklyToneNeu} style={{ height: neuH }} />}
                {negH > 0 && <div className={styles.weeklyToneNeg} style={{ height: negH }} />}
              </div>
              <span className={styles.weeklyToneLabel}>{p.label}</span>
            </div>
          );
        })}
      </div>
      <div className={styles.weeklyToneLegend}>
        <span>
          <i className={styles.weeklyToneLegendNeg} />
          ネガ
        </span>
        <span>
          <i className={styles.weeklyToneLegendNeu} />
          ニュート
        </span>
        <span>
          <i className={styles.weeklyToneLegendPos} />
          ポジ
        </span>
      </div>
      <p className={styles.weeklyToneReadout}>ネガ {negSeries}</p>
    </div>
  );
}

type Props = {
  situation: DailySituation;
  loaded: boolean;
  weeklyTone: WeeklyJournalTonePoint[];
  attentionChips: SituationItem[];
};

export function DailySituationPanel({ situation, loaded, weeklyTone, attentionChips }: Props) {
  if (!loaded) {
    return (
      <div className={styles.panel}>
        <h2>材料（判断はEMがする）</h2>
        <p className={styles.subtitle}>読み込み中…</p>
      </div>
    );
  }

  const concernSignals = situation.concerns.filter((item) => item.signalKind);

  return (
    <div className={styles.panel}>
      <h2>材料（判断はEMがする）</h2>

      <div className={styles.situationMaterialsGrid}>
        <div className={styles.situationCard}>
          <div className={styles.situationCardHead}>
            <span className={styles.situationCardTitle}>昨日から変わったこと</span>
          </div>
          <NarrativeList items={situation.changes} emptyText="直近24時間の新しい記録はありません" />
        </div>

        <div className={styles.situationCard}>
          <div className={styles.situationCardHead}>
            <span className={styles.situationCardTitle}>気になる兆候</span>
          </div>
          {concernSignals.length === 0 ? (
            <p className={styles.situationEmpty}>組織レベルの気になる兆候は見当たりません</p>
          ) : (
            <ul className={styles.situationList}>
              {concernSignals.map((item) => (
                <li key={item.id} className={styles.situationConcernCard}>
                  <span className={styles.situationConcernLabel}>
                    {item.signalKind ? CONCERN_SIGNAL_LABEL[item.signalKind] : "兆候"}
                  </span>
                  {item.onSelect ? (
                    <button type="button" className={styles.situationItemBtn} onClick={item.onSelect}>
                      {item.text}
                    </button>
                  ) : (
                    <span>{item.text}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className={styles.situationCard}>
          <div className={styles.situationCardHead}>
            <span className={styles.situationCardTitle}>過去との比較</span>
            <span className={styles.situationCardHint}>週次Journalトーン · 4週</span>
          </div>
          {weeklyTone.every((p) => p.total === 0) ? (
            <p className={styles.situationEmpty}>比較できる過去データがまだありません</p>
          ) : (
            <WeeklyToneChart points={weeklyTone} />
          )}
        </div>
      </div>

      {attentionChips.length > 0 && (
        <div className={styles.situationAttentionRow}>
          <span className={styles.situationAttentionLabel}>注目</span>
          <div className={styles.situationChipRow}>
            {attentionChips.map((item) => {
              const status = item.status ?? "unknown";
              const className = `${styles.situationChip} ${styles[`situationChip-${status}`]}`;
              if (!item.onSelect) {
                return (
                  <span key={item.id} className={className}>
                    {item.text}
                  </span>
                );
              }
              return (
                <button key={item.id} type="button" className={className} onClick={item.onSelect}>
                  {item.text}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
