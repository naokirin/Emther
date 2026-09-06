"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./page.module.css";
import { RunDetail, StatusBadge, type AgentRun, type AgentStatus } from "@/components/RunDetail";

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

type Team = {
  id: string;
  name: string;
  members: string[];
  createdAt: number;
};

type VitalStatus = "good" | "warn" | "bad" | "unknown";

type TeamVital = {
  teamId: string;
  teamName: string;
  status: VitalStatus;
  label: string;
  reason: string;
};

type CoverageVital = {
  status: VitalStatus;
  covered: number;
  total: number;
  reason: string;
};

type OrgVitals = {
  teams: TeamVital[];
  oneOnOneCoverage: CoverageVital;
};

type ActionItem = {
  id: string;
  text: string;
  done: boolean;
};

type Issue = {
  id: string;
  title: string;
  agentRunId?: string;
  actionItems: ActionItem[];
  createdAt: number;
  updatedAt: number;
};

const AGENT_OPTIONS = ["Lead Agent", "People Agent", "Process Agent", "Tech Agent"];

const VITAL_ICON: Record<VitalStatus, string> = {
  good: "🟢",
  warn: "🟡",
  bad: "🔴",
  unknown: "⚪️",
};

const URGENCY_LABEL: Record<JournalEntry["urgency"], string> = {
  low: "Urgency: Low",
  mid: "Urgency: Mid",
  high: "Urgency: High",
};

// docs 3.1「Agent Statusシグナル」: エージェント種別ごとに直近のrunの状態を代表値として見せる。
// そのエージェント種別のrunが一つも無い場合は「⚪️ Idle（一度も起動していない）」として扱う。
function computeFleetStatus(agentName: string, runs: AgentRun[]): AgentStatus {
  const relevant = runs.filter((r) => r.agentName === agentName);
  if (relevant.length === 0) return "idle";
  const latest = relevant.reduce((a, b) => (a.updatedAt > b.updatedAt ? a : b));
  return latest.status;
}

