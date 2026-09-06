"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";
import { StatusBadge, type AgentRun, type AgentStatus } from "@/components/RunDetail";
import { useIssues, useJournal, useRuns, useVitals } from "@/lib/hooks";
import { AGENT_OPTIONS, URGENCY_LABEL } from "@/lib/types";

// docs 3.1「Agent Statusシグナル」: エージェント種別ごとに直近のrunの状態を代表値として見せる。
// そのエージェント種別のrunが一つも無い場合は「⚪️ Idle（一度も起動していない）」として扱う。
function computeFleetStatus(agentName: string, runs: AgentRun[]): AgentStatus {
  const relevant = runs.filter((r) => r.agentName === agentName);
  if (relevant.length === 0) return "idle";
  const latest = relevant.reduce((a, b) => (a.updatedAt > b.updatedAt ? a : b));
  return latest.status;
}

export default function DashboardPage() {
  const router = useRouter();
  const { runs, refreshRuns } = useRuns();
  const { issues } = useIssues();
  const { vitals } = useVitals();
  const { journalEntries, setJournalEntries } = useJournal();

  const [agentName, setAgentName] = useState(AGENT_OPTIONS[0]);
  const [task, setTask] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [journalText, setJournalText] = useState("");
  const [journalSubmitting, setJournalSubmitting] = useState(false);
  const [journalError, setJournalError] = useState<string | null>(null);

  const [openVitalId, setOpenVitalId] = useState<string | null>(null);

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
      setJournalEntries([data.entry, ...journalEntries]);
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
      await refreshRuns();
      await goToRunIssue(data.run);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setStarting(false);
    }
  }

  // Inboxのrunをクリックしたら、既にIssue化されていればそのIssueへ、
  // まだならその場でIssue化してから遷移する（Issue Workspaceは「Issueの詳細」を
  // 表示する画面として一本化しているため）。
  async function goToRunIssue(run: AgentRun) {
    const existing = issues.find((i) => i.agentRunId === run.id);
    if (existing) {
      router.push(`/issues/${existing.id}`);
      return;
    }
    try {
      const res = await fetch("/api/issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: run.task.slice(0, 60), agentRunId: run.id }),
      });
      const data = await res.json();
      if (res.ok) router.push(`/issues/${data.issue.id}`);
    } catch {
      // 失敗時はIssue一覧から手動で紐づけられる
    }
  }

  return (
    <div className={styles.screen}>
      <div className={styles.fleetRow}>
        {AGENT_OPTIONS.map((name) => (
          <div key={name} className={styles.fleetBadge}>
            <span className={styles.fleetName}>{name}</span>
            <StatusBadge status={computeFleetStatus(name, runs)} />
          </div>
        ))}
      </div>

      <div className={`${styles.panel} ${styles.vitalsPanel}`}>
        <div className={styles.vitalsHead}>
          <div>
            <h2>Team Vitals（チーム健全性）</h2>
            <p className={styles.subtitle}>直近のJournalから算出。判断材料が足りない場合は「評価不能」として表示します。</p>
          </div>
          <div className={styles.vitalsLegend}>
            <span>🟢 安定</span>
            <span>🟡/🔴 要注意・危険</span>
            <span>⚪️ 評価不能（情報不足）</span>
          </div>
        </div>

        <div className={styles.vitalsGrid}>
          {vitals.teams.map((v) => (
            <div key={v.teamId} className={`${styles.vitalCard} ${styles[`vital-${v.status}`]}`}>
              <div className={styles.vitalLabel}>{v.teamName}</div>
              <div className={styles.vitalValue}>
                {v.status === "good" ? "🟢" : v.status === "warn" ? "🟡" : v.status === "bad" ? "🔴" : "⚪️"} {v.label}
              </div>
              <button className={styles.detailToggle} onClick={() => setOpenVitalId(openVitalId === v.teamId ? null : v.teamId)}>
                根拠を見る
              </button>
              {openVitalId === v.teamId && <div className={styles.vitalDetail}>{v.reason}</div>}
            </div>
          ))}

          <div className={`${styles.vitalCard} ${styles[`vital-${vitals.oneOnOneCoverage.status}`]}`}>
            <div className={styles.vitalLabel}>1on1 Coverage (30日)</div>
            <div className={styles.vitalValue}>
              {vitals.oneOnOneCoverage.covered} / {vitals.oneOnOneCoverage.total}
            </div>
            <button className={styles.detailToggle} onClick={() => setOpenVitalId(openVitalId === "coverage" ? null : "coverage")}>
              根拠を見る
            </button>
            {openVitalId === "coverage" && <div className={styles.vitalDetail}>{vitals.oneOnOneCoverage.reason}</div>}
          </div>

          {vitals.teams.length === 0 && (
            <p className={styles.subtitle}>
              チームが登録されていません。
              <button className={styles.detailToggle} onClick={() => router.push("/org")}>
                Organization Contextから追加
              </button>
            </p>
          )}
        </div>
      </div>

      <div className={styles.dashColumns}>
        <div className={styles.panel}>
          <h2>Quick Journal (Hybrid Data Ingestion)</h2>
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
            ※入力後、完全ローカルの軽量モデル（Qwen2.5-0.5B, 外部送信なし）が自動でタグ・人物・緊急度・感情を抽出します。
          </p>
          {journalError && <p className={styles.errorText}>{journalError}</p>}

          {journalEntries.length === 0 && !journalSubmitting && <p className={styles.subtitle}>まだジャーナルはありません。</p>}
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
                <span className={`${styles.urgencyLabel} ${styles[`urgency${entry.urgency}`]}`}>{URGENCY_LABEL[entry.urgency]}</span>
              </div>
            </div>
          ))}
        </div>

        <div className={styles.panel}>
          <h2>Inbox（タスクを起票 / 稼働中のエージェント）</h2>
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
                rows={3}
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

          <div className={styles.runList} style={{ marginTop: 12 }}>
            {runs.length === 0 && <p className={styles.subtitle}>実行中のエージェントはまだありません。</p>}
            {runs.map((run) => (
              <button key={run.id} className={styles.runItem} onClick={() => goToRunIssue(run)}>
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
        </div>
      </div>
    </div>
  );
}
