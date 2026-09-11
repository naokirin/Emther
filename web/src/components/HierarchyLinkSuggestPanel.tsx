"use client";

import styles from "@/app/page.module.css";
import type { IssueStrategyLinkSuggestion, ThemeOkrLinkSuggestion } from "@/lib/types";

export function ThemeOkrLinkSuggestPanel({
  suggestions,
  source,
  applyingId,
  onAdopt,
  onDismiss,
  onDismissOne,
}: {
  suggestions: ThemeOkrLinkSuggestion[];
  source: "cloud" | "heuristic";
  applyingId: string | null;
  onAdopt: (s: ThemeOkrLinkSuggestion) => void;
  onDismiss: () => void;
  onDismissOne: (themeId: string) => void;
}) {
  return (
    <div
      style={{
        marginTop: 12,
        padding: 10,
        border: "1px solid var(--border)",
        borderRadius: 8,
        fontSize: "0.8125rem",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
        <strong>OKRリンク提案</strong>
        <button type="button" className={styles.detailToggle} onClick={onDismiss}>
          閉じる
        </button>
      </div>
      <p className={styles.subtitle} style={{ margin: "4px 0 8px" }}>
        {suggestions.length} 件の候補（{source === "cloud" ? "AI" : "類似度フォールバック"}）。採用するまでテーマは変わりません。
      </p>
      {suggestions.length === 0 ? (
        <p className={styles.subtitle} style={{ margin: 0 }}>
          提案できるリンクがありませんでした。方針・目標に OKR があるか確認してください。
        </p>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
          {suggestions.map((s) => (
            <li
              key={s.themeId}
              style={{
                marginBottom: 10,
                paddingBottom: 10,
                borderBottom: "1px solid var(--border)",
              }}
            >
              <div style={{ fontWeight: 600 }}>{s.themeTitle}</div>
              <p className={styles.subtitle} style={{ margin: "2px 0 4px" }}>
                {s.rationale}
              </p>
              {s.labels.objectives.length > 0 && (
                <p style={{ margin: "0 0 2px" }}>Objective: {s.labels.objectives.join(" · ")}</p>
              )}
              {s.labels.keyResults.length > 0 && (
                <p style={{ margin: "0 0 6px" }}>KR: {s.labels.keyResults.join(" · ")}</p>
              )}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                <button
                  type="button"
                  className={styles.primaryBtn}
                  style={{ width: "auto", fontSize: "0.75rem" }}
                  disabled={applyingId === s.themeId}
                  onClick={() => onAdopt(s)}
                >
                  {applyingId === s.themeId ? "採用中…" : "採用してリンク"}
                </button>
                <button
                  type="button"
                  className={styles.btnOutline}
                  style={{ fontSize: "0.75rem" }}
                  disabled={!!applyingId}
                  onClick={() => onDismissOne(s.themeId)}
                >
                  スキップ
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function IssueStrategyLinkSuggestPanel({
  suggestions,
  source,
  applyingId,
  onAdopt,
  onDismiss,
  onDismissOne,
}: {
  suggestions: IssueStrategyLinkSuggestion[];
  source: "cloud" | "heuristic";
  applyingId: string | null;
  onAdopt: (s: IssueStrategyLinkSuggestion) => void;
  onDismiss: () => void;
  onDismissOne: (issueId: string) => void;
}) {
  return (
    <div
      style={{
        marginBottom: 12,
        padding: 10,
        border: "1px solid var(--border)",
        borderRadius: 8,
        fontSize: "0.8125rem",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
        <strong>戦略リンク提案</strong>
        <button type="button" className={styles.detailToggle} onClick={onDismiss}>
          閉じる
        </button>
      </div>
      <p className={styles.subtitle} style={{ margin: "4px 0 8px" }}>
        {suggestions.length} 件の候補（{source === "cloud" ? "AI" : "類似度フォールバック"}）。採用するまで Issue は変わりません。
      </p>
      {suggestions.length === 0 ? (
        <p className={styles.subtitle} style={{ margin: 0 }}>
          提案できるリンクがありませんでした。採用テーマや KR があるか確認してください。
        </p>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
          {suggestions.map((s) => (
            <li
              key={s.issueId}
              style={{
                marginBottom: 10,
                paddingBottom: 10,
                borderBottom: "1px solid var(--border)",
              }}
            >
              <div style={{ fontWeight: 600 }}>{s.issueTitle}</div>
              <p className={styles.subtitle} style={{ margin: "2px 0 4px" }}>
                {s.rationale}
              </p>
              {s.labels.theme && <p style={{ margin: "0 0 2px" }}>テーマ: {s.labels.theme}</p>}
              {s.labels.keyResult && <p style={{ margin: "0 0 6px" }}>KR: {s.labels.keyResult}</p>}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                <button
                  type="button"
                  className={styles.primaryBtn}
                  style={{ width: "auto", fontSize: "0.75rem" }}
                  disabled={applyingId === s.issueId}
                  onClick={() => onAdopt(s)}
                >
                  {applyingId === s.issueId ? "採用中…" : "採用してリンク"}
                </button>
                <button
                  type="button"
                  className={styles.btnOutline}
                  style={{ fontSize: "0.75rem" }}
                  disabled={!!applyingId}
                  onClick={() => onDismissOne(s.issueId)}
                >
                  スキップ
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
