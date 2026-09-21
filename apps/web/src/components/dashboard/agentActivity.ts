import type { AgentRun } from "../RunDetail";

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
