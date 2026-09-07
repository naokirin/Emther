"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import styles from "@/app/page.module.css";
import { StatusBadge, type AgentRun } from "@/components/RunDetail";
import { Modal } from "@/components/Modal";
import { PaginationControls, usePagination } from "@/components/Pagination";
import { useIssues, useObjectives, useRuns, useSettingsRules, useTeams } from "@/lib/hooks";
import { INTERVENTION_TYPES, charterFilledCount, isRunStale } from "@/lib/types";

const ISSUES_PAGE_SIZE = 8;
const RUNS_PAGE_SIZE = 5;

// Issue一覧画面。起票は一般的なIssue管理サービスと同様、一覧上の「＋ 新しいIssue」ボタンから
// ダイアログを開いて行う（画面遷移しない）。Issueを選ぶと/issues/[id]の詳細画面に遷移する。
export default function IssuesPage() {
  return (
    <Suspense fallback={null}>
      <IssuesPageInner />
    </Suspense>
  );
}

// docs/em_human_story_and_ux.md P1-7対応。介入の型はtagsの中の1つとして保存されているだけ
// なので、他の（自由記入の）タグと見た目で区別できるよう、INTERVENTION_TYPESに含まれる
// ラベルかどうかで判定する。
const INTERVENTION_TYPE_LABELS = new Set(INTERVENTION_TYPES.map((t) => t.label));

