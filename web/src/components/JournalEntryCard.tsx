"use client";

import { useRouter } from "next/navigation";
import styles from "@/app/page.module.css";
import { URGENCY_LABEL, type JournalEntry } from "@/lib/types";

// docs/em_human_story_and_ux.md 改修依頼「まとめて記録する仕組み」対応。まとめ入力・日付
// 訂正により、entry.createdAt（＝出来事の発生日）が「今日」以外になり得るため、常に
// 発生日を短く表示する（今日/昨日はそう書き、それ以外はM/D）。
function formatEntryDate(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(today) - startOf(d)) / (24 * 60 * 60 * 1000));
  if (diffDays === 0) return "今日";
  if (diffDays === 1) return "昨日";
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// docs/memo.md TODO「Quick JournalをEMが後からリスト確認・検索しにくいUIになっている」対応。
// Dashboard（直近5件）とJournal一覧（全件検索）の両方で同じ表示・その場編集UIを使うための
// 共有コンポーネント。編集状態そのものは@/lib/hooksのuseJournalEditingが持ち、
// このコンポーネントは表示に専念する。改修依頼「一覧表示を表形式に」対応。呼び出し側が
// <table><tbody>で囲む前提の<tr>を返す（3列: 発生日／内容／操作）。
export function JournalEntryCard({
  entry,
  editing,
  editTags,
  editPeople,
  editUrgency,
  editDate,
  editSubmitting,
  editError,
  onChangeEditTags,
  onChangeEditPeople,
  onChangeEditUrgency,
  onChangeEditDate,
  onConfirmEdit,
  onCancelEdit,
  onStartEdit,
}: {
  entry: JournalEntry;
  editing: boolean;
  editTags: string;
  editPeople: string;
  editUrgency: JournalEntry["urgency"];
  editDate: string;
  editSubmitting: boolean;
  editError: string | null;
  onChangeEditTags: (value: string) => void;
  onChangeEditPeople: (value: string) => void;
  onChangeEditUrgency: (value: JournalEntry["urgency"]) => void;
  onChangeEditDate: (value: string) => void;
  onConfirmEdit: () => void;
  onCancelEdit: () => void;
  onStartEdit: () => void;
}) {
  const router = useRouter();

  if (editing) {
    return (
      <tr>
        <td colSpan={3}>
          <div>{entry.rawText}</div>
          <div className={styles.field} style={{ marginTop: 8 }}>
            <label>
              発生日（時刻は不要）
              <input type="date" value={editDate} onChange={(e) => onChangeEditDate(e.target.value)} style={{ maxWidth: 160 }} />
            </label>
          </div>
          <div className={styles.field}>
            <label>
              人物（カンマ区切り）
              <input type="text" value={editPeople} onChange={(e) => onChangeEditPeople(e.target.value)} placeholder="例: Aさん, Bさん" />
            </label>
          </div>
          <div className={styles.field}>
            <label>
              タグ（カンマ区切り）
              <input type="text" value={editTags} onChange={(e) => onChangeEditTags(e.target.value)} placeholder="例: 1on1, 技術的負債" />
            </label>
          </div>
          <div className={styles.field}>
            <label>
              Urgency
              <select value={editUrgency} onChange={(e) => onChangeEditUrgency(e.target.value as JournalEntry["urgency"])}>
                <option value="low">Low</option>
                <option value="mid">Mid</option>
                <option value="high">High</option>
              </select>
            </label>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button className={styles.primaryBtn} style={{ width: "auto" }} disabled={editSubmitting} onClick={onConfirmEdit}>
              {editSubmitting ? "確定中…" : "この内容で確定"}
            </button>
            <button className={styles.btnOutline} disabled={editSubmitting} onClick={onCancelEdit}>
              キャンセル
            </button>
          </div>
          {editError && (
            <p className={styles.errorText} role="alert">
              {editError}
            </p>
          )}
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td className={styles.tableMuted} title="出来事の発生日" style={{ whiteSpace: "nowrap" }}>
        🗓 {formatEntryDate(entry.createdAt)}
      </td>
      <td>
        <div>{entry.rawText}</div>
        <div className={styles.tagRow}>
          {entry.people.map((p) => (
            <button
              key={p}
              className={`${styles.tag} ${styles.tagPerson} ${styles.tagBtn}`}
              onClick={() => router.push(`/chat?prefill=${encodeURIComponent(`${p}について最近の懸念を整理して`)}`)}
            >
              @{p}
            </button>
          ))}
          {entry.tags.map((t) => (
            <button
              key={t}
              className={`${styles.tag} ${styles.tagTopic} ${styles.tagBtn}`}
              onClick={() => router.push(`/issues?tag=${encodeURIComponent(t)}`)}
            >
              #{t}
            </button>
          ))}
          {entry.sentiment !== "neutral" && (
            <span className={`${styles.tag} ${entry.sentiment === "positive" ? styles.tagPos : styles.tagNeg}`}>
              #{entry.sentiment === "positive" ? "ポジティブ" : "ネガティブ"}
            </span>
          )}
          <span className={`${styles.urgencyLabel} ${styles[`urgency${entry.urgency}`]}`}>{URGENCY_LABEL[entry.urgency]}</span>
          {!entry.confirmed && (
            <span
              className={styles.subtitle}
              title="AIの自動抽出のままです。内容・発生日が正しければ「編集」→「この内容で確定」で確認してください。"
            >
              🤖 未確認
            </span>
          )}
        </div>
      </td>
      <td>
        <button className={`${styles.detailToggle} ${styles.detailToggleButton}`} onClick={onStartEdit}>
          編集
        </button>
      </td>
    </tr>
  );
}
