"use client";

import styles from "@/app/page.module.css";
import { personVitalStatus, type PersonTrend } from "@/lib/types";

const STATUS_CLS: Record<string, string> = {
  good: styles.personScoreGood,
  warn: styles.personScoreWarn,
  bad: styles.personScoreBad,
  unknown: styles.personScoreUnknown,
};

// 改修依頼「Peopleを労務SaaS的な視覚スコア表示に」対応（参考: HRMOSのタレント検索の
// 円形マッチ度バッジ）。ただし「マッチ度」に相当する指標をこのアプリは持たないため、
// 数値を捏造しない。円の中身は実際に観測されているJournal件数（factCount）とし、
// 円の色でネガティブ/ポジティブの優勢（lib/typesのpersonVitalStatus）を示す。
// 件数不足（unknown）のときは数字ではなく「?」にし、「0件」と「評価不能」を混同しない。
export function PersonScoreBadge({ trend, factCount }: { trend: PersonTrend; factCount: number }) {
  const status = personVitalStatus(trend);
  return (
    <div className={`${styles.personScoreBadge} ${STATUS_CLS[status]}`} title={`Journal ${factCount}件（🙂${trend.positive} 🙁${trend.negative}）`}>
      {status === "unknown" ? "?" : factCount}
    </div>
  );
}
