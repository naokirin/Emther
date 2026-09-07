"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import styles from "@/app/page.module.css";
import { CopilotChat, ExecutionState, StatusBadge, type AgentRun } from "@/components/RunDetail";
import { useIssues, useRuns, useSettingsRules } from "@/lib/hooks";
import { isRunStale } from "@/lib/types";

const ORIGIN_LABEL: Record<AgentRun["origin"], string> = {
  manual: "",
  "auto-anomaly": "異常検知",
  "auto-summary": "朝のサマリー",
};

const TRIAGE_LABEL: Record<"watching" | "dismissed", string> = {
  watching: "👀 様子見",
  dismissed: "却下",
};

// docs/memo.md TODO「これまでに収集された事実等をベースにIssue等と関係なく横断的な相談、
// 質問ができるチャットを用意する」への対応。特定のIssueに紐付けないLead Agentのrunを
// この画面専用の「相談」として扱う（Issue化されていないLead Agent runがそれに相当する）。
// 新規のデータモデル・APIは増やさず、既存のAgent Runtime（startRun/decideRun）と
// 既存のExecutionState/CopilotChat UIをそのまま流用する。

export default function ChatPage() {
  return (
    <Suspense fallback={null}>
      <ChatPageInner />
    </Suspense>
  );
}

function ChatPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { runs, refreshRuns } = useRuns();
  const { issues, refreshIssues } = useIssues();
  const { rules } = useSettingsRules();
  const staleRunIds = new Set(
    runs.filter((r) => isRunStale(r.status, r.updatedAt, rules.agentStaleAfterSeconds)).map((r) => r.id),
  );

  // Issueに紐付いていないLead Agent runだけを「相談履歴」として扱う。
  const chatRuns = runs
    .filter((r) => r.agentName === "Lead Agent" && !issues.some((i) => i.agentRunId === r.id))
    .sort((a, b) => b.updatedAt - a.updatedAt);

  // docs/first_implession 3.6/3.7対応。Dashboardの「次にすべきこと」からAI自動起動runへ
  // ?runId=で直接遷移できるようにする（最初のポーリング結果が届いた時点で一度だけ選択する）。
  const [seededFromQuery, setSeededFromQuery] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const queryRunId = searchParams.get("runId");
  if (queryRunId && !seededFromQuery && runs.length > 0) {
    setSeededFromQuery(true);
    setSelectedId(queryRunId);
  }
  const selectedRun: AgentRun | null = selectedId ? chatRuns.find((r) => r.id === selectedId) ?? null : null;

  // docs/memo.md「C. Journalセンシング→行動」対応。Quick Journalの@人物クリックや
  // 「要注目Journal」カードから、相談内容を書いた状態でこの画面を開けるようにする。
  const [task, setTask] = useState(searchParams.get("prefill") ?? "");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [deciding, setDeciding] = useState(false);
  const [decideError, setDecideError] = useState<string | null>(null);

  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  async function handlePromoteToIssue() {
    if (!selectedRun) return;
    setReviewSubmitting(true);
    setReviewError(null);
    try {
      const res = await fetch("/api/issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: selectedRun.task.slice(0, 60), agentRunId: selectedRun.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Issue化に失敗しました");
      await refreshIssues();
      router.push(`/issues/${data.issue.id}`);
    } catch (err) {
      setReviewError((err as Error).message);
    } finally {
      setReviewSubmitting(false);
    }
  }

  async function handleTriage(status: "watching" | "dismissed") {
    if (!selectedRun) return;
    setReviewSubmitting(true);
    setReviewError(null);
    try {
      const res = await fetch(`/api/agents/${selectedRun.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ triageStatus: status }),
      });
      if (!res.ok) throw new Error("記録に失敗しました");
      await refreshRuns();
    } catch (err) {
      setReviewError((err as Error).message);
    } finally {
      setReviewSubmitting(false);
    }
  }

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
                {r.origin !== "manual" && !r.reviewed && <span style={{ marginLeft: 6 }}>🤖 未確認</span>}
                {r.triageStatus && <span style={{ marginLeft: 6 }}>{TRIAGE_LABEL[r.triageStatus]}</span>}
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
            <div className={styles.yieldBlock} style={{ marginBottom: 12 }}>
              {selectedRun.origin !== "manual" && !selectedRun.reviewed && (
                <>
                  <strong>🤖 AIが自動起動したRunです（{ORIGIN_LABEL[selectedRun.origin]}）</strong>
                  <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>
                    内容を確認し、追跡すべきならIssue化、様子を見るなら様子見、不要なら却下してください。EMが選ぶまでここに残り続けます。
                  </p>
                </>
              )}
              {selectedRun.triageStatus && (
                <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  現在のステータス: {TRIAGE_LABEL[selectedRun.triageStatus]}（ボタンでいつでも変更できます）
                </p>
              )}
              <div className={styles.yieldActions}>
                <button className={styles.primaryBtn} style={{ width: "auto" }} disabled={reviewSubmitting} onClick={handlePromoteToIssue}>
                  📌 Issueにする
                </button>
                <button className={styles.btnOutline} disabled={reviewSubmitting} onClick={() => handleTriage("watching")}>
                  👀 様子見
                </button>
                <button className={styles.btnOutline} disabled={reviewSubmitting} onClick={() => handleTriage("dismissed")}>
                  却下する（対応不要）
                </button>
              </div>
              {reviewError && <p className={styles.errorText}>{reviewError}</p>}
            </div>
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
              まだIssueにしないモヤモヤ・仮説検証はここ。特定のIssueに紐付けず、これまで収集されたJournal・組織情報を踏まえてLead Agentに相談できます。追跡・計画が必要になったら会話画面の「Issueにする」で昇格できます。実行中の介入の壁打ちはIssue Workspaceで行ってください。
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
