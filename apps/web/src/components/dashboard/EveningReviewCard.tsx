import styles from "../../styles/page.module.css";

type Props = {
  checkinsLoaded: boolean;
  hasCheckinToday: boolean;
  onStart: () => void;
};

// 未記録時だけ上部の薄い帯にする（記録済みなら何も出さない）
export function EveningReviewCard({ checkinsLoaded, hasCheckinToday, onStart }: Props) {
  if (!checkinsLoaded) return null;
  if (hasCheckinToday) return null;

  return (
    <div className={styles.checkinMissBanner} role="status">
      <div className={styles.checkinMissBannerBody}>
        <span className={styles.checkinMissBannerTitle}>まだ今日のチェックイン未記録</span>
        <span className={styles.checkinMissBannerHint}>・気分 / エネルギー / ストレス</span>
      </div>
      <button type="button" className={styles.checkinMissBannerCta} onClick={onStart}>
        はじめる
      </button>
    </div>
  );
}
