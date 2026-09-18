"use client";

import { useState } from "react";
import styles from "@/app/page.module.css";
import type { AgentRun } from "@/components/RunDetail";

export interface AgentActivityItem {
  id: string;
  ts: number;
  timeLabel: string;
  agentLabel: string;
  icon: string;
  text: string;
  runId: string;
}

export function formatActivityTime(ts: number, now = Date.now()): string {
  const d = new Date(ts);
  const n = new Date(now);
  const isSameDay =
    d.getFullYear() === n.getFullYear() &&
    d.getMonth() === n.getMonth() &&
    d.getDate() === n.getDate();

  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");

  if (isSameDay) {
    return `${hh}:${mi}`;
  }
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd} ${hh}:${mi}`;
}

export function extractRecentActivities(runs: AgentRun[], limit = 3, now = Date.now()): AgentActivityItem[] {
  const items: AgentActivityItem[] = [];

  for (const run of runs) {
    const agentLabel = run.agentName.replace(/ Agent$/, "");
    if (run.log && run.log.length > 0) {
      for (let i = 0; i < run.log.length; i++) {
        const line = run.log[i];
        const icon = line.text.startsWith("[YIELD]")
          ? "🟡"
          : line.channel === "system"
            ? "⚙️"
            : line.channel === "meta"
              ? "📝"
              : "💬";
        items.push({
          id: `${run.id}-${i}`,
          ts: line.ts,
          timeLabel: formatActivityTime(line.ts, now),
          agentLabel,
          icon,
          text: line.text.replace(/\s+/g, " ").slice(0, 75),
          runId: run.id,
        });
      }
    } else if (run.updatedAt) {
      items.push({
        id: run.id,
        ts: run.updatedAt,
        timeLabel: formatActivityTime(run.updatedAt, now),
        agentLabel,
        icon: "🤖",
        text: run.task.replace(/\s+/g, " ").slice(0, 75),
        runId: run.id,
      });
    }
  }

  return items.sort((a, b) => b.ts - a.ts).slice(0, limit);
}

type Props = {
  runs: AgentRun[];
  runsLoaded: boolean;
  autoRunsToday: number;
  onNavigate: (path: string) => void;
  now?: number;
};

export function AgentStatusSection({
  runs,
  runsLoaded,
  autoRunsToday,
  onNavigate,
  now = Date.now(),
}: Props) {
  const [collapsed, setCollapsed] = useState(false);

  if (!runsLoaded) {
    return (
      <div
        style={{
          margin: "8px 0 12px",
          padding: "8px 12px",
          borderRadius: 6,
          background: "var(--bg-subtle, rgba(0,0,0,0.02))",
          border: "1px solid var(--border)",
          fontSize: "0.8125rem",
          color: "var(--text-muted)",
        }}
      >
        🤖 エージェント状態: 読み込み中…
      </div>
    );
  }

  const activeRuns = runs.filter((r) => r.status === "active" || r.status === "queued");
  const activeCount = activeRuns.length;
  const recentActivities = extractRecentActivities(runs, 3, now);
  const latestActivity = recentActivities[0];

  return (
    <div
      style={{
        margin: "8px 0 14px",
        padding: "10px 14px",
        borderRadius: 8,
        background: "var(--bg-subtle, rgba(0,0,0,0.02))",
        border: "1px solid var(--border)",
      }}
      data-testid="agent-status-section"
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: "0.875rem" }}>
          <span style={{ fontWeight: 600 }}>🤖 エージェント稼働状態:</span>
          {activeCount > 0 ? (
            <span style={{ color: "var(--blue-fg, #2563eb)", fontWeight: 600 }}>
              🔵 {activeCount}件実行中
            </span>
          ) : (
            <span style={{ color: "var(--green-fg, #16a34a)", fontWeight: 600 }}>
              🟢 待機中（正常稼働）
            </span>
          )}
          {latestActivity && (
            <span style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>
              （最終巡回: {latestActivity.timeLabel}）
            </span>
          )}
          {autoRunsToday > 0 && (
            <span style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>
              · 本日自動起動: {autoRunsToday}件
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {recentActivities.length > 0 && (
            <button
              type="button"
              className={styles.detailToggle}
              onClick={() => setCollapsed(!collapsed)}
              style={{ fontSize: "0.75rem", padding: "2px 6px" }}
            >
              {collapsed ? "動きを表示" : "折りたたむ"}
            </button>
          )}
          <button
            type="button"
            className={styles.detailToggle}
            onClick={() => onNavigate("/agents")}
            style={{ fontSize: "0.75rem", padding: "2px 6px" }}
          >
            エージェント一覧・全ログ →
          </button>
        </div>
      </div>

      {!collapsed && (
        <div style={{ marginTop: 8, borderTop: "1px dashed var(--border)", paddingTop: 6 }}>
          {recentActivities.length === 0 ? (
            <div style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>
              まだ直近の自律的な動きはありません。
            </div>
          ) : (
            <div>
              <div
                style={{
                  fontSize: "0.75rem",
                  color: "var(--text-muted)",
                  marginBottom: 4,
                  fontWeight: 600,
                }}
              >
                直近の自律的な動き:
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {recentActivities.map((act) => (
                  <div
                    key={act.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: "0.8125rem",
                      cursor: "pointer",
                      padding: "2px 4px",
                      borderRadius: 4,
                    }}
                    className={styles.activityLine}
                    onClick={() => onNavigate(`/chat?runId=${act.runId}`)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onNavigate(`/chat?runId=${act.runId}`);
                      }
                    }}
                  >
                    <span
                      style={{
                        color: "var(--text-muted)",
                        fontSize: "0.75rem",
                        fontFamily: "var(--font-mono)",
                        flexShrink: 0,
                      }}
                    >
                      {act.timeLabel}
                    </span>
                    <span
                      className={styles.badge}
                      style={{ fontSize: "0.6875rem", padding: "1px 5px", flexShrink: 0 }}
                    >
                      {act.agentLabel}
                    </span>
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        flex: 1,
                      }}
                    >
                      {act.icon} {act.text}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
