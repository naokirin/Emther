import { Link, useParams } from "react-router";
import styles from "../../styles/page.module.css";
import { SuggestionDetailContent } from "../../components/SuggestionDetailContent";

export function SuggestionDetailPage() {
  const { id } = useParams<{ id: string }>();
  if (!id) return null;
  return (
    <div className={styles.screen}>
      <Link to="/suggestions" className={styles.backLink}>
        ← 提案一覧に戻る
      </Link>
      <SuggestionDetailContent id={id} />
    </div>
  );
}
