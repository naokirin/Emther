"use client";

import styles from "@/app/page.module.css";
import { PERSON_VITAL_LABEL, VITAL_ICON, personVitalStatus, type PersonTrend } from "@/lib/types";

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
// 内訳はtitleツールチップに残す（呼び出し側でラベルを併記する場合はPERSON_VITAL_LABELを
// 直接参照する）。
export function PersonScoreBadge({
  trend,
  factCount,
  hasConcerningIssue = false,
}: {
  trend: PersonTrend;
  factCount: number;
  // ユーザー指摘「バイタルがIssueの状況に対して問題無いように見える」対応。
  hasConcerningIssue?: boolean;
}) {
  const status = personVitalStatus(trend, hasConcerningIssue);
  const issueNote = hasConcerningIssue ? "・停滞/ブロッカーありの関連Issueがあります" : "";
  return (
    <div
      className={`${styles.personScoreBadge} ${STATUS_CLS[status]}`}
      title={`${PERSON_VITAL_LABEL[status]}（Journal ${factCount}件、🙂${trend.positive} 🙁${trend.negative}${issueNote}）`}
    >
      {VITAL_ICON[status]}
    </div>
  );
}
