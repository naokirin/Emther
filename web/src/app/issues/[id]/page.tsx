"use client";

import { use, useState } from "react";
import Link from "next/link";
import styles from "@/app/page.module.css";
import { CopilotChat, ExecutionState, StatusBadge, type AgentRun } from "@/components/RunDetail";
import { useIssue, useRuns } from "@/lib/hooks";

export default function IssueDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { issue, refreshIssue } = useIssue(id);
  const { runs, refreshRuns } = useRuns();

  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [deciding, setDeciding] = useState(false);
  const [decideError, setDecideError] = useState<string | null>(null);
  const [actionItemText, setActionItemText] = useState("");

  const linkedRun: AgentRun | null = issue ? runs.find((r) => r.id === issue.agentRunId) ?? null : null;

  async function sendDecision(text: string) {
    if (!linkedRun || !text.trim()) return;
    setDeciding(true);
    setDecideError(null);
    try {
      const res = await fetch(`/api/agents/${linkedRun.id}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "送信に失敗しました");
      setMessage("");
      setSelectedOptionId(null);
      await refreshRuns();
    } catch (err) {
      setDecideError((err as Error).message);
    } finally {
      setDeciding(false);
    }
  }

  function handleConfirmOption() {
    if (!linkedRun || !selectedOptionId) return;
    const opt = linkedRun.yieldRequest?.options.find((o) => o.id === selectedOptionId);
    if (!opt) return;
    sendDecision(`Option ${opt.id}（${opt.label}）を採用します。この方針で進めてください。`);
  }

  function handleFocusChat() {
    document.getElementById("issue-chat-input")?.focus();
  }

  async function handleAddActionItem() {
    if (!issue || !actionItemText.trim()) return;
    try {
      const res = await fetch(`/api/issues/${issue.id}/action-items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: actionItemText }),
      });
      if (res.ok) {
        setActionItemText("");
        await refreshIssue();
      }
    } catch {
      // 失敗時は次回のポーリングで状態が揃う
    }
  }

  async function handleToggleActionItem(itemId: string) {
    if (!issue) return;
    try {
      const res = await fetch(`/api/issues/${issue.id}/action-items/${itemId}`, { method: "PATCH" });
      if (res.ok) await refreshIssue();
    } catch {
      // 失敗時は次回のポーリングで状態が揃う
    }
  }

  if (!issue) {
    return (
      <div className={styles.screen}>
        <Link href="/issues" className={styles.backLink}>
          ← Issue一覧に戻る
        </Link>
        <p className={styles.subtitle}>読み込み中、またはIssueが見つかりません。</p>
      </div>
    );
  }

  return (
    <div className={styles.screen}>
      <Link href="/issues" className={styles.backLink}>
        ← Issue一覧に戻る
      </Link>

      <div className={styles.issueTitleRow}>
        <div>
          <h1>{issue.title}</h1>
          {linkedRun && <StatusBadge status={linkedRun.status} />}
        </div>
      </div>

      {decideError && <p className={styles.errorText}>{decideError}</p>}

      <div className={styles.issueColumns}>
        <div className={styles.panel}>
          <h2>Execution State</h2>
          {linkedRun ? (
            <ExecutionState
              run={linkedRun}
              selectedOptionId={selectedOptionId}
              onSelectOption={setSelectedOptionId}
              onConfirmOption={handleConfirmOption}
              onFocusChat={handleFocusChat}
              deciding={deciding}
            />
          ) : (
            <p className={styles.subtitle}>Agent Runが紐づいていません。Dashboardでタスクを起票するか、Issue一覧から紐づけてください。</p>
          )}

          <h2 style={{ marginTop: 16 }}>Action Items (Draft)</h2>
          {issue.actionItems.length === 0 && <p className={styles.subtitle}>まだありません。</p>}
          <ul style={{ listStyle: "none", marginBottom: 10 }}>
            {issue.actionItems.map((item) => (
              <li key={item.id} style={{ fontSize: 13, marginBottom: 6 }}>
                <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
                  <input type="checkbox" checked={item.done} onChange={() => handleToggleActionItem(item.id)} />
                  <span style={{ textDecoration: item.done ? "line-through" : "none", color: item.done ? "var(--text-muted)" : "inherit" }}>
                    {item.text}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className={styles.chatRow}>
            <input
              type="text"
              placeholder="Action Itemを追加…"
              value={actionItemText}
              onChange={(e) => setActionItemText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddActionItem();
              }}
            />
            <button className={styles.primaryBtn} style={{ width: "auto" }} disabled={!actionItemText.trim()} onClick={handleAddActionItem}>
              追加
            </button>
          </div>
        </div>

        <div className={styles.panel}>
          <h2>Copilot Workspace (Interactive)</h2>
          {linkedRun ? (
            <CopilotChat run={linkedRun} message={message} setMessage={setMessage} deciding={deciding} onDecide={sendDecision} inputId="issue-chat-input" />
          ) : (
            <p className={styles.subtitle}>Agent Runが無いため会話はありません。</p>
          )}
        </div>
      </div>
    </div>
  );
}
