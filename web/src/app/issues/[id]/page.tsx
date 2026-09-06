"use client";

import { use, useRef, useState } from "react";
import Link from "next/link";
import styles from "@/app/page.module.css";
import { CopilotChat, ExecutionState, StatusBadge, type AgentRun } from "@/components/RunDetail";
import { useIssue, useRuns } from "@/lib/hooks";
import { charterFilledCount } from "@/lib/types";

export default function IssueDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { issue, refreshIssue } = useIssue(id);
  const { runs, refreshRuns } = useRuns();

  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [deciding, setDeciding] = useState(false);
  const [decideError, setDecideError] = useState<string | null>(null);
  const [actionItemText, setActionItemText] = useState("");

  const [charterSaving, setCharterSaving] = useState(false);
  const [charterError, setCharterError] = useState<string | null>(null);
  const whyRef = useRef<HTMLTextAreaElement | null>(null);
  const whatRef = useRef<HTMLTextAreaElement | null>(null);
  const howRef = useRef<HTMLTextAreaElement | null>(null);

  async function handleSaveCharter() {
    if (!issue) return;
    setCharterSaving(true);
    setCharterError(null);
    try {
      const res = await fetch(`/api/issues/${issue.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          why: whyRef.current?.value ?? "",
          what: whatRef.current?.value ?? "",
          how: howRef.current?.value ?? "",
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "保存に失敗しました");
      }
      await refreshIssue();
    } catch (err) {
      setCharterError((err as Error).message);
    } finally {
      setCharterSaving(false);
    }
  }

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

      <div className={`${styles.panel} ${styles.charterSection}`} key={issue.id}>
        <h2>Why / What / How</h2>
        <p className={styles.subtitle} style={{ marginBottom: 10 }}>
          計画・実行の前に明らかにしておくべき3要素。分かっている範囲で記入し、空欄（点線＝未整理）が残っている場合は着手前に明確にしてください。
        </p>

        {charterFilledCount(issue.charter) < 3 && (
          <div className={styles.charterWarnBanner}>
            ⚠️ Why/What/Howが{charterFilledCount(issue.charter)}/3しか整理されていません。点線の欄が「まだ分かっていないこと」です。計画や実行を進める前に明確にすることを推奨します。
          </div>
        )}

        <div className={styles.charterField}>
          <label>Why（生む価値・誰のため・なぜ今か）</label>
          <textarea
            ref={whyRef}
            rows={2}
            defaultValue={issue.charter.why}
            className={issue.charter.why ? "" : styles.charterEmpty}
            placeholder="未整理（クリックして記入）"
          />
        </div>
        <div className={styles.charterField}>
          <label>What（何を・どこまで・どのくらい・完了の定義）</label>
          <textarea
            ref={whatRef}
            rows={2}
            defaultValue={issue.charter.what}
            className={issue.charter.what ? "" : styles.charterEmpty}
            placeholder="未整理（クリックして記入）"
          />
        </div>
        <div className={styles.charterField}>
          <label>How（どのように実現するか・前提や制約）</label>
          <textarea
            ref={howRef}
            rows={2}
            defaultValue={issue.charter.how}
            className={issue.charter.how ? "" : styles.charterEmpty}
            placeholder="未整理（クリックして記入）"
          />
        </div>
        {charterError && <p className={styles.errorText}>{charterError}</p>}
        <button className={styles.primaryBtn} style={{ width: "auto" }} disabled={charterSaving} onClick={handleSaveCharter}>
          {charterSaving ? "保存中…" : "Why/What/Howを保存"}
        </button>
      </div>

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
