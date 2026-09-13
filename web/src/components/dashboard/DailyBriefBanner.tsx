"use client";

import styles from "@/app/page.module.css";

export type Brief = { level: "urgent" | "warn" | "good" | "loading"; icon: string; text: string };
export type DayPhaseGuidance = { icon: string; text: string; cta?: string };

type Props = {
  brief: Brief;
  guidance: DayPhaseGuidance;
  onScrollToActions: () => void;
  onFocusJournal: () => void;
};

// UI/UX見直し（今日タブ）対応。「AIの価値が見えにくい」「重要度が埋もれる」への
// 対処として、個別シグナルの前にAIの一言診断（統合した1文＋色）を最上部に置く。
export function DailyBriefBanner({ brief, guidance, onScrollToActions, onFocusJournal }: Props) {
  return (
    <div
      className={`${styles.panel} ${styles[`brief-${brief.level}`]}`}
      style={{ display: "flex", alignItems: "flex-start", gap: 14, padding: "16px 18px" }}
    >
      <span aria-hidden style={{ fontSize: "1.75rem", lineHeight: 1, flexShrink: 0 }}>
        {brief.icon}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <p style={{ margin: 0, fontSize: "1.0625rem", fontWeight: 700, lineHeight: 1.4 }}>{brief.text}</p>
          {/* ユーザー指摘「確認する先がわからない」対応。診断1文を出すだけで終わらせず、
              件数の内訳が並ぶ「今日やるべき3つ」へ確実に遷移できるボタンを添える。 */}
          {(brief.level === "urgent" || brief.level === "warn") && (
            <button type="button" className={styles.primaryBtn} style={{ width: "auto", flexShrink: 0 }} onClick={onScrollToActions}>
              確認する ↓
            </button>
          )}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            marginTop: 6,
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
            {guidance.icon} {guidance.text}
          </span>
          {guidance.cta && (
            <button className={styles.btnOutline} style={{ flexShrink: 0 }} onClick={onFocusJournal}>
              {guidance.cta}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
