"use client";

import { useState } from "react";
import styles from "@/app/page.module.css";
import { ObservationDumpSection } from "@/components/ObservationDumpSection";
import { QuickJournalNoteForm } from "@/components/QuickJournalNoteForm";

type Mode = "single" | "bulk";

type Props = {
  onSaved: () => void;
  /** `/journal?dump=` から深いリンク。あれば「まとめて取り込む」タブを既定で開く */
  focusDumpId?: string | null;
};

// ユーザー指摘「単発メモの折りたたみをやめ、まとめて取り込む機能と切り替え表示にしたい」
// 対応。従来は「単発でメモする」「📥 観測を取り込む」を別々に開閉するパネルとして縦に
// 並べていたが、片方を最初から全開にすると常に2フォーム分の縦幅を取ってしまう。
// 同一URL内のビュー切り替え（Issue一覧のリスト/ボード切替等）と同じ`.tabs`ピルで
// 1つのパネルの中身を切り替える形にする。
export function JournalInputSwitcher({ onSaved, focusDumpId }: Props) {
  const [mode, setMode] = useState<Mode>(focusDumpId ? "bulk" : "single");

  return (
    <div className={styles.panel} style={{ marginBottom: 16 }}>
      <div className={styles.tabs}>
        <button
          type="button"
          className={`${styles.tabBtn} ${mode === "single" ? styles.tabBtnActive : ""}`}
          onClick={() => setMode("single")}
        >
          📝 単発メモ
        </button>
        <button
          type="button"
          className={`${styles.tabBtn} ${mode === "bulk" ? styles.tabBtnActive : ""}`}
          onClick={() => setMode("bulk")}
        >
          📥 まとめて取り込む
        </button>
      </div>
      {mode === "single" ? (
        <QuickJournalNoteForm onCreated={onSaved} />
      ) : (
        <ObservationDumpSection onAccepted={onSaved} focusDumpId={focusDumpId} />
      )}
    </div>
  );
}
