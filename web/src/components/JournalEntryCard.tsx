"use client";

import { useRouter } from "next/navigation";
import styles from "@/app/page.module.css";
import { URGENCY_LABEL, type JournalEntry } from "@/lib/types";

// docs/memo.md TODO「Quick JournalをEMが後からリスト確認・検索しにくいUIになっている」対応。
// Dashboard（直近5件）とJournal一覧（全件検索）の両方で同じ表示・その場編集UIを使うための
// 共有コンポーネント。編集状態そのものは@/lib/hooksのuseJournalEditingが持ち、
// このコンポーネントは表示に専念する。
export function JournalEntryCard({
  entry,
  editing,
  editTags,
  editPeople,
  editUrgency,
  editSubmitting,
  editError,
  onChangeEditTags,
  onChangeEditPeople,
  onChangeEditUrgency,
  onConfirmEdit,
  onCancelEdit,
  onStartEdit,
}: {
  entry: JournalEntry;
  editing: boolean;
  editTags: string;
  editPeople: string;
  editUrgency: JournalEntry["urgency"];
  editSubmitting: boolean;
  editError: string | null;
  onChangeEditTags: (value: string) => void;
  onChangeEditPeople: (value: string) => void;
  onChangeEditUrgency: (value: JournalEntry["urgency"]) => void;
  onConfirmEdit: () => void;
  onCancelEdit: () => void;
  onStartEdit: () => void;
}) {
  const router = useRouter();

  if (editing) {
    return (
      <div className={styles.journalEntry}>
        <div>{entry.rawText}</div>
        <div className={styles.field} style={{ marginTop: 8 }}>
          <label>人物（カンマ区切り）</label>
          <input type="text" value={editPeople} onChange={(e) => onChangeEditPeople(e.target.value)} placeholder="例: Aさん, Bさん" />
        </div>
        <div className={styles.field}>
          <label>タグ（カンマ区切り）</label>
          <input type="text" value={editTags} onChange={(e) => onChangeEditTags(e.target.value)} placeholder="例: 1on1, 技術的負債" />
        </div>
        <div className={styles.field}>
          <label>Urgency</label>
          <select value={editUrgency} onChange={(e) => onChangeEditUrgency(e.target.value as JournalEntry["urgency"])}>
            <option value="low">Low</option>
            <option value="mid">Mid</option>
            <option value="high">High</option>
          </select>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button className={styles.primaryBtn} style={{ width: "auto" }} disabled={editSubmitting} onClick={onConfirmEdit}>
            {editSubmitting ? "確定中…" : "この内容で確定"}
          </button>
          <button className={styles.btnOutline} disabled={editSubmitting} onClick={onCancelEdit}>
            キャンセル
          </button>
        </div>
        {editError && <p className={styles.errorText}>{editError}</p>}
      </div>
    );
  }

  return (
    <div className={styles.journalEntry}>
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
            title="AIの自動抽出のままです。内容が正しければ「編集」→「この内容で確定」で確認してください。"
          >
            🤖 未確認
          </span>
        )}
        <button className={styles.detailToggle} onClick={onStartEdit}>
          編集
        </button>
      </div>
    </div>
  );
}
