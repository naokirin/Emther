"use client";

import styles from "@/app/page.module.css";
import { HelpLink } from "@/components/HelpLink";
import type { Issue, IssueImpact, Team } from "@/lib/types";

type Props = {
  issue: Issue;
  impact: IssueImpact | null;
  impactLoaded: boolean;
  teams: Team[];
};

// docs/memo.md「L」＋ docs/issue_tracker_contract.md §6。チーム紐付きIssueで介入前後比較を出す
// （完了窓は status=done／doneAt。進行中も暫定比較を返す）。
export function IssueImpactPanel({ issue, impact, impactLoaded, teams }: Props) {
  if (!issue.teamId) return null;

  return (
    <div className={styles.panel}>
      <div className={styles.pageTitleWithHelp} style={{ marginBottom: 10 }}>
        <h2 style={{ margin: 0 }}>
          介入の効果（{teams.find((t) => t.id === issue.teamId)?.name ?? "関連チーム"}）
          {impact?.inProgress && "・進行中"}
        </h2>
        <HelpLink anchor="issues" />
      </div>
      {!impactLoaded ? (
        <p className={styles.subtitle}>読み込み中…</p>
      ) : !impact ? (
        <p className={styles.subtitle}>介入の効果を算出できる状態ではありません。</p>
      ) : (
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <div className={styles.vitalCard} style={{ minWidth: 220 }}>
            <div className={styles.vitalLabel}>{impact.inProgress ? "介入開始前" : "解決前"} 直近{impact.windowDays}日間</div>
            <div className={styles.vitalValue}>
              Journal {impact.before.total}件（🙂{impact.before.positive} 🙁{impact.before.negative}）
            </div>
          </div>
          <div className={styles.vitalCard} style={{ minWidth: 220 }}>
            <div className={styles.vitalLabel}>{impact.inProgress ? "介入開始〜現在" : `解決後 直近${impact.windowDays}日間`}</div>
            <div className={styles.vitalValue}>
              Journal {impact.after.total}件（🙂{impact.after.positive} 🙁{impact.after.negative}）
            </div>
          </div>
        </div>
      )}
      {impact && impact.after.total === 0 && (
        <p className={styles.subtitle} style={{ marginTop: 8 }}>
          {impact.inProgress ? "介入開始後の Journal がまだありません" : "解決後の観測がまだありません"}
        </p>
      )}
    </div>
  );
}
