"use client";

import { useState } from "react";
import styles from "@/app/page.module.css";
import { IssuePrioritySelector, IssueStatusSelector, IssueTriageAxes } from "@/components/IssueStatus";
import { ISSUE_PRIORITY_META, type Issue, type IssuePriority, type IssueStatus } from "@/lib/types";

type Props = {
  issue: Issue;
  refreshIssue: () => Promise<void>;
  refreshIssues: () => Promise<void>;
};

// docs/em_ui_ux_issue.md 4節「ステータス管理の導入」対応。ステータス切替・優先度切替・
// トリアージ再評価・フォーカス順の入れ替えをまとめたパネル。
export function IssueStatusPriorityPanel({ issue, refreshIssue, refreshIssues }: Props) {
  const [statusSaving, setStatusSaving] = useState(false);
  const [prioritySaving, setPrioritySaving] = useState(false);
  const [triageRescoring, setTriageRescoring] = useState(false);
  const [triageRescoreMessage, setTriageRescoreMessage] = useState<string | null>(null);

  // カンバンのドラッグ&ドロップは実装しないため、列（ステータス）の切り替えはここから行う。
  async function handleChangeStatus(status: IssueStatus) {
    setStatusSaving(true);
    try {
      const res = await fetch(`/api/issues/${issue.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) await refreshIssue();
    } finally {
      setStatusSaving(false);
    }
  }

  async function handleChangePriority(priority: IssuePriority) {
    setPrioritySaving(true);
    try {
      const res = await fetch(`/api/issues/${issue.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priority }),
      });
      if (res.ok) await Promise.all([refreshIssue(), refreshIssues()]);
    } finally {
      setPrioritySaving(false);
    }
  }

  async function handleRescoreTriage() {
    setTriageRescoring(true);
    setTriageRescoreMessage(null);
    try {
      const res = await fetch(`/api/issues/${issue.id}/triage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applySuggested: true }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "評価の更新に失敗しました");
      await Promise.all([refreshIssue(), refreshIssues()]);
      const sourceLabel =
        data?.source === "ai" ? "外部AI" : data?.source === "heuristic" ? "ルール（フォールバック）" : null;
      const sourceSuffix = sourceLabel ? ` · ${sourceLabel}` : "";
      setTriageRescoreMessage(
        data?.changed
          ? `評価を更新し、優先度を反映しました: ${data.fromLabel} → ${data.toLabel}${sourceSuffix}`
          : `評価を更新しました。優先度は変わりませんでした（提案: ${data?.suggestedLabel ?? "—"}）${sourceSuffix}`,
      );
    } catch (err) {
      setTriageRescoreMessage((err as Error).message);
    } finally {
      setTriageRescoring(false);
    }
  }

  async function handleMoveFocus(direction: "up" | "down") {
    setPrioritySaving(true);
    try {
      const res = await fetch(`/api/issues/${issue.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ moveFocus: direction }),
      });
      if (res.ok) await Promise.all([refreshIssue(), refreshIssues()]);
    } finally {
      setPrioritySaving(false);
    }
  }

  return (
    <>
      <div className={styles.field}>
        <span className={styles.fieldCaption}>ステータス</span>
        <IssueStatusSelector status={issue.status} onChange={handleChangeStatus} disabled={statusSaving} />
      </div>
      {!issue.parentId && (
        <div className={styles.field}>
          <span className={styles.fieldCaption}>優先度（今週〜今月の見通し / 今日の順）</span>
          <IssuePrioritySelector
            priority={issue.priority ?? "normal"}
            onChange={handleChangePriority}
            disabled={prioritySaving || triageRescoring}
          />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8, alignItems: "center" }}>
            <button
              type="button"
              className={styles.btnOutline}
              style={{ fontSize: "0.75rem" }}
              disabled={triageRescoring || prioritySaving}
              onClick={handleRescoreTriage}
              title="このIssueを外部AIで強制再採点し、提案どおり優先度へ反映します（未更新でも再評価します）"
            >
              {triageRescoring ? "更新中…" : "このIssueの評価を更新"}
            </button>
          </div>
          {triageRescoreMessage && (
            <p className={styles.subtitle} style={{ marginTop: 6 }} role="status">
              {triageRescoreMessage}
            </p>
          )}
          {issue.triage ? (
            <div style={{ marginTop: 8 }}>
              <p className={styles.subtitle} style={{ margin: "0 0 4px" }}>
                優先度の評価根拠
                <span className={styles.tableMuted}>
                  {" "}
                  · 更新 {new Date(issue.triage.scoredAt).toLocaleString("ja-JP")}
                  {issue.triage.source === "ai"
                    ? " · 外部AI"
                    : issue.triage.source === "heuristic"
                      ? " · ルール"
                      : null}
                </span>
                {issue.triage.suggestedPriority !== (issue.priority ?? "normal") && (
                  <span style={{ color: "var(--warning, #b45309)" }}>
                    {" "}
                    · 提案は {ISSUE_PRIORITY_META[issue.triage.suggestedPriority].icon}{" "}
                    {ISSUE_PRIORITY_META[issue.triage.suggestedPriority].label}（手動で変えた可能性があります）
                  </span>
                )}
              </p>
              <IssueTriageAxes triage={issue.triage} />
              <p className={styles.subtitle} style={{ marginTop: 6 }}>
                「このIssueの評価を更新」は未更新でも強制再採点します。一括更新は内容が変わった Issue
                だけを対象にします。
              </p>
            </div>
          ) : (
            <p className={styles.subtitle} style={{ marginTop: 8 }}>
              まだ評価がありません。上のボタン、または課題一覧の「評価を一括更新」から更新できます。
            </p>
          )}
          {issue.priority === "focus" && (
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <button
                type="button"
                className={styles.btnOutline}
                style={{ fontSize: "0.75rem" }}
                disabled={prioritySaving}
                onClick={() => handleMoveFocus("up")}
              >
                ↑ フォーカス順を前へ
              </button>
              <button
                type="button"
                className={styles.btnOutline}
                style={{ fontSize: "0.75rem" }}
                disabled={prioritySaving}
                onClick={() => handleMoveFocus("down")}
              >
                ↓ フォーカス順を後へ
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
