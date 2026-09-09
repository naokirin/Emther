"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "@/app/page.module.css";
import { STATUS_META, StatusBadge, runKindLabel, type AgentRun, type AgentStatus } from "@/components/RunDetail";
import { PaginationControls, paginationMeta } from "@/components/Pagination";
import { Select } from "@/components/Select";
import { useGoToRunIssue, useIssues, useRuns, useRunsInbox, useSettingsRules } from "@/lib/hooks";
import { AGENT_OPTIONS, isRunStale } from "@/lib/types";

// docs/em_ui_ux_issue.md「ダッシュボードの簡素化」対応。旧「今日」タブに同居していた
// Agent Fleet状態・横断Activity Stream・「相談・起動」パネル（エージェント起動フォーム＋
// 状態フィルタ付きInbox）をこの専用画面へ移設した。ダッシュボード側はロジック・JSXともに
// ほぼそのままここへ移しただけで、新規機能は追加していない。
const INBOX_PAGE_SIZE = 5;
const ACTIVITY_STREAM_LIMIT = 30;
const STATUS_FILTER_OPTIONS = [
  { value: "", label: "すべて" },
  { value: "active", label: "🔵 Active" },
  { value: "queued", label: "⏳ Queued（順番待ち）" },
  { value: "yield", label: "🟡 Yield" },
  { value: "idle", label: "⚪️ Idle" },
  { value: "error", label: "🔴 Error" },
];

// docs 3.1「Agent Statusシグナル」: エージェント種別ごとに直近のrunを代表値として見せる。
// そのエージェント種別のrunが一つも無い場合は「⚪️ Idle（一度も起動していない）」として扱う。
function latestRunForAgent(agentName: string, runs: AgentRun[]): AgentRun | undefined {
  const relevant = runs.filter((r) => r.agentName === agentName);
  if (relevant.length === 0) return undefined;
  return relevant.reduce((a, b) => (a.updatedAt > b.updatedAt ? a : b));
}

const STALE_META = { icon: "❔", label: "応答なし（無応答）", cls: styles.stale };

