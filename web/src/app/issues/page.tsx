"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import styles from "@/app/page.module.css";
import { StatusBadge, runFallbackTitle, type AgentRun } from "@/components/RunDetail";
import { Modal } from "@/components/Modal";
import { PaginationControls, usePagination } from "@/components/Pagination";
import { ProgressBar } from "@/components/ProgressBar";
import { IssueStatusBadge, IssuePriorityBadge, IssueTriageAxes } from "@/components/IssueStatus";
import { IssueBoard } from "@/components/IssueBoard";
import {
  IssueStrategyLinkSuggestPanel,
} from "@/components/HierarchyLinkSuggestPanel";
import { Select } from "@/components/Select";
import { SlideOver } from "@/components/SlideOver";
import { IssueDetailContent } from "@/components/IssueDetailContent";
import { IdResolveProvider } from "@/components/IdFragmentLink";
import { useIssues, useObjectives, usePeekParam, useRuns, useSettingsRules, useTeams, useThemes } from "@/lib/hooks";
import {
  INTERVENTION_TYPES,
  ISSUE_PRIORITY_META,
  ISSUE_STATUS_META,
  charterFilledCount,
  compareIssuesByPriority,
  isIssueStalled,
  isIssueStrategyUnlinked,
  isRunStale,
  issueNextAction,
  issueProgress,
  truncateForTitle,
  type Issue,
  type IssuePriority,
  type IssueStatus,
  type IssueStrategyLinkSuggestion,
} from "@/lib/types";

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
  // docs/em_ui_ux_issue.md「一覧⇄詳細をサイドピークで」対応。
  const peek = usePeekParam("issue");
  const { issues, issuesLoaded, refreshIssues } = useIssues();
  const { runs, refreshRuns } = useRuns();
  const { objectives } = useObjectives();
  const { teams } = useTeams();
  const { themes } = useThemes();
  const { rules } = useSettingsRules();
  // eslint-disable-next-line react-hooks/purity -- 「最終判断日」の相対表示にのみ使う
  const now = Date.now();
  const staleRunIds = new Set(
    runs.filter((r) => isRunStale(r.status, r.updatedAt, rules.agentStaleAfterSeconds)).map((r) => r.id),
  );

  // docs/em_ui_ux_issue.md 4節「ビューの切り替え機能」対応。
  // Action Itemsビュー: Issue横断で「次の一手」だけを優先度順に捌く（週〜月の見通し）。
  const [viewMode, setViewMode] = useState<"list" | "board" | "actions">("list");
  const [completingActionKey, setCompletingActionKey] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [issueTitle, setIssueTitle] = useState("");
  const [issueRunId, setIssueRunId] = useState("");
  const [issueWhy, setIssueWhy] = useState("");
  const [issueWhat, setIssueWhat] = useState("");
  const [issueHow, setIssueHow] = useState("");
  const [issueTags, setIssueTags] = useState("");
  const [issueKeyResultId, setIssueKeyResultId] = useState("");
  const [issueThemeId, setIssueThemeId] = useState("");
  const [issueTeamId, setIssueTeamId] = useState("");
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [issueSubmitting, setIssueSubmitting] = useState(false);
  const [issueError, setIssueError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [tagFilter, setTagFilter] = useState(searchParams.get("tag") ?? "");
  const [incompleteOnly, setIncompleteOnly] = useState(false);
  // 既定は「完了・アーカイブ以外」（未着手含む）。アーカイブは showArchived、完了は statusFilter で除外。
  // 並びは compareIssuesByPriority（フォーカス → 通常 → 保留、フォーカス内は focusOrder）。
  const [statusFilter, setStatusFilter] = useState<"open" | "active" | "all" | IssueStatus>("open");
  const [priorityFilter, setPriorityFilter] = useState<"all" | IssuePriority>("all");
  const [promoteError, setPromoteError] = useState<string | null>(null);
  const [focusMovingId, setFocusMovingId] = useState<string | null>(null);
  const [triageSubmitting, setTriageSubmitting] = useState(false);
  const [triageError, setTriageError] = useState<string | null>(null);
  const [triageMessage, setTriageMessage] = useState<string | null>(null);
  const [triagePreview, setTriagePreview] = useState<{
    counts: Record<IssuePriority, number>;
    focusCandidates: Array<{
      id: string;
      title: string;
      costOfDelay: number;
      effort: number;
      blastRadius: number;
      confidence: number;
    }>;
    changes: Array<{ issueId: string; title: string; fromLabel: string; toLabel: string }>;
  } | null>(null);
  const [linkSuggesting, setLinkSuggesting] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkPreview, setLinkPreview] = useState<{
    suggestions: IssueStrategyLinkSuggestion[];
    source: "cloud" | "heuristic";
    fallbackReason?: string;
  } | null>(null);
  const [linkApplyingId, setLinkApplyingId] = useState<string | null>(null);
  // リスト: 親ごとの子Issue展開。既定は折りたたみ。
  const [expandedIssueIds, setExpandedIssueIds] = useState<Set<string>>(() => new Set());
  // ボード: 子Issueを自身のステータス列へ独立カードとして出すか。
  const [showChildIssuesOnBoard, setShowChildIssuesOnBoard] = useState(false);

  const unlinkedRuns = runs.filter((r) => !issues.some((i) => i.agentRunId === r.id));
  // アーカイブ済みは既定で隠す（docs/memo.md TODO対応）。EMが明示的にトグルした場合のみ表示する。
  // リストはトップレベルを主行とし、展開時の子／ボードの子トグルも同じフィルタを通す。
  const archivedCount = issues.filter((i) => !i.parentId && i.archived).length;

  function matchesIssueFilters(i: Issue): boolean {
    if (!showArchived && i.archived) return false;
    if (tagFilter && !i.tags.includes(tagFilter)) return false;
    if (incompleteOnly && charterFilledCount(i.charter) === 3) return false;
    if (statusFilter === "open") {
      if (i.status === "done") return false;
    } else if (statusFilter === "active") {
      if (i.status !== "in_progress" && i.status !== "blocked") return false;
    } else if (statusFilter !== "all" && i.status !== statusFilter) {
      return false;
    }
    if (priorityFilter !== "all" && (i.priority ?? "normal") !== priorityFilter) return false;
    return true;
  }

  // docs/memo.md TODO「リストにおける、フィルタ機能の拡充、ページネーションの追加を行う」への対応。
  // タグ候補は子Issueも含め（子をフィルタ対象にするため）、アーカイブ表示設定に従う。
  const issuesForTagOptions = issues.filter((i) => showArchived || !i.archived);
  const allTags = Array.from(new Set(issuesForTagOptions.flatMap((i) => i.tags))).sort((a, b) => a.localeCompare(b, "ja"));
  const filteredIssues = issues
    .filter((i) => !i.parentId)
    .filter(matchesIssueFilters)
    .slice()
    .sort(compareIssuesByPriority);
  const filteredChildIssues = issues
    .filter((i) => !!i.parentId)
    .filter(matchesIssueFilters)
    .slice()
    .sort(compareIssuesByPriority);
  const boardIssues = showChildIssuesOnBoard
    ? [...filteredIssues, ...filteredChildIssues].slice().sort(compareIssuesByPriority)
    : filteredIssues;
  const issuesPagination = usePagination(filteredIssues, ISSUES_PAGE_SIZE);

  function toggleIssueExpanded(issueId: string) {
    setExpandedIssueIds((prev) => {
      const next = new Set(prev);
      if (next.has(issueId)) next.delete(issueId);
      else next.add(issueId);
      return next;
    });
  }
  const runsPagination = usePagination(unlinkedRuns, RUNS_PAGE_SIZE);
  // Action Itemsビュー: フィルタ済み介入のうち「次の一手」があるものだけ（優先度順は filteredIssues と同じ）。
  const actionRows = filteredIssues.flatMap((issue) => {
    const next = issueNextAction(issue);
    if (!next) return [];
    return [
      {
        issueId: issue.id,
        issueTitle: issue.title,
        priority: (issue.priority ?? "normal") as IssuePriority,
        status: issue.status,
        itemId: next.id,
        itemText: next.text,
      },
    ];
  });
  const actionsPagination = usePagination(actionRows, ISSUES_PAGE_SIZE);

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
          themeId: issueThemeId || undefined,
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
      setIssueThemeId("");
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

  // ユーザー指摘対応。Lead Agentは「何でも相談」の相手であり、Dashboard側（P0-2対応）と
  // 同じく即Issue化はせず/chatへ寄せる。決まった介入である専門エージェントのrunだけ
  // ここから直接Issue化する。
  async function handlePromoteRun(run: AgentRun) {
    if (run.agentName === "Lead Agent") {
      router.push(`/chat?runId=${run.id}`);
      return;
    }
    setPromoteError(null);
    try {
      const res = await fetch("/api/issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: truncateForTitle(runFallbackTitle(run)), agentRunId: run.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Issue化に失敗しました");
      await Promise.all([refreshIssues(), refreshRuns()]);
      router.push(`/issues/${data.issue.id}`);
    } catch (err) {
      setPromoteError((err as Error).message);
    }
  }

  async function handleMoveFocus(issueId: string, direction: "up" | "down") {
    setFocusMovingId(issueId);
    try {
      const res = await fetch(`/api/issues/${issueId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ moveFocus: direction }),
      });
      if (res.ok) await refreshIssues();
    } finally {
      setFocusMovingId(null);
    }
  }

  async function handleBulkUpdateTriage() {
    setTriageSubmitting(true);
    setTriageError(null);
    setTriageMessage(null);
    try {
      const res = await fetch("/api/issues/triage/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applySuggested: true, focusLimit: 5 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "評価の一括更新に失敗しました");
      const focusN = Array.isArray(data.focusCandidates) ? data.focusCandidates.length : 0;
      const changeN = Array.isArray(data.changes) ? data.changes.length : 0;
      const counts = data.counts ?? { focus: 0, normal: 0, parked: 0 };
      setTriagePreview({
        counts,
        focusCandidates: Array.isArray(data.focusCandidates) ? data.focusCandidates : [],
        changes: Array.isArray(data.changes) ? data.changes : [],
      });
      setTriageMessage(
        changeN > 0
          ? `評価を更新し、優先度を ${changeN} 件反映しました（フォーカス ${focusN} 件）。例外だけ個別に直してください。`
          : `評価を更新しました。優先度の変更はありません（提案: 🔥${counts.focus ?? 0} / ➖${counts.normal ?? 0} / 🅿️${counts.parked ?? 0}）。`,
      );
      await refreshIssues();
    } catch (err) {
      setTriageError((err as Error).message);
    } finally {
      setTriageSubmitting(false);
    }
  }

  async function handleSuggestStrategyLinks() {
    setLinkSuggesting(true);
    setLinkError(null);
    try {
      const res = await fetch("/api/issues/link/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "戦略リンク提案に失敗しました");
      setLinkPreview({
        suggestions: Array.isArray(data?.suggestions) ? data.suggestions : [],
        source: data?.source === "cloud" ? "cloud" : "heuristic",
        fallbackReason: typeof data?.fallbackReason === "string" ? data.fallbackReason : undefined,
      });
    } catch (err) {
      setLinkError((err as Error).message);
    } finally {
      setLinkSuggesting(false);
    }
  }

  async function handleAdoptStrategyLink(s: IssueStrategyLinkSuggestion) {
    setLinkApplyingId(s.issueId);
    setLinkError(null);
    try {
      const res = await fetch(`/api/issues/${s.issueId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          themeId: s.themeId,
          keyResultId: s.keyResultId,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "リンクの採用に失敗しました");
      }
      await refreshIssues();
      setLinkPreview((prev) =>
        prev
          ? { ...prev, suggestions: prev.suggestions.filter((x) => x.issueId !== s.issueId) }
          : null,
      );
    } catch (err) {
      setLinkError((err as Error).message);
    } finally {
      setLinkApplyingId(null);
    }
  }

  async function handleCompleteActionItem(issueId: string, itemId: string) {
    const key = `${issueId}:${itemId}`;
    setCompletingActionKey(key);
    try {
      const res = await fetch(`/api/issues/${issueId}/action-items/${itemId}`, { method: "PATCH" });
      if (res.ok) await refreshIssues();
    } finally {
      setCompletingActionKey(null);
    }
  }

  return (
    <IdResolveProvider openIssueInPeek={peek.open}>
    <div className={styles.screen}>
      {/* 改修依頼「セクションの区切りがわかりにくい」対応。ページ全体がフラットな
          .screenの直下に並んでいたため、表形式化でセクション同士が地続きに見えて
          いた。2つのセクションをそれぞれ.panelで囲み、カードとして区切る。 */}
      <div className={styles.panel}>
        <div className={styles.detailHeader}>
          <div>
            <h2 style={{ margin: 0 }}>進行中の介入ポートフォリオ</h2>
            <p className={styles.subtitle} style={{ marginTop: 4 }}>
              実装タスク箱ではなく、型・関連チーム・今期のKRに紐づく「介入」の一覧です。優先度（フォーカス／通常／保留）とフォーカス順で、今週〜今月の見通しと今日の順を揃えます。
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <div className={styles.tabs} style={{ margin: 0 }}>
              <button
                type="button"
                className={`${styles.tabBtn} ${viewMode === "list" ? styles.tabBtnActive : ""}`}
                onClick={() => setViewMode("list")}
              >
                リスト
              </button>
              <button
                type="button"
                className={`${styles.tabBtn} ${viewMode === "board" ? styles.tabBtnActive : ""}`}
                onClick={() => setViewMode("board")}
              >
                ボード
              </button>
              <button
                type="button"
                className={`${styles.tabBtn} ${viewMode === "actions" ? styles.tabBtnActive : ""}`}
                onClick={() => setViewMode("actions")}
                title="各介入の次の一手を横断表示"
              >
                アクション
              </button>
            </div>
            <button className={styles.primaryBtn} style={{ width: "auto" }} onClick={() => setDialogOpen(true)}>
              ＋ 新しいIssue
            </button>
          </div>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14, margin: "8px 0" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8125rem", color: "var(--text-muted)" }}>
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            アーカイブ済み（追わない）も表示する（{archivedCount}件）
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8125rem", color: "var(--text-muted)" }}>
            <input type="checkbox" checked={incompleteOnly} onChange={(e) => setIncompleteOnly(e.target.checked)} />
            Why/What/How未整理のみ
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8125rem", color: "var(--text-muted)" }}>
            ステータス:
            <Select
              value={statusFilter}
              onChange={(v) => setStatusFilter(v as "open" | "active" | "all" | IssueStatus)}
              options={[
                { value: "open", label: "完了・アーカイブ以外" },
                { value: "active", label: "進行中・Waiting" },
                { value: "all", label: "すべて" },
                ...Object.entries(ISSUE_STATUS_META).map(([value, meta]) => ({
                  value,
                  label: `${meta.icon} ${meta.label}`,
                })),
              ]}
              style={{ minWidth: 180 }}
            />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8125rem", color: "var(--text-muted)" }}>
            優先度:
            <Select
              value={priorityFilter}
              onChange={(v) => setPriorityFilter(v as "all" | IssuePriority)}
              options={[
                { value: "all", label: "すべて" },
                ...Object.entries(ISSUE_PRIORITY_META).map(([value, meta]) => ({
                  value,
                  label: `${meta.icon} ${meta.label}`,
                })),
              ]}
              style={{ minWidth: 140 }}
            />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8125rem", color: "var(--text-muted)" }}>
            タグで絞り込み:
            <Select
              value={tagFilter}
              onChange={setTagFilter}
              options={[{ value: "", label: "すべて" }, ...allTags.map((tag) => ({ value: tag, label: `#${tag}` }))]}
              style={{ minWidth: 160 }}
            />
          </label>
          {viewMode === "board" && (
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8125rem", color: "var(--text-muted)" }}>
              <input
                type="checkbox"
                checked={showChildIssuesOnBoard}
                onChange={(e) => setShowChildIssuesOnBoard(e.target.checked)}
              />
              子Issueも表示する（{filteredChildIssues.length}件）
            </label>
          )}
        </div>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 10,
            margin: "4px 0 12px",
            padding: "10px 12px",
            border: "1px solid var(--border)",
            borderRadius: 8,
            background: "var(--bg-muted, color-mix(in srgb, var(--border) 12%, transparent))",
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: "0.875rem", fontWeight: 600 }}>Issueの評価を一括更新</div>
            <p className={styles.subtitle} style={{ margin: "2px 0 0" }}>
              親 Issue を再採点し、フォーカス／通常／保留へ反映します（フォーカスは上位5件）。
            </p>
          </div>
          <button
            type="button"
            className={styles.btnOutline}
            style={{ flexShrink: 0 }}
            disabled={triageSubmitting}
            onClick={handleBulkUpdateTriage}
            title="全親 Issue を再採点し、提案どおり優先度へ反映します"
          >
            {triageSubmitting ? "更新中…" : "評価を一括更新"}
          </button>
        </div>
        {(() => {
          const unlinkedStrategyCount = issues.filter(
            (i) => !i.archived && i.status !== "done" && !i.parentId && isIssueStrategyUnlinked(i),
          ).length;
          if (unlinkedStrategyCount === 0) return null;
          return (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 10,
                margin: "0 0 12px",
                padding: "10px 12px",
                border: "1px solid var(--border)",
                borderRadius: 8,
                background: "var(--bg-muted, color-mix(in srgb, var(--border) 12%, transparent))",
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: "0.875rem", fontWeight: 600 }}>
                  戦略未接続をAIで見直す（{unlinkedStrategyCount}）
                </div>
                <p className={styles.subtitle} style={{ margin: "2px 0 0" }}>
                  テーマ / Key Result 未接続の親 Issue へ紐付け案を出します（採用まで反映しません）。
                </p>
              </div>
              <button
                type="button"
                className={styles.btnOutline}
                style={{ flexShrink: 0 }}
                disabled={linkSuggesting || (themes.filter((t) => t.status === "adopted").length === 0 && objectives.length === 0)}
                onClick={handleSuggestStrategyLinks}
                title="戦略未接続の親 Issue へ、テーマ / KR の紐付けをAIが提案します"
              >
                {linkSuggesting ? "提案中…" : "🔗 戦略リンクを提案"}
              </button>
            </div>
          );
        })()}
        {linkError && (
          <p className={styles.errorText} role="alert">
            {linkError}
          </p>
        )}
        {linkPreview && (
          <IssueStrategyLinkSuggestPanel
            suggestions={linkPreview.suggestions}
            source={linkPreview.source}
            fallbackReason={linkPreview.fallbackReason}
            applyingId={linkApplyingId}
            onAdopt={handleAdoptStrategyLink}
            onDismiss={() => setLinkPreview(null)}
            onDismissOne={(issueId) =>
              setLinkPreview((prev) =>
                prev
                  ? { ...prev, suggestions: prev.suggestions.filter((x) => x.issueId !== issueId) }
                  : null,
              )
            }
          />
        )}
        {triageError && (
          <p className={styles.errorText} role="alert">
            {triageError}
          </p>
        )}
        {triageMessage && <p className={styles.subtitle}>{triageMessage}</p>}
        {triagePreview && (
          <div
            style={{
              marginBottom: 12,
              padding: 10,
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: "0.8125rem",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
              <strong>更新結果</strong>
              <button type="button" className={styles.detailToggle} onClick={() => setTriagePreview(null)}>
                閉じる
              </button>
            </div>
            <p className={styles.subtitle} style={{ margin: "4px 0 8px" }}>
              提案内訳: 🔥フォーカス {triagePreview.counts.focus} · ➖通常 {triagePreview.counts.normal} · 🅿️保留{" "}
              {triagePreview.counts.parked}
              （フォーカスは上位 {triagePreview.focusCandidates.length} 件）
            </p>
            {triagePreview.focusCandidates.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <div className={styles.fieldCaption}>フォーカスになった Issue（評価軸の高い順）</div>
                <ul style={{ margin: "4px 0 0", padding: 0, listStyle: "none" }}>
                  {triagePreview.focusCandidates.map((c) => (
                    <li key={c.id} style={{ marginBottom: 8 }}>
                      <button type="button" className={styles.tableRowLink} onClick={() => peek.open(c.id)}>
                        {c.title}
                      </button>
                      <IssueTriageAxes
                        triage={{
                          costOfDelay: c.costOfDelay,
                          effort: c.effort,
                          blastRadius: c.blastRadius,
                          confidence: c.confidence,
                        }}
                        compact
                      />
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {triagePreview.changes.length > 0 ? (
              <div>
                <div className={styles.fieldCaption}>優先度が変わった Issue（{triagePreview.changes.length}）</div>
                <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>
                  {triagePreview.changes.map((c) => (
                    <li key={c.issueId} style={{ marginBottom: 2 }}>
                      <button type="button" className={styles.tableRowLink} onClick={() => peek.open(c.issueId)}>
                        {c.title}
                      </button>
                      <span className={styles.tableMuted}>
                        {" "}
                        {c.fromLabel} → {c.toLabel}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className={styles.subtitle} style={{ margin: 0 }}>
                実際に優先度が変わった Issue はありません。
              </p>
            )}
          </div>
        )}

        {viewMode === "board" ? (
          <IssueBoard
            issues={boardIssues}
            allIssues={issues}
            now={now}
            staleInterventionDays={rules.staleInterventionDays}
            onSelect={(id) => peek.open(id)}
          />
        ) : viewMode === "actions" ? (
          <>
            <p className={styles.subtitle} style={{ margin: "0 0 10px" }}>
              各介入の「次の一手」だけを優先度順に表示します。完了すると次の未完了が繰り上がります。あとでやる一覧は Issue 詳細で確認できます。
            </p>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>完了</th>
                    <th>次の一手</th>
                    <th>優先度</th>
                    <th>ステータス</th>
                    <th>Issue</th>
                  </tr>
                </thead>
                <tbody>
                  {actionRows.length === 0 && (
                    <tr>
                      <td colSpan={5} className={styles.tableEmpty}>
                        {!issuesLoaded
                          ? "読み込み中…"
                          : "条件に一致する次の一手はありません（未設定の介入はリストで確認してください）。"}
                      </td>
                    </tr>
                  )}
                  {actionsPagination.pageItems.map((row) => {
                    const key = `${row.issueId}:${row.itemId}`;
                    return (
                      <tr key={key}>
                        <td>
                          <input
                            type="checkbox"
                            checked={false}
                            disabled={completingActionKey === key}
                            aria-label={`「${row.itemText}」を完了`}
                            onChange={() => void handleCompleteActionItem(row.issueId, row.itemId)}
                          />
                        </td>
                        <td>
                          <button type="button" className={styles.tableRowLink} onClick={() => peek.open(row.issueId)}>
                            {row.itemText}
                          </button>
                        </td>
                        <td>
                          <IssuePriorityBadge priority={row.priority} />
                        </td>
                        <td>
                          <IssueStatusBadge status={row.status} />
                        </td>
                        <td>
                          <button type="button" className={styles.tableRowLink} onClick={() => peek.open(row.issueId)}>
                            {row.issueTitle}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>タイトル</th>
                <th>ステータス</th>
                <th>優先度/リスク</th>
                <th>次の一手</th>
                <th>型・関連</th>
                <th>Why/What/How</th>
                <th>進捗</th>
                <th>最終判断</th>
              </tr>
            </thead>
            <tbody>
              {filteredIssues.length === 0 && (
                <tr>
                  <td colSpan={8} className={styles.tableEmpty}>
                    {!issuesLoaded ? "読み込み中…" : "条件に一致するIssueはありません。"}
                  </td>
                </tr>
              )}
              {issuesPagination.pageItems.flatMap((issue) => {
                const linkedRun = runs.find((r) => r.id === issue.agentRunId);
                const childIssuesOfRow = issues.filter((i) => i.parentId === issue.id);
                const expandableChildren = childIssuesOfRow.filter((c) => showArchived || !c.archived);
                const visibleChildren = expandableChildren.filter(matchesIssueFilters).slice().sort(compareIssuesByPriority);
                const charterCount = charterFilledCount(issue.charter);
                const childCount = expandableChildren.length;
                const progress = issueProgress(issue, childIssuesOfRow);
                const stalled = isIssueStalled(issue, now, rules.staleInterventionDays);
                const interventionTypes = issue.tags.filter((t) => INTERVENTION_TYPE_LABELS.has(t));
                const topicTags = issue.tags.filter((t) => !INTERVENTION_TYPE_LABELS.has(t));
                const teamName = issue.teamId ? teams.find((t) => t.id === issue.teamId)?.name : undefined;
                const themeTitle = issue.themeId ? themes.find((t) => t.id === issue.themeId)?.title : undefined;
                const krLabel = issue.keyResultId ? keyResultLabel(issue.keyResultId) : undefined;
                const strategyUnlinked = isIssueStrategyUnlinked(issue);
                const nextAction = issueNextAction(issue);
                const priority = issue.priority ?? "normal";
                const expanded = expandedIssueIds.has(issue.id);

                const parentRow = (
                  <tr key={issue.id} style={issue.archived ? { opacity: 0.6 } : undefined}>
                    <td>
                      <div className={styles.issueTitleCell}>
                        {childCount > 0 ? (
                          <button
                            type="button"
                            className={styles.issueTreeToggle}
                            aria-expanded={expanded}
                            aria-label={expanded ? "子Issueを折りたたむ" : "子Issueを展開する"}
                            onClick={() => toggleIssueExpanded(issue.id)}
                          >
                            {expanded ? "▼" : "▶"}
                          </button>
                        ) : (
                          <span className={styles.issueTreeToggleSpacer} aria-hidden />
                        )}
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <button className={styles.tableRowLink} onClick={() => peek.open(issue.id)}>
                            {issue.title}
                          </button>
                          <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                            {linkedRun && <StatusBadge status={linkedRun.status} stale={staleRunIds.has(linkedRun.id)} />}
                            {issue.archived && <span className={styles.tableMuted}>🗄 アーカイブ済み</span>}
                            {childCount > 0 && (
                              <span className={styles.tableMuted}>
                                🧩 子Issue: {childCount}件
                                {expanded && visibleChildren.length !== childCount ? `（表示 ${visibleChildren.length}）` : ""}
                              </span>
                            )}
                            {stalled && <span className={styles.tableMuted}>⏳ 停滞中</span>}
                            {issue.sourceJournalId && <span className={styles.tableMuted}>📝 Journalから</span>}
                            {issue.sourceRunId && <span className={styles.tableMuted}>💬 相談から</span>}
                          </div>
                          {topicTags.length > 0 && (
                            <div className={styles.tagRow} style={{ marginTop: 4 }}>
                              {topicTags.map((tag) => (
                                <span key={tag} className={`${styles.tag} ${styles.tagTopic}`}>
                                  #{tag}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td>
                      <IssueStatusBadge status={issue.status} />
                    </td>
                    <td>
                      <IssuePriorityBadge priority={priority} />
                      {issue.triage && <IssueTriageAxes triage={issue.triage} compact />}
                      {issue.triage?.suggestedPriority &&
                        issue.triage.suggestedPriority !== priority && (
                          <div
                            className={styles.tableMuted}
                            style={{ marginTop: 4, color: "var(--warning, #b45309)", fontSize: "0.7rem" }}
                            title="評価上の提案と、いまの優先度が違います（手動変更の可能性）"
                          >
                            提案: {ISSUE_PRIORITY_META[issue.triage.suggestedPriority].icon}{" "}
                            {ISSUE_PRIORITY_META[issue.triage.suggestedPriority].label}
                          </div>
                        )}
                      {priority === "focus" && (
                        <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                          <button
                            type="button"
                            className={styles.btnOutline}
                            style={{ fontSize: "0.7rem", padding: "1px 6px" }}
                            disabled={focusMovingId === issue.id}
                            onClick={() => handleMoveFocus(issue.id, "up")}
                            title="フォーカス順を前へ"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className={styles.btnOutline}
                            style={{ fontSize: "0.7rem", padding: "1px 6px" }}
                            disabled={focusMovingId === issue.id}
                            onClick={() => handleMoveFocus(issue.id, "down")}
                            title="フォーカス順を後へ"
                          >
                            ↓
                          </button>
                        </div>
                      )}
                    </td>
                    <td className={styles.tableMuted} style={{ maxWidth: 220 }}>
                      {nextAction ? (
                        <span title={nextAction.text}>{nextAction.text.length > 48 ? `${nextAction.text.slice(0, 48)}…` : nextAction.text}</span>
                      ) : (
                        <span style={{ opacity: 0.7 }}>未設定</span>
                      )}
                    </td>
                    {/* docs/em_human_story_and_ux.md P1-7対応。型・関連チーム・今期のKRを一覧の時点で
                        見せ、「実装タスク箱」ではなく「介入のポートフォリオ」として読めるようにする。 */}
                    <td>
                      {interventionTypes.map((t) => (
                        <div key={t} style={{ marginBottom: 4 }}>
                          <span className={`${styles.tag} ${styles.tagPerson}`}>🎯 {t}</span>
                        </div>
                      ))}
                      {teamName && (
                        <div className={styles.tableMuted} title="関連チーム">
                          👥 {teamName}
                        </div>
                      )}
                      {themeTitle && (
                        <div className={styles.tableMuted} title="紐付いているテーマ">
                          🎯 {themeTitle}
                        </div>
                      )}
                      {krLabel && (
                        <div className={styles.tableMuted} title="紐付いているKey Result">
                          📈 {krLabel}
                        </div>
                      )}
                      {strategyUnlinked && (
                        <div className={styles.tableMuted} title="テーマ / Key Result 未接続" style={{ color: "var(--warning, #b45309)" }}>
                          ⚠ 戦略未接続
                        </div>
                      )}
                    </td>
                    <td>
                      <span className={charterCount === 3 ? styles.charterBadgeReady : styles.charterBadgeWarn}>
                        {charterCount === 3 ? "✅" : "❓"} {charterCount}/3
                      </span>
                    </td>
                    <td>
                      <ProgressBar done={progress.done} total={progress.total} />
                    </td>
                    <td className={styles.tableMuted} title="最終更新日">
                      {formatRelativeDays(issue.updatedAt, now)}
                    </td>
                  </tr>
                );

                if (!expanded || visibleChildren.length === 0) return [parentRow];

                const childRows = visibleChildren.map((child) => {
                  const childLinkedRun = runs.find((r) => r.id === child.agentRunId);
                  const childCharterCount = charterFilledCount(child.charter);
                  const childProgress = issueProgress(child, []);
                  const childInterventionTypes = child.tags.filter((t) => INTERVENTION_TYPE_LABELS.has(t));
                  const childTopicTags = child.tags.filter((t) => !INTERVENTION_TYPE_LABELS.has(t));
                  const childTeamName = child.teamId ? teams.find((t) => t.id === child.teamId)?.name : undefined;
                  const childKrLabel = child.keyResultId ? keyResultLabel(child.keyResultId) : undefined;
                  const childNextAction = issueNextAction(child);
                  const childPriority = child.priority ?? "normal";
                  return (
                    <tr
                      key={child.id}
                      className={styles.issueChildRow}
                      style={child.archived ? { opacity: 0.6 } : undefined}
                    >
                      <td>
                        <div className={styles.issueTitleCell}>
                          <span className={styles.issueTreeToggleSpacer} aria-hidden />
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <button className={styles.tableRowLink} onClick={() => peek.open(child.id)}>
                              {child.title}
                            </button>
                            <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                              <span className={styles.tableMuted}>↳ {issue.title}</span>
                              {childLinkedRun && (
                                <StatusBadge status={childLinkedRun.status} stale={staleRunIds.has(childLinkedRun.id)} />
                              )}
                              {child.archived && <span className={styles.tableMuted}>🗄 アーカイブ済み</span>}
                              {child.sourceJournalId && <span className={styles.tableMuted}>📝 Journalから</span>}
                              {child.sourceRunId && <span className={styles.tableMuted}>💬 相談から</span>}
                            </div>
                            {childTopicTags.length > 0 && (
                              <div className={styles.tagRow} style={{ marginTop: 4 }}>
                                {childTopicTags.map((tag) => (
                                  <span key={tag} className={`${styles.tag} ${styles.tagTopic}`}>
                                    #{tag}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td>
                        <IssueStatusBadge status={child.status} />
                      </td>
                      <td>
                        <IssuePriorityBadge priority={childPriority} />
                      </td>
                      <td className={styles.tableMuted} style={{ maxWidth: 220 }}>
                        {childNextAction ? (
                          <span title={childNextAction.text}>
                            {childNextAction.text.length > 48 ? `${childNextAction.text.slice(0, 48)}…` : childNextAction.text}
                          </span>
                        ) : (
                          <span style={{ opacity: 0.7 }}>未設定</span>
                        )}
                      </td>
                      <td>
                        {childInterventionTypes.map((t) => (
                          <div key={t} style={{ marginBottom: 4 }}>
                            <span className={`${styles.tag} ${styles.tagPerson}`}>🎯 {t}</span>
                          </div>
                        ))}
                        {childTeamName && (
                          <div className={styles.tableMuted} title="関連チーム">
                            👥 {childTeamName}
                          </div>
                        )}
                        {childKrLabel && (
                          <div className={styles.tableMuted} title="紐付いているKey Result">
                            📈 {childKrLabel}
                          </div>
                        )}
                      </td>
                      <td>
                        <span className={childCharterCount === 3 ? styles.charterBadgeReady : styles.charterBadgeWarn}>
                          {childCharterCount === 3 ? "✅" : "❓"} {childCharterCount}/3
                        </span>
                      </td>
                      <td>
                        <ProgressBar done={childProgress.done} total={childProgress.total} />
                      </td>
                      <td className={styles.tableMuted} title="最終更新日">
                        {formatRelativeDays(child.updatedAt, now)}
                      </td>
                    </tr>
                  );
                });

                return [parentRow, ...childRows];
              })}
            </tbody>
          </table>
        </div>
        )}
        {viewMode === "list" && (
        <PaginationControls
          page={issuesPagination.page}
          totalPages={issuesPagination.totalPages}
          total={issuesPagination.total}
          rangeStart={issuesPagination.rangeStart}
          rangeEnd={issuesPagination.rangeEnd}
          onChange={issuesPagination.setPage}
        />
        )}
        {viewMode === "actions" && (
        <PaginationControls
          page={actionsPagination.page}
          totalPages={actionsPagination.totalPages}
          total={actionsPagination.total}
          rangeStart={actionsPagination.rangeStart}
          rangeEnd={actionsPagination.rangeEnd}
          onChange={actionsPagination.setPage}
        />
        )}
      </div>

      {/* 改修依頼対応。この一覧はエージェント名＋タスク要約だけで情報量が少なく、
          カラムに分けるほどの構造が無いため表形式には戻さずカードのままにする。 */}
      <div className={styles.panel}>
        <h3 style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "0 0 6px" }}>Issue未起票のAgent Run</h3>
        <p className={styles.subtitle} style={{ marginBottom: 10 }}>
          Lead Agentは「何でも相談」に移動します。専門エージェントはクリックするとIssue化され、詳細画面へ移動します。
        </p>
        {promoteError && (
          <p className={styles.errorText} role="alert">
            {promoteError}
          </p>
        )}
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
              <div className={styles.runItemTask}>{runFallbackTitle(run)}</div>
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
      </div>

      {dialogOpen && (
        <Modal title="新しいIssueを起票" size="wide" onClose={() => setDialogOpen(false)}>
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
              <Select
                value={issueRunId}
                onChange={setIssueRunId}
                options={[
                  { value: "", label: "なし" },
                  ...runs.map((r) => ({ value: r.id, label: `[${r.agentName}] ${r.task.slice(0, 30)}` })),
                ]}
                style={{ display: "block", width: "100%" }}
              /></label>
            </div>

            <div className={styles.field}>
              <label>関連チーム（任意。そのチームのMission/制約を前提として注入する）
              <Select
                value={issueTeamId}
                onChange={setIssueTeamId}
                options={[
                  { value: "", label: "なし" },
                  ...teams.filter((t) => !t.archived).map((t) => ({ value: t.id, label: t.name })),
                ]}
                style={{ display: "block", width: "100%" }}
              /></label>
            </div>

            <div className={styles.field}>
              <label>紐付けるテーマ（任意。今期の焦点に効く介入か）
              <Select
                value={issueThemeId}
                onChange={setIssueThemeId}
                options={[
                  { value: "", label: "なし" },
                  ...themes.filter((t) => t.status === "adopted").map((t) => ({ value: t.id, label: t.title })),
                ]}
                style={{ display: "block", width: "100%" }}
              /></label>
            </div>

            <div className={styles.field}>
              <label>紐付けるKey Result（任意。「今期何を解いているか」の一本線を作る）
              <Select
                value={issueKeyResultId}
                onChange={setIssueKeyResultId}
                options={[
                  { value: "", label: "なし" },
                  ...objectives.flatMap((o) => o.keyResults.map((kr) => ({ value: kr.id, label: `${o.title} ＞ ${kr.title}` }))),
                ]}
                style={{ display: "block", width: "100%" }}
              /></label>
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

      {peek.id &&
        (() => {
          const peekedIssue = issues.find((i) => i.id === peek.id);
          if (!peekedIssue) return null;
          return (
            <SlideOver title={peekedIssue.title} detailHref={`/issues/${peekedIssue.id}`} onClose={peek.close}>
              <IssueDetailContent id={peekedIssue.id} />
            </SlideOver>
          );
        })()}
    </div>
    </IdResolveProvider>
  );
}
