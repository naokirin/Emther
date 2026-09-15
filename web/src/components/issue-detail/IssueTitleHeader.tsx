"use client";

import { useState } from "react";
import styles from "@/app/page.module.css";
import { StatusBadge, type AgentRun } from "@/components/RunDetail";
import { IssueStatusBadge } from "@/components/IssueStatus";
import { isIssueStalled, type Issue } from "@/lib/types";
import type { FetchWithNameConfirm, RetryableError } from "./types";

type Props = {
  issue: Issue;
  linkedRun: AgentRun | null;
  stale: boolean;
  now: number;
  staleInterventionDays: number;
  archiving: boolean;
  onToggleArchived: () => void;
  fetchWithNameConfirm: FetchWithNameConfirm;
  refreshIssue: () => Promise<void>;
  refreshIssues: () => Promise<void>;
};

// docs/em_human_story_and_ux.md 改修依頼「Issueのタイトルを変更できるようにする」対応。
// タイトルのインライン編集・ステータスバッジ・アーカイブ切替をまとめたヘッダー。
export function IssueTitleHeader({
  issue,
  linkedRun,
  stale,
  now,
  staleInterventionDays,
  archiving,
  onToggleArchived,
  fetchWithNameConfirm,
  refreshIssue,
  refreshIssues,
}: Props) {
  // titleEditingはEMのクリックで開始する（issueの非同期取得を待つ必要はなく、編集ボタン
  // 自体issueが揃ってから初めて描画されるため、レンダー中の同期は不要）。
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [titleError, setTitleError] = useState<string | null>(null);
  // Journalと同様、ローカルNERを含む保存完了をフォーム上で待たず、対象箇所にスピナーを出す。
  const [titlePending, setTitlePending] = useState(false);
  const [titlePendingError, setTitlePendingError] = useState<RetryableError | null>(null);

  function startEditingTitle() {
    if (titlePending) return;
    setTitleDraft(issue.title);
    setTitleError(null);
    setTitlePendingError(null);
    setTitleEditing(true);
  }

  async function sendTitlePatch(trimmed: string, retry: () => void) {
    setTitlePending(true);
    setTitlePendingError(null);
    try {
      const { res, data } = await fetchWithNameConfirm(
        `/api/issues/${issue.id}`,
        { method: "PATCH", body: { title: trimmed } },
        "保存する",
      );
      if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? "保存に失敗しました");
      await Promise.all([refreshIssue(), refreshIssues()]);
    } catch (err) {
      if ((err as Error).message !== "人名候補の確認をキャンセルしました") {
        setTitlePendingError({ message: (err as Error).message, retry });
      }
    } finally {
      setTitlePending(false);
    }
  }

  function handleSaveTitle() {
    const trimmed = titleDraft.trim();
    if (!trimmed) {
      setTitleError("タイトルは必須です");
      return;
    }
    if (trimmed === issue.title) {
      setTitleEditing(false);
      setTitleError(null);
      return;
    }
    setTitleError(null);
    setTitleEditing(false);
    const retry = () => {
      void sendTitlePatch(trimmed, retry);
    };
    void sendTitlePatch(trimmed, retry);
  }

  return (
    <div className={styles.issueTitleRow}>
      <div style={{ flex: 1, minWidth: 0 }}>
        {titleEditing ? (
          <div className={styles.field} style={{ maxWidth: 480 }}>
            <input
              type="text"
              aria-label="タイトル"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              autoFocus
            />
            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
              <button
                className={styles.primaryBtn}
                style={{ width: "auto" }}
                disabled={!titleDraft.trim() || titleDraft.trim() === issue.title}
                onClick={handleSaveTitle}
              >
                保存
              </button>
              <button className={styles.btnOutline} onClick={() => setTitleEditing(false)}>
                キャンセル
              </button>
            </div>
            {titleError && (
              <p className={styles.errorText} role="alert">
                {titleError}
              </p>
            )}
          </div>
        ) : (
          <>
            <h2 style={{ display: "inline" }}>{issue.title}</h2>{" "}
            {!titlePending && (
              <button
                className={`${styles.detailToggle} ${styles.detailToggleButton}`}
                onClick={startEditingTitle}
              >
                編集
              </button>
            )}
            <br />
            {titlePending && (
              <p className={styles.subtitle} role="status">
                <span className={styles.spinner} aria-hidden="true" />
                タイトルを保存中…
              </p>
            )}
            {titlePendingError && (
              <div className={styles.tagRow} style={{ marginTop: 4 }}>
                <span className={styles.errorText} role="alert">
                  ⚠️ タイトルの保存に失敗しました: {titlePendingError.message}
                </span>
                <button className={styles.btnOutline} onClick={titlePendingError.retry}>
                  再試行
                </button>
                <button className={styles.btnOutline} onClick={() => setTitlePendingError(null)}>
                  閉じる
                </button>
              </div>
            )}
            <IssueStatusBadge status={issue.status} />{" "}
            {linkedRun && <StatusBadge status={linkedRun.status} stale={stale} />}
            {issue.archived && (
              <span className={styles.subtitle} style={{ marginLeft: 6 }}>
                🗄 アーカイブ済み
              </span>
            )}
            {isIssueStalled(issue, now, staleInterventionDays) && (
              <span className={styles.subtitle} style={{ marginLeft: 6 }}>
                ⏳ 停滞中
              </span>
            )}
          </>
        )}
      </div>
      <button
        className={styles.btnOutline}
        onClick={onToggleArchived}
        disabled={archiving}
        title="追う必要がなくなったときに一覧から外します。"
      >
        {issue.archived ? "アーカイブを解除" : "アーカイブする（追わない）"}
      </button>
    </div>
  );
}
