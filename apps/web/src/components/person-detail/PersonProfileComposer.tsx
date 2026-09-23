import { useState, type FormEvent } from "react";
import { api } from "../../lib/api-client";
import styles from "../../styles/page.module.css";

// ユーザー要望「メンバーの詳細でも長期プロファイルを入力できるようにしたい」対応。
// これまでDashboardの「長期プロファイルを記録する」からしか登録できなかったが、
// 人物詳細画面はすでにpersonNameが確定しているため、対象欄なしでその場で記録できる
// ようにする。新規APIは追加せず、既存のPOST /api/knowledge/interpretationsをそのまま使う。
export function PersonProfileComposer({
  personName,
  onCreated,
}: {
  personName: string;
  onCreated: () => void;
}) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || pending) return;
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      const res = await api.api.knowledge.interpretations.$post({
        json: { person: personName, text: trimmed },
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "記録に失敗しました");
      setText("");
      setSaved(true);
      onCreated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginBottom: 12 }}>
      <p className={styles.subtitle} style={{ marginBottom: 6 }}>
        「{personName}はリーダー志向がある」のような長期的な解釈を、Journalとは別に期限切れなく記録します。
      </p>
      <div className={styles.journalInputRow}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          placeholder={`例: ${personName}はリーダー志向がある`}
          disabled={pending}
        />
        <button className={styles.primaryBtn} style={{ width: "auto" }} type="submit" disabled={pending || !text.trim()}>
          {pending ? "記録中…" : "記録"}
        </button>
      </div>
      {error && (
        <p className={styles.errorText} role="alert" style={{ marginTop: 6 }}>
          {error}
        </p>
      )}
      {saved && (
        <p className={styles.subtitle} style={{ marginTop: 6 }} role="status">
          ✅ 長期プロファイルとして記録しました。
        </p>
      )}
    </form>
  );
}
