"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./page.module.css";

type AgentStatus = "active" | "yield" | "idle" | "error";

type YieldOption = {
  id: string;
  label: string;
  detail?: string;
  risk?: string;
};

type LogLine = {
  ts: number;
  channel: "meta" | "agent" | "system";
  text: string;
};

type AgentRun = {
  id: string;
  agentName: string;
  task: string;
  status: AgentStatus;
  sessionId?: string;
  log: LogLine[];
  yieldRequest?: { reason: string; options: YieldOption[] };
  totalCostUsd: number;
  createdAt: number;
  updatedAt: number;
};

type JournalEntry = {
  id: string;
  rawText: string;
  tags: string[];
  people: string[];
  urgency: "low" | "mid" | "high";
  sentiment: "positive" | "negative" | "neutral";
  summary: string;
  createdAt: number;
};

const AGENT_OPTIONS = ["Lead Agent", "People Agent", "Process Agent", "Tech Agent"];

const URGENCY_LABEL: Record<JournalEntry["urgency"], string> = {
  low: "Urgency: Low",
  mid: "Urgency: Mid",
  high: "Urgency: High",
};

const STATUS_META: Record<AgentStatus, { icon: string; label: string; cls: string }> = {
  active: { icon: "🟢", label: "Active", cls: styles.active },
  yield: { icon: "🟡", label: "Yield / Waiting", cls: styles.yield },
  idle: { icon: "⚪️", label: "Idle（完了・待機中）", cls: styles.idle },
  error: { icon: "🔴", label: "Error", cls: styles.error },
};

function StatusBadge({ status }: { status: AgentStatus }) {
  const meta = STATUS_META[status];
  return (
    <span className={`${styles.badge} ${meta.cls}`}>
      {meta.icon} {meta.label}
    </span>
  );
}

function logLineClass(line: LogLine): string {
  if (line.channel === "meta") return styles.meta;
  if (line.channel === "agent") return styles.agent;
  if (line.text.startsWith("[YIELD]")) return styles.systemYield;
  if (line.text.includes("エラー")) return styles.systemWarn;
  return styles.system;
}

