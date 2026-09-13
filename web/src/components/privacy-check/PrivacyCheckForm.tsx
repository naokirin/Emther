import styles from "@/app/page.module.css";

type Props = {
  text: string;
  busyQuick: boolean;
  busyAi: boolean;
  onChangeText: (text: string) => void;
  onSubmit: (e: React.FormEvent) => void;
};

export function PrivacyCheckForm({ text, busyQuick, busyAi, onChangeText, onSubmit }: Props) {
  return (
    <form onSubmit={onSubmit}>
      <div className={styles.field}>
        <label>
          確認したいテキスト
          <textarea
            value={text}
            onChange={(e) => onChangeText(e.target.value)}
            rows={10}
            placeholder="例: 会議メモや Slack の抜粋、自分で書いていない長文など"
            disabled={busyQuick || busyAi}
          />
        </label>
      </div>
      <button
        className={styles.primaryBtn}
        type="submit"
        disabled={busyQuick || busyAi || !text.trim()}
      >
        {busyQuick ? "マスク確認中…" : busyAi ? "ローカルAIで追加確認中…" : "チェックする"}
      </button>
    </form>
  );
}
