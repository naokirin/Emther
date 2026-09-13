"use client";

import styles from "@/app/page.module.css";
import { timestampToDateInputValue } from "@/lib/journal-date-parser";

// 改修依頼「前日分を入れ忘れたときに入れるなどできるように日付指定」対応。
// Journal入力の発生日UIと同じ折りたたみパターン。既定は今日のまま隠し、
// 前日分などを入れるときだけ開いて日付を選ぶ。
export function todayDateInputValue(): string {
  return timestampToDateInputValue(Date.now());
}

export function RecordDateField({
  open,
  date,
  onOpen,
  onDateChange,
  onReset,
  openLabel = "📅 前日分などを入れる（日付を変える）",
}: {
  open: boolean;
  date: string;
  onOpen: () => void;
  onDateChange: (value: string) => void;
  onReset: () => void;
  openLabel?: string;
}) {
  if (!open) {
    return (
      <button type="button" className={`${styles.detailToggle} ${styles.detailToggleButton}`} style={{ marginTop: 6 }} onClick={onOpen}>
        {openLabel}
      </button>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.75rem", color: "var(--text-muted)" }}>
        対象日
        <input type="date" value={date} onChange={(e) => onDateChange(e.target.value)} style={{ maxWidth: 160 }} />
      </label>
      <button type="button" className={`${styles.detailToggle} ${styles.detailToggleButton}`} onClick={onReset}>
        今日に戻す
      </button>
    </div>
  );
}