function formatRelativeDays(ts: number, now: number): string {
  const days = Math.floor((now - ts) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "今日";
  if (days === 1) return "1日前";
  return `${days}日前`;
}

function IssuesPageInner() {
  const router = useRouter();
  // docs/memo.md「C. Journalセンシング→行動」対応。Quick Journalの#タグクリックから
  // `/issues?tag=...`で直接この一覧のタグフィルタを開けるようにする。
  const searchParams = useSearchParams();
  const { issues, refreshIssues } = useIssues();
  const { runs, refreshRuns } = useRuns();
  const { objectives } = useObjectives();
  const { teams } = useTeams();
  const { rules } = useSettingsRules();
  // eslint-disable-next-line react-hooks/purity -- 「最終判断日」の相対表示にのみ使う
  const now = Date.now();
  const staleRunIds = new Set(
    runs.filter((r) => isRunStale(r.status, r.updatedAt, rules.agentStaleAfterSeconds)).map((r) => r.id),
  );

  const [dialogOpen, setDialogOpen] = useState(false);
  const [issueTitle, setIssueTitle] = useState("");
  const [issueRunId, setIssueRunId] = useState("");
  const [issueWhy, setIssueWhy] = useState("");
  const [issueWhat, setIssueWhat] = useState("");
  const [issueHow, setIssueHow] = useState("");
  const [issueTags, setIssueTags] = useState("");
  const [issueKeyResultId, setIssueKeyResultId] = useState("");
  const [issueTeamId, setIssueTeamId] = useState("");
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [issueSubmitting, setIssueSubmitting] = useState(false);
  const [issueError, setIssueError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [tagFilter, setTagFilter] = useState(searchParams.get("tag") ?? "");
  const [incompleteOnly, setIncompleteOnly] = useState(false);

  const unlinkedRuns = runs.filter((r) => !issues.some((i) => i.agentRunId === r.id));
  // 子Issue（parentIdあり）は親の詳細画面（サブIssue欄）で見る形にし、
  // 一覧が親子入り混じって煩雑にならないようトップレベルだけを表示する。
  // アーカイブ済みは既定で隠す（docs/memo.md TODO対応）。EMが明示的にトグルした場合のみ表示する。
  const topLevelIssues = issues.filter((i) => !i.parentId && (showArchived || !i.archived));
  const archivedCount = issues.filter((i) => !i.parentId && i.archived).length;

  // docs/memo.md TODO「リストにおける、フィルタ機能の拡充、ページネーションの追加を行う」への対応。
  const allTags = Array.from(new Set(topLevelIssues.flatMap((i) => i.tags))).sort((a, b) => a.localeCompare(b, "ja"));
  const filteredIssues = topLevelIssues.filter((i) => {
    if (tagFilter && !i.tags.includes(tagFilter)) return false;
    if (incompleteOnly && charterFilledCount(i.charter) === 3) return false;
    return true;
  });
  const issuesPagination = usePagination(filteredIssues, ISSUES_PAGE_SIZE);
  const runsPagination = usePagination(unlinkedRuns, RUNS_PAGE_SIZE);

  // docs/memo.md「G. Issueに『介入の型』を足す」対応。型は既存tagsへそのまま追加/削除するだけで、
  // 新規フィールドは持たない。最後に選んだ型のwhy/what/howをプレースホルダーとして見せる
  // （実際に入力された値は上書きしない）。
  function toggleInterventionType(label: string) {
    setSelectedTypes((prev) => (prev.includes(label) ? prev.filter((t) => t !== label) : [...prev, label]));
    const current = issueTags.split(",").map((t) => t.trim()).filter(Boolean);
    const next = current.includes(label) ? current.filter((t) => t !== label) : [...current, label];
    setIssueTags(next.join(", "));
  }
  const activeType =
    selectedTypes.length > 0 ? INTERVENTION_TYPES.find((t) => t.label === selectedTypes[selectedTypes.length - 1]) : undefined;

  // docs/em_human_story_and_ux.md P1-7対応。「今期何を解いているか」を一覧でも見せるための
  // Objective/KRタイトルの逆引き。
  function keyResultLabel(krId: string): string | undefined {
    for (const o of objectives) {
      const kr = o.keyResults.find((k) => k.id === krId);
      if (kr) return `${o.title} ＞ ${kr.title}`;
    }
    return undefined;
  }

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
          tags: issueTags.split(",").map((t) => t.trim()).filter(Boolean),
          keyResultId: issueKeyResultId || undefined,
          teamId: issueTeamId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Issueの起票に失敗しました");
      setIssueTitle("");
      setIssueRunId("");
      setIssueWhy("");
      setIssueWhat("");
      setIssueHow("");
      setIssueTags("");
      setIssueKeyResultId("");
      setIssueTeamId("");
      setSelectedTypes([]);
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
        <div>
          <h2 style={{ margin: 0 }}>進行中の介入ポートフォリオ</h2>
          <p className={styles.subtitle} style={{ marginTop: 4 }}>
            実装タスク箱ではなく、型・関連チーム・今期のKRに紐づく「介入」の一覧です。
          </p>
        </div>
        <button className={styles.primaryBtn} style={{ width: "auto", flexShrink: 0 }} onClick={() => setDialogOpen(true)}>
          ＋ 新しいIssue
        </button>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14, margin: "8px 0" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.75rem", color: "var(--text-muted)" }}>
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          アーカイブ済みも表示する（{archivedCount}件）
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.75rem", color: "var(--text-muted)" }}>
          <input type="checkbox" checked={incompleteOnly} onChange={(e) => setIncompleteOnly(e.target.checked)} />
          Why/What/How未整理のみ
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.75rem", color: "var(--text-muted)" }}>
          タグで絞り込み:
          <select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
            <option value="">すべて</option>
            {allTags.map((tag) => (
              <option key={tag} value={tag}>
                #{tag}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className={styles.runList} style={{ maxHeight: "none" }}>
        {filteredIssues.length === 0 && <p className={styles.subtitle}>条件に一致するIssueはありません。</p>}
        {issuesPagination.pageItems.map((issue) => {
          const linkedRun = runs.find((r) => r.id === issue.agentRunId);
          const doneCount = issue.actionItems.filter((a) => a.done).length;
          const charterCount = charterFilledCount(issue.charter);
          const childCount = issues.filter((i) => i.parentId === issue.id).length;
          const interventionTypes = issue.tags.filter((t) => INTERVENTION_TYPE_LABELS.has(t));
          const topicTags = issue.tags.filter((t) => !INTERVENTION_TYPE_LABELS.has(t));
          const teamName = issue.teamId ? teams.find((t) => t.id === issue.teamId)?.name : undefined;
          const krLabel = issue.keyResultId ? keyResultLabel(issue.keyResultId) : undefined;
          return (
            <button
              key={issue.id}
              className={styles.runItem}
              style={issue.archived ? { opacity: 0.6 } : undefined}
              onClick={() => router.push(`/issues/${issue.id}`)}
            >
              <div>
                <strong>{issue.title}</strong>{" "}
                {linkedRun && <StatusBadge status={linkedRun.status} stale={staleRunIds.has(linkedRun.id)} />}
                {issue.archived && (
                  <span className={styles.subtitle} style={{ marginLeft: 6 }}>
                    🗄 アーカイブ済み
                  </span>
                )}
                <span className={charterCount === 3 ? styles.charterBadgeReady : styles.charterBadgeWarn} style={{ marginLeft: 6 }}>
                  {charterCount === 3 ? "✅" : "❓"} Why/What/How: {charterCount}/3
                </span>
                {childCount > 0 && (
                  <span className={styles.subtitle} style={{ marginLeft: 6 }}>
                    🧩 子Issue: {childCount}件
                  </span>
                )}
              </div>

              {/* docs/em_human_story_and_ux.md P1-7対応。型・関連チーム・今期のKR・最終判断日を
                  一覧の時点で見せ、「実装タスク箱」ではなく「介入のポートフォリオ」として読めるようにする。 */}
              <div className={styles.tagRow}>
                {interventionTypes.map((t) => (
                  <span key={t} className={`${styles.tag} ${styles.tagPerson}`}>
                    🎯 {t}
                  </span>
                ))}
                {teamName && (
                  <span className={styles.subtitle} title="関連チーム">
                    👥 {teamName}
                  </span>
                )}
                {krLabel && (
                  <span className={styles.subtitle} title="紐付いているKey Result">
                    📈 {krLabel}
                  </span>
                )}
                <span className={styles.subtitle} title="最終更新日">
                  🕒 最終判断: {formatRelativeDays(issue.updatedAt, now)}
                </span>
              </div>

              {topicTags.length > 0 && (
                <div className={styles.tagRow}>
                  {topicTags.map((tag) => (
                    <span key={tag} className={`${styles.tag} ${styles.tagTopic}`}>
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
              <div className={styles.runItemTask}>
                Action Items: {doneCount}/{issue.actionItems.length}
              </div>
            </button>
          );
        })}
      </div>
      <PaginationControls
        page={issuesPagination.page}
        totalPages={issuesPagination.totalPages}
        total={issuesPagination.total}
        rangeStart={issuesPagination.rangeStart}
        rangeEnd={issuesPagination.rangeEnd}
        onChange={issuesPagination.setPage}
      />

      <h3 style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "20px 0 6px" }}>Issue未起票のAgent Run</h3>
      <p className={styles.subtitle} style={{ marginBottom: 10 }}>
        ワイヤーフレームには無い一覧だが、複数のRunを実運用で捌くために追加している。クリックするとその場でIssue化して詳細画面へ移動する。
      </p>
      <div className={styles.runList} style={{ maxHeight: "none" }}>
        {unlinkedRuns.length === 0 && <p className={styles.subtitle}>すべてのRunがIssueに紐づいています。</p>}
        {runsPagination.pageItems.map((run) => (
          <button key={run.id} className={styles.runItem} onClick={() => handlePromoteRun(run)}>
            <div>
              <strong>{run.agentName}</strong> <StatusBadge status={run.status} stale={staleRunIds.has(run.id)} />
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
      <PaginationControls
        page={runsPagination.page}
        totalPages={runsPagination.totalPages}
        total={runsPagination.total}
        rangeStart={runsPagination.rangeStart}
        rangeEnd={runsPagination.rangeEnd}
        onChange={runsPagination.setPage}
      />

      {dialogOpen && (
        <Modal title="新しいIssueを起票" onClose={() => setDialogOpen(false)}>
          <form onSubmit={handleCreateIssue}>
            <div className={styles.field}>
              <label>タイトル
              <input
                type="text"
                autoFocus
                value={issueTitle}
                onChange={(e) => setIssueTitle(e.target.value)}
                placeholder="例: Aさんのリファクタリング停滞"
              /></label>
            </div>
            <div className={styles.field}>
              <label>関連づけるAgent Run（任意）
              <select value={issueRunId} onChange={(e) => setIssueRunId(e.target.value)}>
                <option value="">なし</option>
                {runs.map((r) => (
                  <option key={r.id} value={r.id}>
                    [{r.agentName}] {r.task.slice(0, 30)}
                  </option>
                ))}
              </select></label>
            </div>

            <div className={styles.field}>
              <label>関連チーム（任意。そのチームのMission/制約を前提として注入する）
              <select value={issueTeamId} onChange={(e) => setIssueTeamId(e.target.value)}>
                <option value="">なし</option>
                {teams
                  .filter((t) => !t.archived)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </select></label>
            </div>

            <div className={styles.field}>
              <label>紐付けるKey Result（任意。「今期何を解いているか」の一本線を作る）
              <select value={issueKeyResultId} onChange={(e) => setIssueKeyResultId(e.target.value)}>
                <option value="">なし</option>
                {objectives.map((o) =>
                  o.keyResults.map((kr) => (
                    <option key={kr.id} value={kr.id}>
                      {o.title} ＞ {kr.title}
                    </option>
                  )),
                )}
              </select></label>
            </div>

            <div className={styles.field}>
              <span className={styles.fieldCaption}>介入の型（任意・複数可。実装タスクではなく仕組み・人・組織への介入の切り口）</span>
              <div
                role="group"
                aria-label="介入の型（複数選択可）"
                style={{ display: "flex", flexWrap: "wrap", gap: 6 }}
              >
                {INTERVENTION_TYPES.map((t) => (
                  <button
                    key={t.label}
                    type="button"
                    className={`${styles.typeChip} ${selectedTypes.includes(t.label) ? styles.typeChipSelected : ""}`}
                    onClick={() => toggleInterventionType(t.label)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <p className={styles.subtitle} style={{ margin: "8px 0" }}>
              Why/What/Howは分かっている範囲でOK。分からなければ空欄のまま起票し、詳細画面で明らかにしてから計画・実行してください。
            </p>
            <div className={styles.field}>
              <label>Why（このIssueが生む価値・誰のためか・なぜ今か）
              <textarea
                rows={2}
                value={issueWhy}
                onChange={(e) => setIssueWhy(e.target.value)}
                placeholder={activeType?.why ?? "例: Aさんの離脱リスクを下げ、決済基盤の開発速度を維持するため。今対応しないと来期のリリースに響く。"}
              /></label>
            </div>
            <div className={styles.field}>
              <label>What（何を・どこまで・どのくらい・完了の定義）
              <textarea
                rows={2}
                value={issueWhat}
                onChange={(e) => setIssueWhat(e.target.value)}
                placeholder={activeType?.what ?? "例: Bチームからの割り込みタスクを整理し、Aさんが週3日以上リファクタリングに専念できる状態にする。完了条件: ○○。"}
              /></label>
            </div>
            <div className={styles.field}>
              <label>How（どのように実現するか・前提や制約）
              <textarea
                rows={2}
                value={issueHow}
                onChange={(e) => setIssueHow(e.target.value)}
                placeholder={activeType?.how ?? "例: 割り込みタスクの受け入れ基準を定めてBチームと合意する。予算・人員の追加は無い前提。"}
              /></label>
            </div>
            <div className={styles.field}>
              <label>タグ（カンマ区切り、任意）
              <input
                type="text"
                value={issueTags}
                onChange={(e) => setIssueTags(e.target.value)}
                placeholder="例: バグ, リファクタリング, オンボーディング"
              /></label>
            </div>

            {issueError && <p className={styles.errorText} role="alert">{issueError}</p>}
            <button className={styles.primaryBtn} type="submit" disabled={issueSubmitting || !issueTitle.trim()}>
              Issueを起票
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
