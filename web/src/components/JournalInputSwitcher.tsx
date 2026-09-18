"use client";

import { useState } from "react";
import styles from "@/app/page.module.css";
import { DailyReflectionForm } from "@/components/DailyReflectionForm";
import { LocalLogSummaryImporter } from "@/components/LocalLogSummaryImporter";
import { ObservationDumpSection } from "@/components/ObservationDumpSection";
import { QuickJournalNoteForm } from "@/components/QuickJournalNoteForm";

type Mode = "reflection" | "single" | "local-summary" | "bulk";

type Props = {
  onSaved: () => void;
  /** `/journal?dump=` から深いリンク。あれば「まとめて取り込む」タブを既定で開く */
  focusDumpId?: string | null;
  /** 初期表示モード（未指定時は第4期ピボット方針に従い "reflection"） */
  initialMode?: Mode;
  /** 外部（今日タブ等）からのプリフィル文字列。指定時は随時メモタブを初期表示 */
  prefill?: string | null;
};

// 第4期ピボット対応:
// 「基本として1日の終わりにAIの問いかけに答えていくことで今日あったことを振り返り、
// EMにあったこと、やったこと、気づきなどを引き出して記載する」体験を基本の想定（既定）とする。
// 一方で「思ったとき、気づいたときに書き込める」随時メモや、機微生ログをローカルで安全に
// 要約・手直しする機能もタブで選べるように統合する。
export function JournalInputSwitcher({ onSaved, focusDumpId, initialMode, prefill }: Props) {
  const [mode, setMode] = useState<Mode>(
    focusDumpId ? "bulk" : prefill ? "single" : (initialMode ?? "reflection"),
  );

  return (
    <div className={styles.panel} style={{ marginBottom: 16 }}>
      <div className={styles.tabs}>
        <button
          type="button"
          className={`${styles.tabBtn} ${mode === "reflection" ? styles.tabBtnActive : ""}`}
          onClick={() => setMode("reflection")}
        >
          🌙 1日の振り返り
        </button>
        <button
          type="button"
          className={`${styles.tabBtn} ${mode === "single" ? styles.tabBtnActive : ""}`}
          onClick={() => setMode("single")}
        >
          📝 随時メモ
        </button>
        <button
          type="button"
          className={`${styles.tabBtn} ${mode === "local-summary" ? styles.tabBtnActive : ""}`}
          onClick={() => setMode("local-summary")}
        >
          🔒 議事録ローカル要約
        </button>
        <button
          type="button"
          className={`${styles.tabBtn} ${mode === "bulk" ? styles.tabBtnActive : ""}`}
          onClick={() => setMode("bulk")}
        >
          📥 まとめて取り込む
        </button>
      </div>
      {mode === "reflection" ? (
        <DailyReflectionForm onCreated={onSaved} />
      ) : mode === "single" ? (
        <QuickJournalNoteForm onCreated={onSaved} initialText={prefill ?? undefined} />
      ) : mode === "local-summary" ? (
        <LocalLogSummaryImporter onCreated={onSaved} />
      ) : (
        <ObservationDumpSection onAccepted={onSaved} focusDumpId={focusDumpId} />
      )}
    </div>
  );
}
