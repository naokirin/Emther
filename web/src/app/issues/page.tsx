"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "@/app/page.module.css";
import { StatusBadge, type AgentRun } from "@/components/RunDetail";
import { Modal } from "@/components/Modal";
import { useIssues, useRuns } from "@/lib/hooks";
import { charterFilledCount } from "@/lib/types";

// Issue一覧画面。起票は一般的なIssue管理サービスと同様、一覧上の「＋ 新しいIssue」ボタンから
// ダイアログを開いて行う（画面遷移しない）。Issueを選ぶと/issues/[id]の詳細画面に遷移する。
export default function IssuesPage() {
  const router = useRouter();
  const { issues, refreshIssues } = useIssues();
  const { runs, refreshRuns } = useRuns();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [issueTitle, setIssueTitle] = useState("");
  const [issueRunId, setIssueRunId] = useState("");
  const [issueWhy, setIssueWhy] = useState("");
  const [issueWhat, setIssueWhat] = useState("");
  const [issueHow, setIssueHow] = useState("");
  const [issueSubmitting, setIssueSubmitting] = useState(false);
  const [issueError, setIssueError] = useState<string | null>(null);

  const unlinkedRuns = runs.filter((r) => !issues.some((i) => i.agentRunId === r.id));

  async function handleCreateIssue(e: React.FormEvent) {
    e.preventDefault();
    if (!issueTitle.trim()) return;
    setIssueSubmitting(true);
    setIssueError(null);
    try {
      const res = await fetch("/api/issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: issueTitle,
          agentRunId: issueRunId || undefined,
          why: issueWhy,
          what: issueWhat,
          how: issueHow,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Issueの起票に失敗しました");
      setIssueTitle("");
      setIssueRunId("");
      setIssueWhy("");
      setIssueWhat("");
      setIssueHow("");
      setDialogOpen(false);
      router.push(`/issues/${data.issue.id}`);
    } catch (err) {
      setIssueError((err as Error).message);
    } finally {
      setIssueSubmitting(false);
    }
  }

  async function handlePromoteRun(run: AgentRun) {
    try {
      const res = await fetch("/api/issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: run.task.slice(0, 60), agentRunId: run.id }),
      });
      const data = await res.json();
      if (res.ok) {
        await Promise.all([refreshIssues(), refreshRuns()]);
        router.push(`/issues/${data.issue.id}`);
      }
    } catch {
      // 失敗時は一覧に留まる
    }
  }

  return (
    <div className={styles.screen}>
      <div className={styles.detailHeader}>
        <h2 style={{ margin: 0 }}>Issues</h2>
        <button className={styles.primaryBtn} style={{ width: "auto" }} onClick={() => setDialogOpen(true)}>
          ＋ 新しいIssue
        </button>
      </div>

      <div className={styles.runList} style={{ maxHeight: "none" }}>
        {issues.length === 0 && <p className={styles.subtitle}>Issueはまだありません。</p>}
        {issues.map((issue) => {
          const linkedRun = runs.find((r) => r.id === issue.agentRunId);
          const doneCount = issue.actionItems.filter((a) => a.done).length;
          const charterCount = charterFilledCount(issue.charter);
          return (
            <button key={issue.id} className={styles.runItem} onClick={() => router.push(`/issues/${issue.id}`)}>
              <div>
                <strong>{issue.title}</strong> {linkedRun && <StatusBadge status={linkedRun.status} />}
                <span className={charterCount === 3 ? styles.charterBadgeReady : styles.charterBadgeWarn} style={{ marginLeft: 6 }}>
                  {charterCount === 3 ? "✅" : "❓"} Why/What/How: {charterCount}/3
                </span>
              </div>
              <div className={styles.runItemTask}>
                Action Items: {doneCount}/{issue.actionItems.length}
              </div>
            </button>
          );
        })}
      </div>

      <h3 style={{ fontSize: 12, color: "var(--text-muted)", margin: "20px 0 6px" }}>Issue未起票のAgent Run</h3>
      <p className={styles.subtitle} style={{ marginBottom: 10 }}>
        ワイヤーフレームには無い一覧だが、複数のRunを実運用で捌くために追加している。クリックするとその場でIssue化して詳細画面へ移動する。
      </p>
      <div className={styles.runList} style={{ maxHeight: "none" }}>
        {unlinkedRuns.length === 0 && <p className={styles.subtitle}>すべてのRunがIssueに紐づいています。</p>}
        {unlinkedRuns.map((run) => (
          <button key={run.id} className={styles.runItem} onClick={() => handlePromoteRun(run)}>
            <div>
              <strong>{run.agentName}</strong> <StatusBadge status={run.status} />
              {run.consultedBy && (
                <span className={styles.subtitle} style={{ marginLeft: 6 }}>
                  🔀 {runs.find((r) => r.id === run.consultedBy)?.agentName ?? "Lead Agent"}からの相談
                </span>
              )}
            </div>
            <div className={styles.runItemTask}>{run.task}</div>
          </button>
        ))}
      </div>

      {dialogOpen && (
        <Modal title="新しいIssueを起票" onClose={() => setDialogOpen(false)}>
          <form onSubmit={handleCreateIssue}>
            <div className={styles.field}>
              <label>タイトル</label>
              <input
                type="text"
                autoFocus
                value={issueTitle}
                onChange={(e) => setIssueTitle(e.target.value)}
                placeholder="例: Aさんのリファクタリング停滞"
              />
            </div>
            <div className={styles.field}>
              <label>関連づけるAgent Run（任意）</label>
              <select value={issueRunId} onChange={(e) => setIssueRunId(e.target.value)}>
                <option value="">なし</option>
                {runs.map((r) => (
                  <option key={r.id} value={r.id}>
                    [{r.agentName}] {r.task.slice(0, 30)}
                  </option>
                ))}
              </select>
            </div>

            <p className={styles.subtitle} style={{ margin: "8px 0" }}>
              Why/What/Howは分かっている範囲でOK。分からなければ空欄のまま起票し、詳細画面で明らかにしてから計画・実行してください。
            </p>
            <div className={styles.field}>
              <label>Why（このIssueが生む価値・誰のためか・なぜ今か）</label>
              <textarea rows={2} value={issueWhy} onChange={(e) => setIssueWhy(e.target.value)} placeholder="例: Aさんの離脱リスクを下げ、決済基盤の開発速度を維持するため。今対応しないと来期のリリースに響く。" />
            </div>
            <div className={styles.field}>
              <label>What（何を・どこまで・どのくらい・完了の定義）</label>
              <textarea rows={2} value={issueWhat} onChange={(e) => setIssueWhat(e.target.value)} placeholder="例: Bチームからの割り込みタスクを整理し、Aさんが週3日以上リファクタリングに専念できる状態にする。完了条件: ○○。" />
            </div>
            <div className={styles.field}>
              <label>How（どのように実現するか・前提や制約）</label>
              <textarea rows={2} value={issueHow} onChange={(e) => setIssueHow(e.target.value)} placeholder="例: 割り込みタスクの受け入れ基準を定めてBチームと合意する。予算・人員の追加は無い前提。" />
            </div>

            {issueError && <p className={styles.errorText}>{issueError}</p>}
            <button className={styles.primaryBtn} type="submit" disabled={issueSubmitting || !issueTitle.trim()}>
              Issueを起票
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