type TabId = "dashboard" | "issues" | "org";

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabId>("dashboard");
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [agentName, setAgentName] = useState(AGENT_OPTIONS[0]);
  const [task, setTask] = useState("");
  const [message, setMessage] = useState("");
  const [starting, setStarting] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  const [journalText, setJournalText] = useState("");
  const [journalSubmitting, setJournalSubmitting] = useState(false);
  const [journalError, setJournalError] = useState<string | null>(null);

  const [teams, setTeams] = useState<Team[]>([]);
  const [vitals, setVitals] = useState<OrgVitals | null>(null);
  const [teamName, setTeamName] = useState("");
  const [teamMembers, setTeamMembers] = useState("");
  const [teamSubmitting, setTeamSubmitting] = useState(false);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [openVitalId, setOpenVitalId] = useState<string | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);

  const [issues, setIssues] = useState<Issue[]>([]);
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [issueTitle, setIssueTitle] = useState("");
  const [issueRunId, setIssueRunId] = useState("");
  const [issueSubmitting, setIssueSubmitting] = useState(false);
  const [issueError, setIssueError] = useState<string | null>(null);
  const [actionItemText, setActionItemText] = useState("");
  const [issueMessage, setIssueMessage] = useState("");
  const [issueDeciding, setIssueDeciding] = useState(false);

  const selectedRun = runs.find((r) => r.id === selectedId) ?? null;
  const selectedIssue = issues.find((i) => i.id === selectedIssueId) ?? null;
  const selectedIssueRun = selectedIssue ? runs.find((r) => r.id === selectedIssue.agentRunId) ?? null : null;
  const selectedTeam = teams.find((t) => t.id === selectedTeamId) ?? null;
  const unlinkedRuns = runs.filter((r) => !issues.some((i) => i.agentRunId === r.id));

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

  const refreshOrg = useCallback(async () => {
    try {
      const [teamsRes, vitalsRes] = await Promise.all([fetch("/api/teams"), fetch("/api/vitals")]);
      const teamsData = await teamsRes.json();
      const vitalsData = await vitalsRes.json();
      setTeams(teamsData.teams ?? []);
      setVitals(vitalsData);
    } catch {
      // ポーリング失敗は静かに無視し、次回のポーリングに任せる
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const [teamsRes, vitalsRes] = await Promise.all([fetch("/api/teams"), fetch("/api/vitals")]);
        const teamsData = await teamsRes.json();
        const vitalsData = await vitalsRes.json();
        if (!cancelled) {
          setTeams(teamsData.teams ?? []);
          setVitals(vitalsData);
        }
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

  async function handleAddTeam(e: React.FormEvent) {
    e.preventDefault();
    if (!teamName.trim()) return;
    setTeamSubmitting(true);
    setTeamError(null);
    try {
      const members = teamMembers
        .split(",")
        .map((m) => m.trim())
        .filter(Boolean);
      const res = await fetch("/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: teamName, members }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "チームの追加に失敗しました");
      setTeamName("");
      setTeamMembers("");
      setSelectedTeamId(data.team.id);
      await refreshOrg();
    } catch (err) {
      setTeamError((err as Error).message);
    } finally {
      setTeamSubmitting(false);
    }
  }

  async function handleRemoveTeam(id: string) {
    try {
      await fetch(`/api/teams/${id}`, { method: "DELETE" });
      if (selectedTeamId === id) setSelectedTeamId(null);
      await refreshOrg();
    } catch {
      // 失敗時は次回のポーリングで状態が揃う
    }
  }

  const refreshIssues = useCallback(async () => {
    try {
      const res = await fetch("/api/issues");
      const data = await res.json();
      setIssues(data.issues ?? []);
    } catch {
      // ポーリング失敗は静かに無視し、次回のポーリングに任せる
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch("/api/issues");
        const data = await res.json();
        if (!cancelled) setIssues(data.issues ?? []);
      } catch {
        // ポーリング失敗は静かに無視し、次回のポーリングに任せる
      }
    }

    const interval = setInterval(poll, 3000);
    void poll();
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  async function handleCreateIssue(e: React.FormEvent) {
    e.preventDefault();
    if (!issueTitle.trim()) return;
    setIssueSubmitting(true);
    setIssueError(null);
    try {
      const res = await fetch("/api/issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: issueTitle, agentRunId: issueRunId || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Issueの起票に失敗しました");
      setIssueTitle("");
      setIssueRunId("");
      setSelectedId(null);
      setSelectedIssueId(data.issue.id);
      await refreshIssues();
    } catch (err) {
      setIssueError((err as Error).message);
    } finally {
      setIssueSubmitting(false);
    }
  }

  async function handlePromoteToIssue(run: AgentRun) {
    setIssueSubmitting(true);
    setIssueError(null);
    try {
      const res = await fetch("/api/issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: run.task.slice(0, 60), agentRunId: run.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Issueの起票に失敗しました");
      setSelectedId(null);
      setSelectedIssueId(data.issue.id);
      await refreshIssues();
    } catch (err) {
      setIssueError((err as Error).message);
    } finally {
      setIssueSubmitting(false);
    }
  }

  async function handleAddActionItem(issueId: string) {
    if (!actionItemText.trim()) return;
    try {
      const res = await fetch(`/api/issues/${issueId}/action-items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: actionItemText }),
      });
      const data = await res.json();
      if (res.ok) {
        setIssues((prev) => prev.map((i) => (i.id === issueId ? data.issue : i)));
        setActionItemText("");
      }
    } catch {
      // 失敗時は次回のポーリングで状態が揃う
    }
  }

  async function handleToggleActionItem(issueId: string, itemId: string) {
    try {
      const res = await fetch(`/api/issues/${issueId}/action-items/${itemId}`, { method: "PATCH" });
      const data = await res.json();
      if (res.ok) {
        setIssues((prev) => prev.map((i) => (i.id === issueId ? data.issue : i)));
      }
    } catch {
      // 失敗時は次回のポーリングで状態が揃う
    }
  }

  async function sendIssueDecision(run: AgentRun, text: string) {
    if (!text.trim()) return;
    setIssueDeciding(true);
    setIssueError(null);
    try {
      const res = await fetch(`/api/agents/${run.id}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "送信に失敗しました");
      setIssueMessage("");
      await refreshRuns();
    } catch (err) {
      setIssueError((err as Error).message);
    } finally {
      setIssueDeciding(false);
    }
  }

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
      setSelectedIssueId(null);
      setSelectedId(data.run.id);
      setActiveTab("issues");
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
        <h1 className={styles.title}>EM Support System</h1>
        <p className={styles.subtitle}>
          Manager&apos;s Cockpit — Daily Triage &amp; Agent Oversight
        </p>
      </div>

      <nav className={styles.tabs}>
        <button className={`${styles.tabBtn} ${activeTab === "dashboard" ? styles.tabBtnActive : ""}`} onClick={() => setActiveTab("dashboard")}>
          Dashboard
        </button>
        <button className={`${styles.tabBtn} ${activeTab === "issues" ? styles.tabBtnActive : ""}`} onClick={() => setActiveTab("issues")}>
          Issue Workspace
        </button>
        <button className={`${styles.tabBtn} ${activeTab === "org" ? styles.tabBtnActive : ""}`} onClick={() => setActiveTab("org")}>
          Organization Context
        </button>
      </nav>

      {activeTab === "dashboard" && (
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
              {vitals?.teams.map((v) => (
                <div key={v.teamId} className={`${styles.vitalCard} ${styles[`vital-${v.status}`]}`}>
                  <div className={styles.vitalLabel}>{v.teamName}</div>
                  <div className={styles.vitalValue}>
                    {VITAL_ICON[v.status]} {v.label}
                  </div>
                  <button
                    className={styles.detailToggle}
                    onClick={() => setOpenVitalId(openVitalId === v.teamId ? null : v.teamId)}
                  >
                    根拠を見る
                  </button>
                  {openVitalId === v.teamId && <div className={styles.vitalDetail}>{v.reason}</div>}
                </div>
              ))}

              {vitals && (
                <div className={`${styles.vitalCard} ${styles[`vital-${vitals.oneOnOneCoverage.status}`]}`}>
                  <div className={styles.vitalLabel}>1on1 Coverage (30日)</div>
                  <div className={styles.vitalValue}>
                    {VITAL_ICON[vitals.oneOnOneCoverage.status]} {vitals.oneOnOneCoverage.covered} / {vitals.oneOnOneCoverage.total}
                  </div>
                  <button
                    className={styles.detailToggle}
                    onClick={() => setOpenVitalId(openVitalId === "coverage" ? null : "coverage")}
                  >
                    根拠を見る
                  </button>
                  {openVitalId === "coverage" && <div className={styles.vitalDetail}>{vitals.oneOnOneCoverage.reason}</div>}
                </div>
              )}

              {vitals && vitals.teams.length === 0 && (
                <p className={styles.subtitle}>
                  チームが登録されていません。
                  <button className={styles.detailToggle} onClick={() => setActiveTab("org")}>
                    Organization Contextから追加
                  </button>
                </p>
              )}
            </div>
          </div>

          <div className={styles.layout}>
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
                  <button
                    key={run.id}
                    className={styles.runItem}
                    onClick={() => {
                      setSelectedIssueId(null);
                      setSelectedId(run.id);
                      setActiveTab("issues");
                    }}
                  >
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
      )}

      {activeTab === "issues" && (
        <div className={`${styles.layout} ${styles.screen}`}>
          <div>
            <div className={styles.panel}>
              <h2>Issueを起票</h2>
              <form onSubmit={handleCreateIssue}>
                <div className={styles.field}>
                  <label>タイトル</label>
                  <input type="text" value={issueTitle} onChange={(e) => setIssueTitle(e.target.value)} placeholder="例: Aさんのリファクタリング停滞" />
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
                <button className={styles.primaryBtn} type="submit" disabled={issueSubmitting || !issueTitle.trim()}>
                  Issueを起票
                </button>
              </form>
              {issueError && <p className={styles.errorText}>{issueError}</p>}
            </div>

            <h3 style={{ fontSize: 12, color: "var(--text-muted)", margin: "14px 0 6px" }}>Issues</h3>
            <div className={styles.runList}>
              {issues.length === 0 && <p className={styles.subtitle}>Issueはまだありません。</p>}
              {issues.map((issue) => {
                const linkedRun = runs.find((r) => r.id === issue.agentRunId);
                const doneCount = issue.actionItems.filter((a) => a.done).length;
                return (
                  <button
                    key={issue.id}
                    className={`${styles.runItem} ${issue.id === selectedIssueId ? styles.selected : ""}`}
                    onClick={() => {
                      setSelectedId(null);
                      setSelectedIssueId(issue.id);
                    }}
                  >
                    <div>
                      <strong>{issue.title}</strong> {linkedRun && <StatusBadge status={linkedRun.status} />}
                    </div>
                    <div className={styles.runItemTask}>
                      Action Items: {doneCount}/{issue.actionItems.length}
                    </div>
                  </button>
                );
              })}
            </div>

            <h3 style={{ fontSize: 12, color: "var(--text-muted)", margin: "14px 0 6px" }}>Issue未起票のAgent Run</h3>
            <div className={styles.runList}>
              {unlinkedRuns.length === 0 && <p className={styles.subtitle}>すべてのRunがIssueに紐づいています。</p>}
              {unlinkedRuns.map((run) => (
                <button
                  key={run.id}
                  className={`${styles.runItem} ${run.id === selectedId ? styles.selected : ""}`}
                  onClick={() => {
                    setSelectedIssueId(null);
                    setSelectedId(run.id);
                  }}
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
            {!selectedIssue && !selectedRun && (
              <p className={styles.emptyState}>左でIssueまたはAgent Runを選択してください。</p>
            )}

            {selectedIssue && (
              <>
                <div className={styles.detailHeader}>
                  <h2 style={{ marginBottom: 4 }}>{selectedIssue.title}</h2>
                  {selectedIssueRun && <StatusBadge status={selectedIssueRun.status} />}
                </div>

                <h3 style={{ fontSize: 13, marginBottom: 6 }}>Action Items</h3>
                {selectedIssue.actionItems.length === 0 && <p className={styles.subtitle}>まだありません。</p>}
                <ul style={{ listStyle: "none", marginBottom: 10 }}>
                  {selectedIssue.actionItems.map((item) => (
                    <li key={item.id} style={{ fontSize: 13, marginBottom: 6 }}>
                      <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
                        <input type="checkbox" checked={item.done} onChange={() => handleToggleActionItem(selectedIssue.id, item.id)} />
                        <span style={{ textDecoration: item.done ? "line-through" : "none", color: item.done ? "var(--text-muted)" : "inherit" }}>
                          {item.text}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
                <div className={styles.chatRow}>
                  <input
                    type="text"
                    placeholder="Action Itemを追加…"
                    value={actionItemText}
                    onChange={(e) => setActionItemText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAddActionItem(selectedIssue.id);
                    }}
                  />
                  <button className={styles.primaryBtn} style={{ width: "auto" }} disabled={!actionItemText.trim()} onClick={() => handleAddActionItem(selectedIssue.id)}>
                    追加
                  </button>
                </div>

                {selectedIssueRun && (
                  <div style={{ marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
                    <RunDetail
                      run={selectedIssueRun}
                      message={issueMessage}
                      setMessage={setIssueMessage}
                      deciding={issueDeciding}
                      onDecide={(text) => sendIssueDecision(selectedIssueRun, text)}
                    />
                  </div>
                )}
                {!selectedIssueRun && (
                  <p className={styles.subtitle} style={{ marginTop: 12 }}>
                    Agent Runが紐づいていません。Dashboardでタスクを起票するか、左の「Issue未起票のAgent Run」から紐づけてください。
                  </p>
                )}
              </>
            )}

            {!selectedIssue && selectedRun && (
              <>
                <button
                  className={styles.detailToggle}
                  style={{ marginBottom: 8 }}
                  disabled={issueSubmitting}
                  onClick={() => handlePromoteToIssue(selectedRun)}
                >
                  📌 このRunをIssueにする
                </button>
                <RunDetail run={selectedRun} message={message} setMessage={setMessage} deciding={deciding} onDecide={sendDecision} />
              </>
            )}
          </div>
        </div>
      )}

      {activeTab === "org" && (
        <div className={`${styles.layout} ${styles.screen}`}>
          <div className={styles.panel}>
            <h2>Context Directory</h2>
            <p className={styles.subtitle}>チーム構成はAgent Runtimeへ絶対の前提として注入され、Team Vitalsの算出にも使われます。</p>
            <form onSubmit={handleAddTeam} style={{ marginTop: 10 }}>
              <div className={styles.field}>
                <label>チーム名</label>
                <input type="text" value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="例: Team A" />
              </div>
              <div className={styles.field}>
                <label>メンバー（カンマ区切り）</label>
                <input
                  type="text"
                  value={teamMembers}
                  onChange={(e) => setTeamMembers(e.target.value)}
                  placeholder="例: Aさん, Bさん ※Journalのpeopleと同じ表記で"
                />
              </div>
              <button className={styles.primaryBtn} type="submit" disabled={teamSubmitting || !teamName.trim()}>
                追加
              </button>
            </form>
            {teamError && <p className={styles.errorText}>{teamError}</p>}

            <div className={styles.tree} style={{ marginTop: 14 }}>
              <div className={styles.treeFolder}>📁 Teams（組織体制）</div>
              {teams.length === 0 && <p className={styles.subtitle}>まだチームが登録されていません。</p>}
              {teams.map((t) => (
                <div
                  key={t.id}
                  className={`${styles.treeFile} ${t.id === selectedTeamId ? styles.treeFileSelected : ""}`}
                  onClick={() => setSelectedTeamId(t.id)}
                >
                  📁 {t.name}（{t.members.length}名）
                </div>
              ))}
            </div>
          </div>

          <div className={styles.panel}>
            {!selectedTeam && <p className={styles.emptyState}>左のツリーからチームを選択してください。</p>}
            {selectedTeam && (
              <>
                <div className={styles.editorPath}>
                  <code>/Teams/{selectedTeam.name}</code>
                  <button className={styles.btnOutline} onClick={() => handleRemoveTeam(selectedTeam.id)}>
                    このチームを削除
                  </button>
                </div>
                <div className={styles.field}>
                  <label>Mission</label>
                  <textarea rows={2} readOnly value="（未設定。将来のOrganization Context拡張で編集可能にする想定）" />
                </div>
                <div className={styles.field}>
                  <label>Members_Profile</label>
                  <div className={styles.tagRow} style={{ marginTop: 6 }}>
                    {selectedTeam.members.length === 0 && <span className={styles.subtitle}>メンバー未登録</span>}
                    {selectedTeam.members.map((m) => (
                      <span key={m} className={`${styles.tag} ${styles.tagPerson}`}>
                        @{m}
                      </span>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
