"use client";

import styles from "@/app/page.module.css";

type Props = {
  checkinsLoaded: boolean;
  hasCheckinToday: boolean;
  onFocusJournal: () => void;
  onNavigateGrowth: () => void;
};

// docs/em_ui_ux_issue.md 3節「Evening Mode」対応。終業時だけ、記録し忘れへの気づきと
// 記録先（/growth）への導線のみを置く。入力フォーム自体はここには置かない
// （改修依頼「今日記録されていない場合のアラート表示とEMの成長へのリンクのみ」対応）。
export function EveningModeCard({ checkinsLoaded, hasCheckinToday, onFocusJournal, onNavigateGrowth }: Props) {
  return (
    <div className={styles.panel} style={{ borderColor: "var(--accent, var(--border))" }}>
      <h2 style={{ margin: 0, fontSize: "1rem" }}>夜の書き連ね</h2>
      <p className={styles.subtitle} style={{ marginTop: 4 }}>
        今日あったことを分割せず 10〜15 分で書いてください。Issue 化・分割は翌朝の提案に寄せます。
      </p>
      {!checkinsLoaded ? (
        <p className={styles.subtitle}>読み込み中…</p>
      ) : (
        !hasCheckinToday && (
          <div className={styles.charterWarnBanner}>
            ⚠️ まだ今日のチェックイン（気分・エネルギー・ストレス）を記録していません。
          </div>
        )
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
        <button className={styles.primaryBtn} style={{ width: "auto" }} onClick={onFocusJournal}>
          書き連ねを始める
        </button>
        <button className={styles.btnOutline} onClick={onNavigateGrowth}>
          EMの成長へ →
        </button>
      </div>
    </div>
  );
}
