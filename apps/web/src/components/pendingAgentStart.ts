import type { PendingAgentStart } from "@emther/core/types";

function secondsUntil(firesAt: number, now: number): number {
  return Math.max(0, Math.ceil((firesAt - now) / 1000));
}

export function formatPendingAgentStartText(pending: PendingAgentStart, now = Date.now()): string {
  const secs = secondsUntil(pending.firesAt, now);
  const title = pending.suggestionTitle ? `「${pending.suggestionTitle}」` : "";
  return `あと${secs}秒で${pending.label}${title ? `（${title}）` : ""}`;
}
