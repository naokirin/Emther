import styles from "../styles/page.module.css";
import { PERSON_VITAL_LABEL, VITAL_ICON, personVitalReason, personVitalStatus, type PersonTrend } from "@emther/core/types";

const STATUS_CLS: Record<string, string> = {
  good: styles.personScoreGood,
  warn: styles.personScoreWarn,
  bad: styles.personScoreBad,
  unknown: styles.personScoreUnknown,
};

// 改修依頼「Peopleを労務SaaS的な視覚スコア表示に」対応（参考: HRMOSのタレント検索の
// 円形マッチ度バッジ）。ただし「マッチ度」に相当する指標をこのアプリは持たないため、
// 数値を捏造しない。
//
// ユーザー指摘「人のスコアが何を示しているかわかりにくい。何点中の何かがわからない」
// →「どのくらい気をかけるべきかのバイタル表示にしたい」対応。裸の数字（何点中の何か
// わからないスコアに見えてしまう）はやめ、Team Vitalsと同じ状態アイコン（VITAL_ICON）＋
// ラベル（PERSON_VITAL_LABEL）で「気にかけるべき度合い」を直接示す。判定根拠の件数・
// 内訳はツールチップに残す（呼び出し側でラベルを併記する場合はPERSON_VITAL_LABELを
// 直接参照する）。
// ユーザー指摘「気にかけるべき度合いがなぜ高いのかわかりにくい」対応。ネイティブ
// title（表示が遅い・改行やスタイルを制御できない）ではなく、他画面のAxisTooltipと
// 同じ.axisTooltip（data-tooltip属性を読むCSSカスタムツールチップ）に
// 揃え、判定根拠（personVitalReason）をそのまま見せる。
// ユーザー指摘「サイドピークで開いたときにツールチップがヘッダーに隠れる」対応。
// このバッジは常にPersonHeaderの先頭（.slideOverBodyの一番上）に置かれ、上向きに
// 開くとoverflow-y: autoでクリップされてslideOverHeaderの裏に隠れるため、
// .axisTooltipDownで下向きに開く。
export function PersonScoreBadge({
  trend,
  factCount,
  hasConcerningSuggestion = false,
}: {
  trend: PersonTrend;
  factCount: number;
  // ユーザー指摘「バイタルが提案の状況に対して問題無いように見える」対応。
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
