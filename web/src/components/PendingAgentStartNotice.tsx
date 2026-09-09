"use client";

import { useEffect, useState } from "react";
import type { PendingAgentStart } from "@/lib/types";

function secondsUntil(firesAt: number, now: number): number {
  return Math.max(0, Math.ceil((firesAt - now) / 1000));
}

/** デバウンス待ちの自動起動予定を、残り秒数つきで表示する。 */
export function PendingAgentStartNotice({
  pending,
}: {
  pending: PendingAgentStart;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const secs = secondsUntil(pending.firesAt, now);

  return (
    <div
      role="status"
      style={{
        marginBottom: 12,
        padding: "10px 12px",
        borderRadius: 6,
        border: "1px solid var(--blue)",
        background: "var(--blue-bg)",
        color: "var(--blue-text)",
        fontSize: "0.8125rem",
        lineHeight: 1.5,
      }}
    >
      <strong>⏳ あと{secs}秒後にエージェントが起動します</strong>
      <div style={{ marginTop: 4 }}>
        {pending.label}
        {pending.detail ? ` · ${pending.detail}` : ""}
        。入力の連打をまとめてから分析するため、少し待ってから起動します。
      </div>
    </div>
  );
}

export function formatPendingAgentStartText(pending: PendingAgentStart, now = Date.now()): string {
  const secs = secondsUntil(pending.firesAt, now);
  const title = pending.issueTitle ? `「${pending.issueTitle}」` : "";
  return `あと${secs}秒で${pending.label}${title ? `（${title}）` : ""}`;
}