export default function Home() {
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [agentName, setAgentName] = useState(AGENT_OPTIONS[0]);
  const [task, setTask] = useState("");
  const [message, setMessage] = useState("");
  const [starting, setStarting] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const terminalRef = useRef<HTMLDivElement | null>(null);

  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  const [journalText, setJournalText] = useState("");
  const [journalSubmitting, setJournalSubmitting] = useState(false);
  const [journalError, setJournalError] = useState<string | null>(null);

  const selectedRun = runs.find((r) => r.id === selectedId) ?? null;

  const refreshRuns = useCallback(async () => {
    try {
      const res = await fetch("/api/agents");
      const data = await res.json();
      setRuns(data.runs ?? []);
    } catch {
      // ポーリング失敗は静かに無視し、次回のポーリングに任せる
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch("/api/agents");
        const data = await res.json();
        if (!cancelled) setRuns(data.runs ?? []);
      } catch {
        // ポーリング失敗は静かに無視し、次回のポーリングに任せる
      }
    }

    const interval = setInterval(poll, 1500);
    void poll();
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [selectedRun?.log.length]);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch("/api/journal");
        const data = await res.json();
        if (!cancelled) setJournalEntries(data.entries ?? []);
      } catch {
        // ポーリング失敗は静かに無視し、次回のポーリングに任せる
      }
    }

    const interval = setInterval(poll, 5000);
    void poll();
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  async function handleJournalSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!journalText.trim()) return;
    setJournalSubmitting(true);
    setJournalError(null);
    try {
      const res = await fetch("/api/journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: journalText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "タグ付けに失敗しました");
      setJournalEntries((prev) => [data.entry, ...prev]);
      setJournalText("");
    } catch (err) {
      setJournalError((err as Error).message);
    } finally {
      setJournalSubmitting(false);
    }
  }

  async function handleStart(e: React.FormEvent) {
    e.preventDefault();
    if (!task.trim()) return;
    setStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentName, task }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "起動に失敗しました");
      setTask("");
      setSelectedId(data.run.id);
      await refreshRuns();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setStarting(false);
    }
  }

  async function sendDecision(text: string) {
    if (!selectedRun || !text.trim()) return;
    setDeciding(true);
    setError(null);
    try {
      const res = await fetch(`/api/agents/${selectedRun.id}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "送信に失敗しました");
      setMessage("");
      await refreshRuns();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeciding(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>EM Support System — Agent Runtime</h1>
        <p className={styles.subtitle}>
          claude CLIサブプロセスでエージェントを実行し、Yield（一時停止）が発生したら人間の判断を仰いでから再開する最小構成。
        </p>
      </div>

      <div className={styles.panel} style={{ marginBottom: 16 }}>
        <h2>Quick Journal（雑多なメモの自動タグ付け）</h2>
        <form onSubmit={handleJournalSubmit}>
          <div className={styles.journalInputRow}>
            <input
              type="text"
              value={journalText}
              onChange={(e) => setJournalText(e.target.value)}
              placeholder="例: 今日のAさんとの1on1で、リファクタリングが進まないことへの不満を聞いた…"
            />
            <button className={styles.primaryBtn} style={{ width: "auto" }} type="submit" disabled={journalSubmitting || !journalText.trim()}>
              {journalSubmitting ? "タグ付け中…" : "Submit"}
            </button>
          </div>
        </form>
        <p className={styles.subtitle} style={{ margin: "6px 0 12px" }}>
          ※入力後、軽量モデル（{"claude-haiku-4-5"}）が自動でタグ・人物・緊急度・感情を抽出します。
        </p>
        {journalError && <p className={styles.errorText}>{journalError}</p>}

        {journalEntries.length === 0 && !journalSubmitting && (
          <p className={styles.subtitle}>まだジャーナルはありません。</p>
        )}
        {journalEntries.map((entry) => (
          <div key={entry.id} className={styles.journalEntry}>
            <div>{entry.rawText}</div>
            <div className={styles.tagRow}>
              {entry.people.map((p) => (
                <span key={p} className={`${styles.tag} ${styles.tagPerson}`}>
                  @{p}
                </span>
              ))}
              {entry.tags.map((t) => (
                <span key={t} className={`${styles.tag} ${styles.tagTopic}`}>
                  #{t}
                </span>
              ))}
              {entry.sentiment !== "neutral" && (
                <span className={`${styles.tag} ${entry.sentiment === "positive" ? styles.tagPos : styles.tagNeg}`}>
                  #{entry.sentiment === "positive" ? "ポジティブ" : "ネガティブ"}
                </span>
              )}
              <span className={`${styles.urgencyLabel} ${styles[`urgency${entry.urgency}`]}`}>
                {URGENCY_LABEL[entry.urgency]}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className={styles.layout}>
        <div>
          <div className={styles.panel}>
            <h2>タスクを起票</h2>
            <form onSubmit={handleStart}>
              <div className={styles.field}>
                <label>エージェント</label>
                <select value={agentName} onChange={(e) => setAgentName(e.target.value)}>
                  {AGENT_OPTIONS.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
              <div className={styles.field}>
                <label>タスク内容</label>
                <textarea
                  rows={4}
                  value={task}
                  onChange={(e) => setTask(e.target.value)}
                  placeholder="例: Aさんのリファクタリングが停滞している。Bチームの割り込みタスクが原因らしい。対応方針を検討して。"
                />
              </div>
              <button className={styles.primaryBtn} type="submit" disabled={starting || !task.trim()}>
                {starting ? "起動中…" : "エージェントを起動"}
              </button>
            </form>
            {error && <p className={styles.errorText}>{error}</p>}
          </div>

          <div className={styles.runList}>
            {runs.length === 0 && <p className={styles.subtitle}>実行中のエージェントはまだありません。</p>}
            {runs.map((run) => (
              <button
                key={run.id}
                className={`${styles.runItem} ${run.id === selectedId ? styles.selected : ""}`}
                onClick={() => setSelectedId(run.id)}
              >
                <div>
                  <strong>{run.agentName}</strong> <StatusBadge status={run.status} />
                </div>
                <div className={styles.runItemTask}>{run.task}</div>
              </button>
            ))}
          </div>
        </div>

        <div className={styles.panel}>
          {!selectedRun && <p className={styles.emptyState}>左でタスクを起票するか、実行中のエージェントを選択してください。</p>}

          {selectedRun && (
            <>
              <div className={styles.detailHeader}>
                <div>
                  <h2 style={{ marginBottom: 4 }}>{selectedRun.agentName}</h2>
                  <div className={styles.detailTask}>{selectedRun.task}</div>
                </div>
                <StatusBadge status={selectedRun.status} />
              </div>

              <div className={styles.terminal} ref={terminalRef}>
                {selectedRun.log.map((line, i) => (
                  <div key={i} className={`${styles.logLine} ${logLineClass(line)}`}>
                    {line.channel === "agent" ? (
                      <>
                        <span className={styles.agentPrefix}>[{selectedRun.agentName}] </span>
                        {line.text}
                      </>
                    ) : (
                      line.text
                    )}
                  </div>
                ))}
                {selectedRun.status === "active" && <div className={styles.logLine}>{">_ …"}</div>}
              </div>

              {selectedRun.status === "yield" && selectedRun.yieldRequest && (
                <div className={styles.yieldBlock}>
                  <strong>⚠️ AI Yield: 判断をお願いします</strong>
                  <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>
                    {selectedRun.yieldRequest.reason}
                  </p>

                  {selectedRun.yieldRequest.options.map((opt) => (
                    <div className={styles.option} key={opt.id}>
                      <strong>
                        Option {opt.id}: {opt.label}
                      </strong>
                      {opt.detail && <div>{opt.detail}</div>}
                      {opt.risk && <div className="risk" style={{ color: "var(--text-muted)", fontSize: 11 }}>※Risk: {opt.risk}</div>}
                      <br />
                      <button
                        className={styles.optionBtn}
                        disabled={deciding}
                        onClick={() => sendDecision(`Option ${opt.id}（${opt.label}）を採用します。この方針で進めてください。`)}
                      >
                        このOptionを選択してStateを更新
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {selectedRun.status !== "active" && (
                <div className={styles.chatRow}>
                  <input
                    type="text"
                    placeholder={
                      selectedRun.status === "yield" ? "別の案をチャットで壁打ち…" : "追加で相談する…"
                    }
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") sendDecision(message);
                    }}
                  />
                  <button className={styles.primaryBtn} style={{ width: "auto" }} disabled={deciding || !message.trim()} onClick={() => sendDecision(message)}>
                    Send
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
