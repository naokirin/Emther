"use client";

import { useState } from "react";
import styles from "@/app/page.module.css";
import { PageTitleRow } from "@/components/HelpLink";
import type { useNameCandidateConfirm } from "@/lib/useNameCandidateConfirm";

type Props = {
  initialTask: string;
  queryJournalId: string | null;
  fetchWithNameConfirm: ReturnType<typeof useNameCandidateConfirm>["fetchWithNameConfirm"];
  onStarted: (runId: string) => void;
};

// docs/memo.md「C. Journalセンシング→行動」対応。Quick Journalの@人物クリックや
// 「要注目Journal」カードから、相談内容を書いた状態でこの画面を開けるようにする。
export function NewConsultForm({ initialTask, queryJournalId, fetchWithNameConfirm, onStarted }: Props) {
  const [task, setTask] = useState(initialTask);
  const [requireExecConsult, setRequireExecConsult] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  async function handleStartNew(e: React.FormEvent) {
    e.preventDefault();
    if (!task.trim()) return;
    setStarting(true);
    setStartError(null);
    try {
      const { res, data } = await fetchWithNameConfirm(
        "/api/agents",
        {
          method: "POST",
          body: {
            agentName: "Lead Agent",
            task,
            sourceJournalId: queryJournalId || undefined,
            requireExecConsult: requireExecConsult || undefined,
          },
        },
        "送信する",
      );
      if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? "開始に失敗しました");
      setTask("");
      setRequireExecConsult(false);
      onStarted((data as { run: { id: string } }).run.id);
    } catch (err) {
      if ((err as Error).message !== "人名候補の確認をキャンセルしました") {
        setStartError((err as Error).message);
      }
    } finally {
      setStarting(false);
    }
  }

  return (
    <>
      <PageTitleRow title="何でも相談" helpAnchor="chat" />
      <form onSubmit={handleStartNew}>
        <div className={styles.field}>
          <label>相談したいこと
          <textarea
            value={task}
            onChange={(e) => setTask(e.target.value)}
            rows={3}
            placeholder="例: 最近チーム全体の元気度が心配。何を確認すればいい？"
          /></label>
        </div>
        <label
          style={{
            display: "flex",
            gap: 8,
            alignItems: "flex-start",
            fontSize: "0.8125rem",
            marginBottom: 12,
            cursor: "pointer",
          }}
          title="Leadが組織MVV・中長期コミットの視点でExec Agentへ必須相談します"
        >
          <input
            type="checkbox"
            checked={requireExecConsult}
            onChange={(e) => setRequireExecConsult(e.target.checked)}
            disabled={starting}
            style={{ marginTop: 3 }}
          />
          <span>経営／役員目線の厳しいレビューも聞く</span>
        </label>
        <button className={styles.primaryBtn} type="submit" disabled={starting || !task.trim()}>
          {starting ? "開始中…" : "相談を始める"}
        </button>
      </form>
      {startError && <p className={styles.errorText} role="alert">{startError}</p>}
    </>
  );
}
