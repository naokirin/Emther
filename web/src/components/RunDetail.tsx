"use client";

import { useEffect, useRef } from "react";
import styles from "@/app/page.module.css";

export type AgentStatus = "active" | "yield" | "idle" | "error";

export type YieldOption = {
  id: string;
  label: string;
  detail?: string;
  risk?: string;
};

export type LogLine = {
  ts: number;
  channel: "meta" | "agent" | "system";
  text: string;
};

export type RejectedAlternative = {
  option: string;
  reason: string;
};

export type Proposal = {
  conclusion: string;
  facts: string[];
  logic: string;
  rejectedAlternatives: RejectedAlternative[];
};

export type AgentRun = {
  id: string;
  agentName: string;
  task: string;
  status: AgentStatus;
  sessionId?: string;
  log: LogLine[];
  yieldRequest?: { reason: string; options: YieldOption[] };
  proposal?: Proposal;
  totalCostUsd: number;
  createdAt: number;
  updatedAt: number;
};

export const STATUS_META: Record<AgentStatus, { icon: string; label: string; cls: string }> = {
  active: { icon: "🟢", label: "Active", cls: styles.active },
  yield: { icon: "🟡", label: "Yield / Waiting", cls: styles.yield },
  idle: { icon: "⚪️", label: "Idle（完了・待機中）", cls: styles.idle },
  error: { icon: "🔴", label: "Error", cls: styles.error },
};

export function StatusBadge({ status }: { status: AgentStatus }) {
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

// Agent Runtimeの詳細表示（Activity Stream + Yield選択 + チャット）。
// Issue Workspace（Issueに紐づいたrunの表示）とAgent Runtimeパネルの両方から共用する。
export function RunDetail({
  run,
  message,
  setMessage,
  deciding,
  onDecide,
}: {
  run: AgentRun;
  message: string;
  setMessage: (value: string) => void;
  deciding: boolean;
  onDecide: (text: string) => void;
}) {
  const terminalRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [run.log.length]);

  return (
    <>
      <div className={styles.detailHeader}>
        <div>
          <h2 style={{ marginBottom: 4 }}>{run.agentName}</h2>
          <div className={styles.detailTask}>{run.task}</div>
        </div>
        <StatusBadge status={run.status} />
      </div>

      <div className={styles.terminal} ref={terminalRef}>
        {run.log.map((line, i) => (
          <div key={i} className={`${styles.logLine} ${logLineClass(line)}`}>
            {line.channel === "agent" ? (
              <>
                <span className={styles.agentPrefix}>[{run.agentName}] </span>
                {line.text}
              </>
            ) : (
              line.text
            )}
          </div>
        ))}
        {run.status === "active" && <div className={styles.logLine}>{">_ …"}</div>}
      </div>

      {run.status === "yield" && run.yieldRequest && (
        <div className={styles.yieldBlock}>
          <strong>⚠️ AI Yield: 判断をお願いします</strong>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>{run.yieldRequest.reason}</p>

          {run.yieldRequest.options.map((opt) => (
            <div className={styles.option} key={opt.id}>
              <strong>
                Option {opt.id}: {opt.label}
              </strong>
              {opt.detail && <div>{opt.detail}</div>}
              {opt.risk && <div style={{ color: "var(--text-muted)", fontSize: 11 }}>※Risk: {opt.risk}</div>}
              <br />
              <button
                className={styles.optionBtn}
                disabled={deciding}
                onClick={() => onDecide(`Option ${opt.id}（${opt.label}）を採用します。この方針で進めてください。`)}
              >
                このOptionを選択してStateを更新
              </button>
            </div>
          ))}
        </div>
      )}

      {run.status === "idle" && run.proposal && (
        <div className={styles.proposalBlock}>
          <strong>✅ 結論</strong>
          <p style={{ fontSize: 13, marginTop: 4 }}>{run.proposal.conclusion}</p>

          {run.proposal.facts.length > 0 && (
            <>
              <strong style={{ fontSize: 12 }}>参照ファクト</strong>
              <ul style={{ margin: "4px 0 8px 18px", fontSize: 12 }}>
                {run.proposal.facts.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </>
          )}

          <strong style={{ fontSize: 12 }}>判断ロジック</strong>
          <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "4px 0 8px" }}>{run.proposal.logic}</p>

          {run.proposal.rejectedAlternatives.length > 0 && (
            <>
              <strong style={{ fontSize: 12 }}>棄却した代替案</strong>
              {run.proposal.rejectedAlternatives.map((r, i) => (
                <div key={i} style={{ fontSize: 12, marginTop: 4 }}>
                  <strong>{r.option}</strong>
                  <span style={{ color: "var(--text-muted)" }}> — {r.reason}</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {run.status !== "active" && (
        <div className={styles.chatRow}>
          <input
            type="text"
            placeholder={run.status === "yield" ? "別の案をチャットで壁打ち…" : "追加で相談する…"}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onDecide(message);
            }}
          />
          <button
            className={styles.primaryBtn}
            style={{ width: "auto" }}
            disabled={deciding || !message.trim()}
            onClick={() => onDecide(message)}
          >
            Send
          </button>
        </div>
      )}
    </>
  );
}
