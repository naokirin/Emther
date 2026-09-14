"use client";

import { useState } from "react";
import styles from "@/app/page.module.css";
import { HelpLink } from "@/components/HelpLink";
import { issueBacklogActionItems, issueNextAction, type Issue } from "@/lib/types";
import type { FetchWithNameConfirm } from "./types";

type Props = {
  issue: Issue;
  refreshIssue: () => Promise<void>;
  refreshIssues: () => Promise<void>;
  fetchWithNameConfirm: FetchWithNameConfirm;
};

// 次の一手／あとでやる／完了の3セクションと、Action Item追加フォームをまとめたパネル。
export function IssueActionItemsPanel({ issue, refreshIssue, refreshIssues, fetchWithNameConfirm }: Props) {
  const [actionItemText, setActionItemText] = useState("");
  const [promotingItemId, setPromotingItemId] = useState<string | null>(null);

  async function handleAddActionItem() {
    if (!actionItemText.trim()) return;
    try {
      const { res } = await fetchWithNameConfirm(
        `/api/issues/${issue.id}/action-items`,
        { method: "POST", body: { text: actionItemText } },
        "保存する",
      );
      if (res.ok) {
        setActionItemText("");
        await refreshIssue();
      }
    } catch {
      // キャンセル・失敗時は次回のポーリングで状態が揃う
    }
  }

  async function handleToggleActionItem(itemId: string) {
    try {
      const res = await fetch(`/api/issues/${issue.id}/action-items/${itemId}`, { method: "PATCH" });
      if (res.ok) await refreshIssue();
    } catch {
      // 失敗時は次回のポーリングで状態が揃う
    }
  }

  async function handleSetActionItemAsNext(itemId: string) {
    try {
      const res = await fetch(`/api/issues/${issue.id}/action-items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asNext: true }),
      });
      if (res.ok) await refreshIssue();
    } catch {
      // 失敗時は次回のポーリングで状態が揃う
    }
  }

  async function handleRemoveActionItem(itemId: string, text: string) {
    if (!window.confirm(`Action Item「${text}」を削除しますか？`)) return;
    try {
      const res = await fetch(`/api/issues/${issue.id}/action-items/${itemId}`, { method: "DELETE" });
      if (res.ok) await refreshIssue();
    } catch {
      // 失敗時は次回のポーリングで状態が揃う
    }
  }

  // Action Item → 子Issue。独自の介入物語として切り出す（1階層制限はAPI側でも拒否）。
  async function handlePromoteActionItem(itemId: string) {
    if (issue.parentId) return;
    setPromotingItemId(itemId);
    try {
      const { res } = await fetchWithNameConfirm(
        `/api/issues/${issue.id}/action-items/${itemId}/promote`,
        { method: "POST", body: {} },
        "子Issueとして作成する",
      );
      if (res.ok) await Promise.all([refreshIssue(), refreshIssues()]);
    } catch {
      // キャンセル・失敗時は次回のポーリングで状態が揃う
    } finally {
      setPromotingItemId(null);
    }
  }

  const nextItem = issueNextAction(issue);
  const backlog = issueBacklogActionItems(issue);
  const doneItems = issue.actionItems.filter((a) => a.done);

  return (
    <>
      <div className={styles.pageTitleWithHelp} style={{ marginTop: 16, marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>Action Items</h2>
        <HelpLink anchor="issues" />
      </div>
      <h3 style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "0 0 6px" }}>次の一手</h3>
      {!nextItem ? (
        <p className={styles.subtitle} style={{ marginBottom: 10 }}>
          未設定です。下から追加するか、あとでやる一覧から「次の一手にする」を選んでください。
        </p>
      ) : (
        <div
          style={{
            fontSize: "0.875rem",
            marginBottom: 12,
            padding: "8px 10px",
            border: "1px solid var(--border)",
            borderRadius: 6,
            background: "var(--surface-raised, transparent)",
          }}
        >
          <label style={{ display: "flex", gap: 6, alignItems: "flex-start", cursor: "pointer" }}>
            <input type="checkbox" checked={false} onChange={() => handleToggleActionItem(nextItem.id)} style={{ marginTop: 2 }} />
            <span style={{ flex: 1 }}>{nextItem.text}</span>
          </label>
          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            {!issue.parentId && (
              <button
                type="button"
                className={styles.btnOutline}
                style={{ fontSize: "0.75rem" }}
                disabled={promotingItemId === nextItem.id}
                onClick={() => handlePromoteActionItem(nextItem.id)}
              >
                {promotingItemId === nextItem.id ? "昇格中…" : "子Issueに昇格"}
              </button>
            )}
            <button
              type="button"
              className={styles.btnOutline}
              style={{ fontSize: "0.75rem" }}
              onClick={() => handleRemoveActionItem(nextItem.id, nextItem.text)}
            >
              削除
            </button>
          </div>
        </div>
      )}

      {backlog.length > 0 && (
        <>
          <h3 style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "0 0 6px" }}>あとでやる</h3>
          <ul style={{ listStyle: "none", marginBottom: 10 }}>
            {backlog.map((item) => (
              <li key={item.id} style={{ fontSize: "0.875rem", marginBottom: 8 }}>
                <label style={{ display: "flex", gap: 6, alignItems: "flex-start", cursor: "pointer" }}>
                  <input type="checkbox" checked={false} onChange={() => handleToggleActionItem(item.id)} style={{ marginTop: 2 }} />
                  <span style={{ flex: 1 }}>{item.text}</span>
                </label>
                <div style={{ display: "flex", gap: 6, marginTop: 4, marginLeft: 22 }}>
                  <button
                    type="button"
                    className={styles.btnOutline}
                    style={{ fontSize: "0.7rem", padding: "2px 8px" }}
                    onClick={() => handleSetActionItemAsNext(item.id)}
                  >
                    次の一手にする
                  </button>
                  {!issue.parentId && (
                    <button
                      type="button"
                      className={styles.btnOutline}
                      style={{ fontSize: "0.7rem", padding: "2px 8px" }}
                      disabled={promotingItemId === item.id}
                      onClick={() => handlePromoteActionItem(item.id)}
                    >
                      {promotingItemId === item.id ? "昇格中…" : "子Issueに昇格"}
                    </button>
                  )}
                  <button
                    type="button"
                    className={styles.btnOutline}
                    style={{ fontSize: "0.7rem", padding: "2px 8px" }}
                    onClick={() => handleRemoveActionItem(item.id, item.text)}
                  >
                    削除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {doneItems.length > 0 && (
        <>
          <h3 style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "0 0 6px" }}>完了</h3>
          <ul style={{ listStyle: "none", marginBottom: 10 }}>
            {doneItems.map((item) => (
              <li key={item.id} style={{ fontSize: "0.875rem", marginBottom: 6 }}>
                <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
                  <input type="checkbox" checked onChange={() => handleToggleActionItem(item.id)} />
                  <span style={{ flex: 1, textDecoration: "line-through", color: "var(--text-muted)" }}>{item.text}</span>
                </label>
                <div style={{ marginTop: 4, marginLeft: 22 }}>
                  <button
                    type="button"
                    className={styles.btnOutline}
                    style={{ fontSize: "0.7rem", padding: "2px 8px" }}
                    onClick={() => handleRemoveActionItem(item.id, item.text)}
                  >
                    削除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {issue.actionItems.length === 0 && <p className={styles.subtitle}>まだありません。</p>}

      <div className={styles.chatRow}>
        <textarea
          placeholder="Action Itemを追加（あとでやるへ）…"
          value={actionItemText}
          onChange={(e) => setActionItemText(e.target.value)}
          rows={2}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing && e.keyCode !== 229) {
              e.preventDefault();
              handleAddActionItem();
            }
          }}
        />
        <button className={styles.primaryBtn} style={{ width: "auto" }} disabled={!actionItemText.trim()} onClick={handleAddActionItem}>
          追加
        </button>
      </div>
    </>
  );
}