// ユーザー指摘「いつのものかわからないので日時を先頭に入れてほしい」対応。月/日 時:分を
// 常に2桁ゼロ埋めで返すことで、文字数を固定長にする（.activityLineTime側の固定幅指定と
// 合わせて、日時の値によってテキストの開始位置がずれないようにする）。
function formatActivityTimestamp(ts: number): string {
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}/${dd} ${hh}:${mi}`;
}

export default function AgentsPage() {
  const router = useRouter();
  const { runs, refreshRuns } = useRuns();
  const { issues } = useIssues();
  const goToRunIssue = useGoToRunIssue(issues);
  const { rules } = useSettingsRules();

  // docs/memo.md TODO「動いていると思ったら止まっていた、を防ぐ」対応。statusが"active"のまま
  // ログ更新が閾値以上無いrunをクライアント側で判定し、Fleet/Inboxで警告表示する。
  const staleRunIds = new Set(
    runs.filter((r) => isRunStale(r.status, r.updatedAt, rules.agentStaleAfterSeconds)).map((r) => r.id),
  );

  const [agentName, setAgentName] = useState(AGENT_OPTIONS[0]);
  const [task, setTask] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // docs/memo.md TODO「リストにおける、フィルタ機能の拡充、ページネーションの追加を行う」への対応。
  const [statusFilter, setStatusFilter] = useState<AgentStatus | "">("");
  // ユーザー指摘「『今日』の判断待ちで却下のものも並ぶので、フィルタとして却下を非表示にしたい。
  // また却下のものはデフォルトで非表示となるようにしたい」対応。
  const [showDismissedRuns, setShowDismissedRuns] = useState(false);
  // ユーザー要望「一覧の全件取得をページネーション化したい」対応。フィルタ・ページ番号を
  // サーバーへ渡し、そのページ分のrunsだけを受け取る（Fleet状態・Activity Streamは
  // 引き続き上のuseRuns()＝全件取得のまま。今回のスコープ外）。
  const [inboxPage, setInboxPage] = useState(1);
  const { runs: inboxRuns, total: inboxTotal } = useRunsInbox(
    { status: statusFilter, showDismissed: showDismissedRuns },
    inboxPage,
    INBOX_PAGE_SIZE,
  );
  const inboxMeta = paginationMeta(inboxTotal, inboxPage, INBOX_PAGE_SIZE);

  function handleStatusFilterChange(v: AgentStatus | "") {
    setStatusFilter(v);
    setInboxPage(1);
  }

  function handleShowDismissedChange(v: boolean) {
    setShowDismissedRuns(v);
    setInboxPage(1);
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
      // docs/em_human_story_and_ux.md P0-2対応。Lead Agentは「何でも相談」の相手なので、
      // 起票フォームから始めた場合も即Issue化はせず、まず相談画面に着地させる
      // （Issue化・様子見・却下はそちら側で明示的に選べる）。専門エージェントは
      // 「決まった介入」を前提に既存どおり即Issue化する。
      if (agentName === "Lead Agent") {
        router.push(`/chat?runId=${data.run.id}`);
      } else {
        await goToRunIssue(data.run);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setStarting(false);
    }
  }

  // docs/em_human_story_and_ux.md P0-2対応。Inbox行クリックの既定を「相談」優先にする。
  // Lead Agentでまだ何にも紐付いていないrunは/chatへ（そこで「Issueにする/様子見/却下」を
  // 選べる）。専門エージェントや、既にIssue化済みのrunはこれまで通り。
  function handleInboxRunClick(run: AgentRun) {
    const existing = issues.find((i) => i.agentRunId === run.id);
    if (!existing && run.agentName === "Lead Agent") {
      router.push(`/chat?runId=${run.id}`);
      return;
    }
    goToRunIssue(run);
  }

  const fleetStatuses = AGENT_OPTIONS.map((name) => {
    const latest = latestRunForAgent(name, runs);
    const stale = latest ? staleRunIds.has(latest.id) : false;
    const meta = stale ? STALE_META : STATUS_META[latest?.status ?? "idle"];
    return { name, meta };
  });

  // docs/memo.md「E. 横断Activity Stream」対応。新基盤（SSE等）は導入せず、既存runs[].logを
  // 時刻順にマージして見せるだけ。ポーリングは既存useRunsのまま。
  const activityLines = runs
    .flatMap((run) =>
      run.log.map((line, idx) => ({
        id: `${run.id}-${idx}`,
        ts: line.ts,
        timeLabel: formatActivityTimestamp(line.ts),
        agentLabel: run.agentName.replace(/ Agent$/, ""),
        icon: line.text.startsWith("[YIELD]") ? "🟡" : line.channel === "system" ? "⚙️" : line.channel === "meta" ? "📝" : "💬",
        text: line.text.replace(/\s+/g, " ").slice(0, 80),
        onSelect: () => {
          const linkedIssue = issues.find((i) => i.agentRunId === run.id);
          if (linkedIssue) {
            router.push(`/issues/${linkedIssue.id}`);
          } else if (run.agentName === "Lead Agent") {
            router.push(`/chat?runId=${run.id}`);
          } else {
            goToRunIssue(run);
          }
        },
      })),
    )
    .sort((a, b) => b.ts - a.ts)
    .slice(0, ACTIVITY_STREAM_LIMIT);

  return (
    <div className={styles.screen}>
      <div className={styles.panel}>
        <h2>エージェントの状態・直近の動き</h2>
        <div className={styles.fleetRow} style={{ marginTop: 12 }}>
          {fleetStatuses.map(({ name, meta }) => (
            <div key={name} className={`${styles.fleetBadge} ${meta.cls}`}>
              <strong>
                {meta.icon} {name}
              </strong>
              <span className={styles.fleetName}>{meta.label}</span>
            </div>
          ))}
        </div>
        {activityLines.length === 0 ? (
          <p className={styles.subtitle} style={{ marginTop: 12 }}>
            まだ直近の動きはありません。
          </p>
        ) : (
          <div className={styles.activityStream} style={{ marginTop: 12 }}>
            {activityLines.map((a) => (
              <button key={a.id} className={styles.activityLine} onClick={a.onSelect} title={`${a.timeLabel} ${a.text}`}>
                <span className={styles.activityLineTime}>{a.timeLabel}</span>
                <span className={styles.activityLineText}>
                  [{a.agentLabel}] {a.icon} {a.text}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className={styles.panel}>
        <h2>相談・起動</h2>
        <form onSubmit={handleStart}>
          <div className={styles.field}>
            {/* 改修依頼「デフォルトのセレクトボックスの多用による選択のしにくさ」対応。
                固定5件の選択肢はプルダウンで隠さず、常に見えるボタン群にする
                （介入の型・ステータス選択と同じ.typeChipパターン）。 */}
            <span className={styles.fieldCaption}>エージェント</span>
            <div role="group" aria-label="エージェント" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {AGENT_OPTIONS.map((name) => (
                <button
                  key={name}
                  type="button"
                  className={`${styles.typeChip} ${agentName === name ? styles.typeChipSelected : ""}`}
                  onClick={() => setAgentName(name)}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.field}>
            <label>タスク内容
            <textarea
              rows={3}
              value={task}
              onChange={(e) => setTask(e.target.value)}
              placeholder="例: Aさんのリファクタリングが停滞している。Bチームの割り込みタスクが原因らしい。対応方針を検討して。"
            /></label>
          </div>
          <button className={styles.primaryBtn} type="submit" disabled={starting || !task.trim()}>
            {starting ? "起動中…" : "エージェントを起動"}
          </button>
        </form>
        {error && <p className={styles.errorText} role="alert">{error}</p>}

        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, marginTop: 12 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8125rem", color: "var(--text-muted)" }}>
            状態で絞り込み:
            <Select
              value={statusFilter}
              onChange={(v) => handleStatusFilterChange(v as AgentStatus | "")}
              options={STATUS_FILTER_OPTIONS}
              style={{ minWidth: 180 }}
            />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.75rem", color: "var(--text-muted)" }}>
            <input
              type="checkbox"
              checked={showDismissedRuns}
              onChange={(e) => handleShowDismissedChange(e.target.checked)}
            />
            🗑️ 却下も表示
          </label>
        </div>

        <div className={styles.tableWrap} style={{ marginTop: 8 }}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>種別</th>
                <th>エージェント / タスク</th>
                <th>状態</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {inboxTotal === 0 && (
                <tr>
                  <td colSpan={4} className={styles.tableEmpty}>
                    条件に一致するエージェントはありません。
                  </td>
                </tr>
              )}
              {inboxRuns.map((run) => {
                const linked = issues.some((i) => i.agentRunId === run.id);
                return (
                  <tr key={run.id}>
                    <td>
                      <span className={styles.badge}>{runKindLabel(run)}</span>
                    </td>
                    <td>
                      <button className={styles.tableRowLink} onClick={() => handleInboxRunClick(run)}>
                        {run.agentName}: {run.task}
                      </button>
                      {run.consultedBy && (
                        <div className={styles.tableMuted} style={{ marginTop: 2, fontSize: "0.75rem" }}>
                          🔀 {runs.find((r) => r.id === run.consultedBy)?.agentName ?? "Lead Agent"}からの相談
                        </div>
                      )}
                    </td>
                    <td>
                      <StatusBadge status={run.status} stale={staleRunIds.has(run.id)} />
                    </td>
                    <td>
                      {!linked && run.agentName === "Lead Agent" && (
                        <button className={styles.btnOutline} onClick={() => goToRunIssue(run)}>
                          📌 Issueにする
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <PaginationControls
          page={inboxMeta.page}
          totalPages={inboxMeta.totalPages}
          total={inboxMeta.total}
          rangeStart={inboxMeta.rangeStart}
          rangeEnd={inboxMeta.rangeEnd}
          onChange={setInboxPage}
        />
      </div>
    </div>
  );
}
