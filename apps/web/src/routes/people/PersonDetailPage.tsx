import { Link, useParams } from "react-router";
import styles from "../../styles/page.module.css";
import { PersonDetailContent } from "../../components/PersonDetailContent";

// フルページ表示用（直接URLアクセス・リロード・「詳細画面で開く」の遷移先）
export function PersonDetailPage() {
  const { id } = useParams();
  return (
    <div className={styles.screen}>
      <div className={styles.panel}>
        <Link to="/people" className={styles.subtitle}>
          ← People一覧に戻る
        </Link>
        <div style={{ marginTop: 8 }}>
          <PersonDetailContent id={id!} />
        </div>
      </div>
    </div>
  );
}
