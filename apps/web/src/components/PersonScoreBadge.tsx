import styles from "../styles/page.module.css";
import { PERSON_VITAL_LABEL, VITAL_ICON, personVitalReason, personVitalStatus, type PersonTrend } from "@emther/core/types";

const STATUS_CLS: Record<string, string> = {
  good: styles.personScoreGood,
  warn: styles.personScoreWarn,
  bad: styles.personScoreBad,
  unknown: styles.personScoreUnknown,
};

// 裸の数字（何点中かわからないスコアに見える）はやめ、Team Vitalsと同じ状態アイコン（VITAL_ICON）＋
// ラベル（PERSON_VITAL_LABEL）で「気にかけるべき度合い」を直接示す。判定根拠の件数・
// 内訳はツールチップに残す（呼び出し側でラベルを併記する場合はPERSON_VITAL_LABELを直接参照する）。
// ネイティブ title（表示が遅い・改行やスタイルを制御できない）ではなく、他画面のAxisTooltipと
// 同じ.axisTooltip（data-tooltip属性を読むCSSカスタムツールチップ）に揃え、
// 判定根拠（personVitalReason）をそのまま見せる。
// このバッジは常にPersonHeaderの先頭（.slideOverBodyの一番上）に置かれ、上向きに
// 開くとoverflow-y: autoでクリップされてslideOverHeaderの裏に隠れるため
// .axisTooltipDownで下向きに開く
export function PersonScoreBadge({
  trend,
  factCount,
  hasConcerningSuggestion = false,
}: {
  trend: PersonTrend;
  factCount: number;
  hasConcerningSuggestion?: boolean;
}) {
  const status = personVitalStatus(trend, hasConcerningSuggestion);
  const tooltip = `${PERSON_VITAL_LABEL[status]}（Journal ${factCount}件）\n${personVitalReason(trend, hasConcerningSuggestion)}`;
  return (
    <div
      className={`${styles.personScoreBadge} ${STATUS_CLS[status]} ${styles.axisTooltip} ${styles.axisTooltipDown}`}
      data-tooltip={tooltip}
      tabIndex={0}
    >
      {VITAL_ICON[status]}
    </div>
  );
}
