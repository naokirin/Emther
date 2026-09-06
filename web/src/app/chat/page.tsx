"use client";

import { useState } from "react";
import styles from "@/app/page.module.css";
import { CopilotChat, ExecutionState, StatusBadge, type AgentRun } from "@/components/RunDetail";
import { useIssues, useRuns, useSettingsRules } from "@/lib/hooks";
import { isRunStale } from "@/lib/types";

// docs/memo.md TODO「これまでに収集された事実等をベースにIssue等と関係なく横断的な相談、
// 質問ができるチャットを用意する」への対応。特定のIssueに紐付けないLead Agentのrunを
// この画面専用の「相談」として扱う（Issue化されていないLead Agent runがそれに相当する）。
// 新規のデータモデル・APIは増やさず、既存のAgent Runtime（startRun/decideRun）と
// 既存のExecutionState/CopilotChat UIをそのまま流用する。

export default function ChatPage() {
  const { runs, refreshRuns } = useRuns();
  const { issues } = useIssues();
  const { rules } = useSettingsRules();
  const staleRunIds = new Set(
    runs.filter((r) => isRunStale(r.status, r.updatedAt, rules.agentStaleAfterSeconds)).map((r) => r.id),
  );

  // Issueに紐付いていないLead Agent runだけを「相談履歴」として扱う。
  const chatRuns = runs
    .filter((r) => r.agentName === "Lead Agent" && !issues.some((i) => i.agentRunId === r.id))
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedRun: AgentRun | null = selectedId ? chatRuns.find((r) => r.id === selectedId) ?? null : null;

  const [task, setTask] = useState("");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [deciding, setDeciding] = useState(false);
  const [decideError, setDecideError] = useState<string | null>(null);

  async function handleStartNew(e: React.FormEvent) {
    e.preventDefault();
    if (!task.trim()) return;
    setStarting(true);
    setStartError(null);
    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentName: "Lead Agent", task }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "開始に失敗しました");
      setTask("");
      setSelectedId(data.run.id);
      await refreshRuns();
    } catch (err) {
      setStartError((err as Error).message);
    } finally {
      setStarting(false);
    }
  }

  async function sendDecision(text: string) {
    if (!selectedRun || !text.trim()) return;
    setDeciding(true);
    setDecideError(null);
    try {
      const res = await fetch(`/api/agents/${selectedRun.id}/decide`, {
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
    if (!selectedRun || !selectedOptionId) return;
    const opt = selectedRun.yieldRequest?.options.find((o) => o.id === selectedOptionId);
    if (!opt) return;
    sendDecision(`Option ${opt.id}（${opt.label}）を採用します。この方針で進めてください。`);
  }

  function handleFocusChat() {
    document.getElementById("chat-page-input")?.focus();
  }

  return (
    <div className={`${styles.layout} ${styles.screen}`}>
      <div className={styles.panel}>
        <h2>相談履歴</h2>
        <p className={styles.subtitle}>Issueに起票していない、Lead Agentとの横断的な相談だけがここに並びます。</p>
        <button
          className={styles.primaryBtn}
          onClick={() => {
            setSelectedId(null);
            setStartError(null);
          }}
        >
          ＋ 新しい相談を始める
        </button>
        <div className={styles.runList}>
          {chatRuns.length === 0 && <p className={styles.subtitle}>まだ相談履歴はありません。</p>}
          {chatRuns.map((r) => (
            <button
              key={r.id}
              className={`${styles.runItem} ${selectedId === r.id ? styles.selected : ""}`}
              onClick={() => setSelectedId(r.id)}
            >
              <div style={{ marginBottom: 4 }}>
                <StatusBadge status={r.status} stale={staleRunIds.has(r.id)} />
              </div>
              <div>{r.task.slice(0, 50)}</div>
            </button>
          ))}
        </div>
      </div>

      <div className={styles.panel}>
        {selectedRun ? (
          <>
            <h2>Lead Agentへの相談</h2>
            <ExecutionState
              run={selectedRun}
              selectedOptionId={selectedOptionId}
              onSelectOption={setSelectedOptionId}
              onConfirmOption={handleConfirmOption}
              onFocusChat={handleFocusChat}
              deciding={deciding}
              stale={staleRunIds.has(selectedRun.id)}
              onRetry={() => sendDecision("直前の処理がエラーで中断しました。同じ内容を踏まえて再度実行してください。")}
            />
            <hr style={{ margin: "14px 0", border: "none", borderTop: "1px solid var(--border)" }} />
            <CopilotChat run={selectedRun} message={message} setMessage={setMessage} deciding={deciding} onDecide={sendDecision} inputId="chat-page-input" />
            {decideError && <p className={styles.errorText}>{decideError}</p>}
          </>
        ) : (
          <>
            <h2>何でも相談</h2>
            <p className={styles.subtitle}>
              特定のIssueに紐付けず、これまで収集されたJournal・組織情報を踏まえてLead Agentに相談できます。会話の途中でIssue化したい場合は、Issue一覧から個別に紐づけてください。
            </p>
            <form onSubmit={handleStartNew}>
              <div className={styles.field}>
                <label>相談したいこと</label>
                <textarea
                  value={task}
                  onChange={(e) => setTask(e.target.value)}
                  rows={3}
                  placeholder="例: 最近チーム全体の元気度が心配。何を確認すればいい？"
                />
              </div>
              <button className={styles.primaryBtn} type="submit" disabled={starting || !task.trim()}>
                {starting ? "開始中…" : "相談を始める"}
              </button>
            </form>
            {startError && <p className={styles.errorText}>{startError}</p>}
          </>
        )}
      </div>
    </div>
  );
}
