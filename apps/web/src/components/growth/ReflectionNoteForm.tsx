import styles from "../../styles/page.module.css";
import { RecordDateField } from "../RecordDateField";
import type { ReflectionNoteController } from "./useReflectionNoteController";
import type { ReflectionNoteType } from "@emther/core/types";

const NOTE_TYPE_LABEL: Record<ReflectionNoteType, string> = {
  keep: "👍 Keep（続けたいこと）",
  problem: "⚠️ Problem（気になること）",
  try: "🔧 Try（次にやってみたいこと）",
};

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
          {/* 固定3択は プルダウンで隠さずボタン群にする */}
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
