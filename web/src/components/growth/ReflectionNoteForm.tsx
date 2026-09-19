"use client";

import { useState } from "react";
import styles from "@/app/page.module.css";
import { RecordDateField, todayDateInputValue } from "@/components/RecordDateField";
import { useReflectionNotes } from "@/lib/hooks";
import type { EmReflectionNote, ReflectionNoteType } from "@core/types";

const NOTE_TYPE_LABEL: Record<ReflectionNoteType, string> = {
  keep: "👍 Keep（続けたいこと）",
  problem: "⚠️ Problem（気になること）",
  try: "🔧 Try（次にやってみたいこと）",
};

export type ReflectionNoteController = ReturnType<typeof useReflectionNoteController>;

// growth/page.tsxのKPT入力欄と、夜の締めくくりフローの両方から使うため、
// EmCheckinWidgetのuseEmCheckinControllerと同じ「フォームと一覧表示でcontrollerを共有する」
// パターンに揃える。フォーム側だけ独立してuseReflectionNotes()を持つと、一覧側への反映が
// 次のポーリング（15秒間隔）まで遅延する回帰になるため、notes/setNotesは必ずこのフックの
// 呼び出し元と共有すること。
export function useReflectionNoteController(onCreated?: (note: EmReflectionNote) => void) {
  const { notes, setNotes, notesLoaded } = useReflectionNotes();

  const [noteType, setNoteType] = useState<ReflectionNoteType>("keep");
  const [noteText, setNoteText] = useState("");
  const [noteDateOpen, setNoteDateOpen] = useState(false);
  const [noteCreatedAtDate, setNoteCreatedAtDate] = useState("");
  const [noteSubmitting, setNoteSubmitting] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  function resetNoteDate() {
    setNoteCreatedAtDate("");
    setNoteDateOpen(false);
  }

  // 改修依頼対応。1回の送信＝1件のメモ。typeは直前の選択を保ったままにする
  // （同じ種類のメモを立て続けに書きたい場面が多いため、毎回選び直させない）。
  async function handleNoteSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!noteText.trim()) return;
    setNoteSubmitting(true);
    setNoteError(null);
    try {
      const res = await fetch("/api/em-self/reflection-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: noteType,
          text: noteText,
          ...(noteCreatedAtDate ? { createdAtDate: noteCreatedAtDate } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "記録に失敗しました");
      setNotes([data.note, ...notes]);
      setNoteText("");
      resetNoteDate();
      onCreated?.(data.note);
    } catch (err) {
      setNoteError((err as Error).message);
    } finally {
      setNoteSubmitting(false);
    }
  }

  return {
    notes,
    setNotes,
    notesLoaded,
    noteType,
    setNoteType,
    noteText,
    setNoteText,
    noteDateOpen,
    noteCreatedAtDate,
    openNoteDate: () => {
      setNoteCreatedAtDate((prev) => prev || todayDateInputValue());
      setNoteDateOpen(true);
    },
    setNoteCreatedAtDate,
    resetNoteDate,
    noteSubmitting,
    noteError,
    handleNoteSubmit,
  };
}

export function ReflectionNoteForm({ controller }: { controller: ReflectionNoteController }) {
  const {
    noteType,
    setNoteType,
    noteText,
    setNoteText,
    noteDateOpen,
    noteCreatedAtDate,
    openNoteDate,
    setNoteCreatedAtDate,
    resetNoteDate,
    noteSubmitting,
    noteError,
    handleNoteSubmit,
  } = controller;

  return (
    <>
      <form onSubmit={handleNoteSubmit}>
        <div className={styles.field}>
          {/* 改修依頼「selectの選択肢の選択のしにくさそのものの改善」対応。固定3択は
              プルダウンで隠さずボタン群にする。 */}
          <span className={styles.fieldCaption}>種類</span>
          <div role="group" aria-label="種類" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {(["keep", "problem", "try"] as const).map((t) => (
              <button
                key={t}
                type="button"
                className={`${styles.typeChip} ${noteType === t ? styles.typeChipSelected : ""}`}
                onClick={() => setNoteType(t)}
              >
                {NOTE_TYPE_LABEL[t]}
              </button>
            ))}
          </div>
        </div>
        <div className={styles.journalInputRow}>
          <textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            rows={3}
            placeholder="例: 割り込み対応が多くて計画的な仕事に時間を割けなかった"
          />
          <button className={styles.primaryBtn} style={{ width: "auto" }} type="submit" disabled={noteSubmitting || !noteText.trim()}>
            {noteSubmitting ? "記録中…" : "記録する"}
          </button>
        </div>
        <RecordDateField
          open={noteDateOpen}
          date={noteCreatedAtDate}
          onOpen={openNoteDate}
          onDateChange={setNoteCreatedAtDate}
          onReset={resetNoteDate}
        />
      </form>
      {noteError && (
        <p className={styles.errorText} role="alert">
          {noteError}
        </p>
      )}
    </>
  );
}
