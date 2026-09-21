import styles from "../../styles/page.module.css";

type Props = {
  checkinsLoaded: boolean;
  hasCheckinToday: boolean;
  onStart: () => void;
};

// ユーザー指摘「AI対話での振り返り→バイタル→KPTの流れが画面ごとに途切れているのは
// UXとして不自然」対応。ドメイン（Journal Entry / EmCheckin / EmReflectionNote）は
// 分離したまま、1日の締めくくりという体験だけを/evening-reviewの1本道でつなぐ。
export function EveningReviewCard({ checkinsLoaded, hasCheckinToday, onStart }: Props) {
  return (
    <div className={styles.panel}>
      <h2 style={{ margin: 0, fontSize: "1rem" }}>1日の締めくくり</h2>
      <p className={styles.subtitle} style={{ marginTop: 4 }}>
        AIとの対話でその日を振り返り、バイタルとKPTをまとめて記録します。
      </p>
      {!checkinsLoaded ? (
        <p className={styles.subtitle}>読み込み中…</p>
      ) : (
        !hasCheckinToday && (
          <div className={styles.charterWarnBanner}>
            ⚠️ まだ今日のチェックイン（気分・エネルギー・ストレス・心の余裕）を記録していません。
          </div>
        )
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
        <button className={styles.primaryBtn} style={{ width: "auto" }} onClick={onStart}>
          はじめる
        </button>
      </div>
    </div>
  );
}
