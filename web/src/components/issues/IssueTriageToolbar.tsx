"use client";

import { useState } from "react";
import styles from "@/app/page.module.css";
import { IssueTriageAxes } from "@/components/IssueStatus";
import { IssueStrategyLinkSuggestPanel } from "@/components/HierarchyLinkSuggestPanel";
import {
  isIssueStrategyUnlinked,
  type Issue,
  type IssuePriority,
  type IssueStrategyLinkSuggestion,
  type ObjectiveWithProgress,
  type OrgTheme,
} from "@/lib/types";

type TriagePreview = {
  counts: Record<IssuePriority, number>;
  focusCandidates: Array<{
    id: string;
    title: string;
    costOfDelay: number;
    effort: number;
    blastRadius: number;
    confidence: number;
  }>;
  changes: Array<{ issueId: string; title: string; fromLabel: string; toLabel: string }>;
};

type Props = {
  issues: Issue[];
  themes: OrgTheme[];
  objectives: ObjectiveWithProgress[];
  refreshIssues: () => Promise<void> | void;
  onPeekOpen: (id: string) => void;
};

// 「評価を一括更新」「戦略リンクを提案」の2ボタンと、それぞれの結果パネル。
export function IssueTriageToolbar({ issues, themes, objectives, refreshIssues, onPeekOpen }: Props) {
  const [triageSubmitting, setTriageSubmitting] = useState(false);
  const [triageError, setTriageError] = useState<string | null>(null);
  const [triageMessage, setTriageMessage] = useState<string | null>(null);
  const [triagePreview, setTriagePreview] = useState<TriagePreview | null>(null);
  const [linkSuggesting, setLinkSuggesting] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkPreview, setLinkPreview] = useState<{
    suggestions: IssueStrategyLinkSuggestion[];
    source: "cloud" | "heuristic";
    fallbackReason?: string;
  } | null>(null);
  const [linkApplyingId, setLinkApplyingId] = useState<string | null>(null);

  async function handleBulkUpdateTriage() {
    setTriageSubmitting(true);
    setTriageError(null);
    setTriageMessage(null);
    try {
      const res = await fetch("/api/issues/triage/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applySuggested: true, focusLimit: 5 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "評価の一括更新に失敗しました");
      const focusN = Array.isArray(data.focusCandidates) ? data.focusCandidates.length : 0;
      const changeN = Array.isArray(data.changes) ? data.changes.length : 0;
      const counts = data.counts ?? { focus: 0, normal: 0, parked: 0 };
      setTriagePreview({
        counts,
        focusCandidates: Array.isArray(data.focusCandidates) ? data.focusCandidates : [],
        changes: Array.isArray(data.changes) ? data.changes : [],
      });
      const rescored = typeof data.rescoredCount === "number" ? data.rescoredCount : null;
      const skipped = typeof data.skippedUnchangedCount === "number" ? data.skippedUnchangedCount : null;
      const aiN = typeof data.aiCount === "number" ? data.aiCount : null;
      const heurN = typeof data.heuristicCount === "number" ? data.heuristicCount : null;
      const statsBits = [
        rescored !== null ? `再採点 ${rescored}` : null,
        skipped !== null ? `未更新スキップ ${skipped}` : null,
        aiN !== null || heurN !== null ? `AI ${aiN ?? 0} / ルール ${heurN ?? 0}` : null,
      ].filter(Boolean);
      const statsSuffix = statsBits.length ? `（${statsBits.join(" · ")}）` : "";
      setTriageMessage(
        changeN > 0
          ? `評価を更新し、優先度を ${changeN} 件反映しました（フォーカス ${focusN} 件）。例外だけ個別に直してください。${statsSuffix}`
          : `評価を更新しました。優先度の変更はありません（提案: 🔥${counts.focus ?? 0} / ➖${counts.normal ?? 0} / 🅿️${counts.parked ?? 0}）。${statsSuffix}`,
      );
      await refreshIssues();
    } catch (err) {
      setTriageError((err as Error).message);
    } finally {
      setTriageSubmitting(false);
    }
  }

  async function handleSuggestStrategyLinks() {
    setLinkSuggesting(true);
    setLinkError(null);
    try {
      const res = await fetch("/api/issues/link/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "戦略リンク提案に失敗しました");
      setLinkPreview({
        suggestions: Array.isArray(data?.suggestions) ? data.suggestions : [],
        source: data?.source === "cloud" ? "cloud" : "heuristic",
        fallbackReason: typeof data?.fallbackReason === "string" ? data.fallbackReason : undefined,
      });
    } catch (err) {
      setLinkError((err as Error).message);
    } finally {
      setLinkSuggesting(false);
    }
  }

  async function handleAdoptStrategyLink(s: IssueStrategyLinkSuggestion) {
    setLinkApplyingId(s.issueId);
    setLinkError(null);
    try {
      const res = await fetch(`/api/issues/${s.issueId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          themeId: s.themeId,
          keyResultId: s.keyResultId,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "リンクの採用に失敗しました");
      }
      await refreshIssues();
      setLinkPreview((prev) =>
        prev
          ? { ...prev, suggestions: prev.suggestions.filter((x) => x.issueId !== s.issueId) }
          : null,
      );
    } catch (err) {
      setLinkError((err as Error).message);
    } finally {
      setLinkApplyingId(null);
    }
  }

  const unlinkedStrategyCount = issues.filter(
    (i) => !i.archived && i.status !== "done" && !i.parentId && isIssueStrategyUnlinked(i),
  ).length;

  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, margin: "4px 0 12px" }}>
        <button
          type="button"
          className={styles.btnOutline}
          disabled={triageSubmitting}
          onClick={handleBulkUpdateTriage}
          title="内容が変わった親 Issue だけを再採点し、提案どおり優先度へ反映します"
        >
          {triageSubmitting ? "更新中…" : "評価を一括更新"}
        </button>
        {unlinkedStrategyCount > 0 && (
          <button
            type="button"
            className={styles.btnOutline}
            disabled={linkSuggesting || (themes.filter((t) => t.status === "adopted").length === 0 && objectives.length === 0)}
            onClick={handleSuggestStrategyLinks}
            title="戦略未接続の親 Issue へ、テーマ / KR の紐付けをAIが提案します（採用まで反映しません）"
          >
            {linkSuggesting ? "提案中…" : `🔗 戦略リンクを提案 (${unlinkedStrategyCount})`}
          </button>
        )}
      </div>
      {linkError && (
        <p className={styles.errorText} role="alert">
          {linkError}
        </p>
      )}
      {linkPreview && (
        <IssueStrategyLinkSuggestPanel
          suggestions={linkPreview.suggestions}
          source={linkPreview.source}
          fallbackReason={linkPreview.fallbackReason}
          applyingId={linkApplyingId}
          onAdopt={handleAdoptStrategyLink}
          onDismiss={() => setLinkPreview(null)}
          onDismissOne={(issueId) =>
            setLinkPreview((prev) =>
              prev
                ? { ...prev, suggestions: prev.suggestions.filter((x) => x.issueId !== issueId) }
                : null,
            )
          }
        />
      )}
      {triageError && (
        <p className={styles.errorText} role="alert">
          {triageError}
        </p>
      )}
      {triageMessage && <p className={styles.subtitle}>{triageMessage}</p>}
      {triagePreview && (
        <div
          style={{
            marginBottom: 12,
            padding: 10,
            border: "1px solid var(--border)",
            borderRadius: 8,
            fontSize: "0.875rem",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
            <strong>更新結果</strong>
            <button type="button" className={styles.detailToggle} onClick={() => setTriagePreview(null)}>
              閉じる
            </button>
          </div>
          <p className={styles.subtitle} style={{ margin: "4px 0 8px" }}>
            提案内訳: 🔥フォーカス {triagePreview.counts.focus} · ➖通常 {triagePreview.counts.normal} · 🅿️保留{" "}
            {triagePreview.counts.parked}
            （フォーカスは上位 {triagePreview.focusCandidates.length} 件）
          </p>
          {triagePreview.focusCandidates.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div className={styles.fieldCaption}>フォーカスになった Issue（評価軸の高い順）</div>
              <ul style={{ margin: "4px 0 0", padding: 0, listStyle: "none" }}>
                {triagePreview.focusCandidates.map((c) => (
                  <li key={c.id} style={{ marginBottom: 8 }}>
                    <button type="button" className={styles.tableRowLink} onClick={() => onPeekOpen(c.id)}>
                      {c.title}
                    </button>
                    <IssueTriageAxes
                      triage={{
                        costOfDelay: c.costOfDelay,
                        effort: c.effort,
                        blastRadius: c.blastRadius,
                        confidence: c.confidence,
                      }}
                      compact
                    />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {triagePreview.changes.length > 0 ? (
            <div>
              <div className={styles.fieldCaption}>優先度が変わった Issue（{triagePreview.changes.length}）</div>
              <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>
                {triagePreview.changes.map((c) => (
                  <li key={c.issueId} style={{ marginBottom: 2 }}>
                    <button type="button" className={styles.tableRowLink} onClick={() => onPeekOpen(c.issueId)}>
                      {c.title}
                    </button>
                    <span className={styles.tableMuted}>
                      {" "}
                      {c.fromLabel} → {c.toLabel}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className={styles.subtitle} style={{ margin: 0 }}>
              実際に優先度が変わった Issue はありません。
            </p>
          )}
        </div>
      )}
    </>
  );
}
