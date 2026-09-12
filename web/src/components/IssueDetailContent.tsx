"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import styles from "@/app/page.module.css";
import { CopilotChat, ExecutionState, StatusBadge, type AgentRun, type SuggestedSubIssue } from "@/components/RunDetail";
import { OriginTrace } from "@/components/OriginTrace";
import { Modal } from "@/components/Modal";
import { ProgressBar } from "@/components/ProgressBar";
import { IssueStatusBadge, IssueStatusSelector, IssuePrioritySelector, IssueTriageAxes } from "@/components/IssueStatus";
import { IssueStrategyLinkSuggestPanel } from "@/components/HierarchyLinkSuggestPanel";
import { MarkdownView } from "@/components/MarkdownView";
import { Select } from "@/components/Select";
import { PendingAgentStartNotice } from "@/components/PendingAgentStartNotice";
import { useEntityHistory, useIssue, useIssueImpact, useIssues, useObjectives, useRuns, useSettingsRules, useTeams, useThemes } from "@/lib/hooks";
import { useNameCandidateConfirm } from "@/lib/useNameCandidateConfirm";
import {
  ACTION_ITEM_VS_SUB_ISSUE_HELP,
  INTERVENTION_TYPES,
  ISSUE_PRIORITY_META,
  charterFilledCount,
  isIssueStalled,
  isIssueStrategyUnlinked,
  issueBacklogActionItems,
  issueNextAction,
  issueProgress,
  isRunStale,
  type IssueCharter,
  type IssuePriority,
  type IssueStatus,
  type IssueStrategyLinkSuggestion,
} from "@/lib/types";
import { journalExcerptFromTask, resolveSourceConsultRun } from "@/lib/origin-trace";

// docs/em_ui_ux_issue.md 7節対応。閲覧モードのWhy/What/Howのラベル（編集モードのlabel文言と揃える）。
const CHARTER_VIEW_FIELDS: { key: keyof IssueCharter; label: string }[] = [
  { key: "why", label: "Why（生む価値・誰のため・なぜ今か）" },
  { key: "what", label: "What（何を・どこまで・どのくらい・完了の定義）" },
  { key: "how", label: "How（どのように実現するか・前提や制約）" },
];

// docs/em_ui_ux_issue.md「一覧⇄詳細をサイドピークで」対応。中身をidベースの
// コンポーネントに切り出し、フルページ（issues/[id]/page）と一覧側のSlideOverの
// 両方から同じロジック・JSXを使う。page.tsx から named export すると Next.js の
// 生成型チェックに弾かれるため、コンポーネントファイルへ分離している。
export function IssueDetailContent({ id }: { id: string }) {
  const router = useRouter();
  const { issue, sourceJournals, issueLoaded, refreshIssue } = useIssue(id);
  const { history } = useEntityHistory("issue", id);
  const { issues, refreshIssues } = useIssues();
  const { runs, pendingAgentStarts, refreshRuns } = useRuns();
  const { fetchWithNameConfirm, nameCandidateDialog } = useNameCandidateConfirm();
  const { objectives } = useObjectives();
  const { teams } = useTeams();
  const { themes } = useThemes();
  // docs/memo.md「L」＋ docs/issue_tracker_contract.md §6。チーム紐付きIssueで介入前後比較を出す
  // （完了窓は status=done／doneAt。進行中も暫定比較を返す）。
  const { impact, impactLoaded } = useIssueImpact(id, !!issue?.teamId);
  const { rules } = useSettingsRules();
  // eslint-disable-next-line react-hooks/purity -- 「停滞中」表示にのみ使う
  const now = Date.now();
  const staleRunIds = new Set(
    runs.filter((r) => isRunStale(r.status, r.updatedAt, rules.agentStaleAfterSeconds)).map((r) => r.id),
  );

  // 親子関係は1階層のみ。子（parentIdあり）は自分の子を持てないので
  // 「サブIssueを追加」は表示せず、「上位Issueを作る」も既に親を持つなら表示しない。
  const parentIssue = issue?.parentId ? issues.find((i) => i.id === issue.parentId) ?? null : null;
  const childIssues = issue ? issues.filter((i) => i.parentId === issue.id) : [];

  const [hierarchyDialog, setHierarchyDialog] = useState<"child" | "parent" | null>(null);
  const [hTitle, setHTitle] = useState("");
  const [hWhy, setHWhy] = useState("");
  const [hWhat, setHWhat] = useState("");
  const [hHow, setHHow] = useState("");
  const [hSubmitting, setHSubmitting] = useState(false);
  const [hError, setHError] = useState<string | null>(null);

  function closeHierarchyDialog() {
    setHierarchyDialog(null);
    setHTitle("");
    setHWhy("");
    setHWhat("");
    setHHow("");
    setHError(null);
  }

  async function handleCreateChild(e: React.FormEvent) {
    e.preventDefault();
    if (!issue || !hTitle.trim()) return;
    setHSubmitting(true);
    setHError(null);
    try {
      const { res, data } = await fetchWithNameConfirm(
        "/api/issues",
        {
          method: "POST",
          body: { title: hTitle, why: hWhy, what: hWhat, how: hHow, parentId: issue.id },
        },
        "保存する",
      );
      if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? "サブIssueの作成に失敗しました");
      // 改修依頼「一覧と入力の分離によるアクション→一覧のフローの分断」対応。以前は
      // 作成直後に新しいサブIssue自身の詳細画面へ遷移しており、いま開いていた親Issueの
      // 「サブIssue（分解した子Issue）」一覧にそのまま反映される様子を見られなかった。
      // 遷移せずダイアログを閉じるだけにし、一覧側の更新を即座に反映する
      // （Why/What/Howを詰めたい場合は一覧からそのサブIssueへ改めて入れる）。
      closeHierarchyDialog();
      await refreshIssues();
    } catch (err) {
      if ((err as Error).message !== "人名候補の確認をキャンセルしました") {
        setHError((err as Error).message);
      }
    } finally {
      setHSubmitting(false);
    }
  }

  async function handleCreateParent(e: React.FormEvent) {
    e.preventDefault();
    if (!issue || !hTitle.trim()) return;
    setHSubmitting(true);
    setHError(null);
    try {
      const { res, data } = await fetchWithNameConfirm(
        `/api/issues/${issue.id}/parent`,
        { method: "POST", body: { title: hTitle, why: hWhy, what: hWhat, how: hHow } },
        "保存する",
      );
      if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? "上位Issueの作成に失敗しました");
      closeHierarchyDialog();
      await refreshIssues();
      router.push(`/issues/${(data as { issue: { id: string } }).issue.id}`);
    } catch (err) {
      if ((err as Error).message !== "人名候補の確認をキャンセルしました") {
        setHError((err as Error).message);
      }
    } finally {
      setHSubmitting(false);
    }
  }

  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [deciding, setDeciding] = useState(false);
  const [decideError, setDecideError] = useState<string | null>(null);
  const [actionItemText, setActionItemText] = useState("");
  // ユーザー依頼「EMがIssueに対して考えたこと・取ったアクション・結果を反映する」対応。
  const [logText, setLogText] = useState("");
  const [logPending, setLogPending] = useState(false);
  const [logPendingError, setLogPendingError] = useState<{ message: string; retry: () => void } | null>(null);

  // docs/em_human_story_and_ux.md 改修依頼「Issueのタイトルを変更できるようにする」対応。
  // titleEditingはEMのクリックで開始する（issueの非同期取得を待つ必要はなく、編集ボタン
  // 自体issueが揃ってから初めて描画されるため、レンダー中の同期は不要）。
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [titleError, setTitleError] = useState<string | null>(null);
  // Journalと同様、ローカルNERを含む保存完了をフォーム上で待たず、対象箇所にスピナーを出す。
  const [titlePending, setTitlePending] = useState(false);
  const [titlePendingError, setTitlePendingError] = useState<{ message: string; retry: () => void } | null>(null);

  // docs/em_ui_ux_issue.md 7節「閲覧ビューと編集ビューの分離」対応。titleEditingと同じ
  // パターン。textarea群は非制御（defaultValue）で、charterEditingがfalseの間は
  // アンマウントされているため、キャンセル時に個別のdraft巻き戻しは不要
  // （再度開けば必ずissue.charterの現在値から始まる）。
  const [charterEditing, setCharterEditing] = useState(false);
  const [charterError, setCharterError] = useState<string | null>(null);
  const [charterPending, setCharterPending] = useState(false);
  const [charterPendingError, setCharterPendingError] = useState<{ message: string; retry: () => void } | null>(null);
  // SettingsのisDirtyと同じ。非制御のWhy/What/How・タグでも、変更がないときは保存を
  // 非アクティブにするため、入力のたびにサーバー最新値と突き合わせる。
  const [charterDirty, setCharterDirty] = useState(false);
  const whyRef = useRef<HTMLTextAreaElement | null>(null);
  const whatRef = useRef<HTMLTextAreaElement | null>(null);
  const howRef = useRef<HTMLTextAreaElement | null>(null);
  const tagsRef = useRef<HTMLInputElement | null>(null);
  // docs/memo.md「G. Issueに『介入の型』を足す」対応。tagsRefは非制御入力なので、
  // チップのハイライト表示だけをこのstateで追従させる（保存時はtagsRef.current.valueを読む）。
  // issueは非同期取得のため初回レンダー時点ではundefined——データが揃ったタイミングを
  // レンダー中に検知して同期する（useEffectは使わない。以降のポーリング更新では
  // 上書きしないので、編集中の選択状態を壊さない）。
  const [tagsSnapshot, setTagsSnapshot] = useState<string[]>([]);
  const [syncedIssueId, setSyncedIssueId] = useState<string | null>(null);
  // docs/memo.md「H. 戦略→Issue→結果の一本線」対応。keyResultIdの選択も同じ理由
  // （issueの非同期取得）で、同じタイミングにまとめて同期する。
  const [keyResultIdDraft, setKeyResultIdDraft] = useState<string>("");
  const [keyResultSaving, setKeyResultSaving] = useState(false);
  const [themeIdDraft, setThemeIdDraft] = useState<string>("");
  const [themeLinkSaving, setThemeLinkSaving] = useState(false);
  // docs/memo.md「I. チーム単位の憲法」対応。teamIdの選択も同じ理由でまとめて同期する。
  const [teamIdDraft, setTeamIdDraft] = useState<string>("");
  const [teamLinkSaving, setTeamLinkSaving] = useState(false);
  if (issue && issue.id !== syncedIssueId) {
    setSyncedIssueId(issue.id);
    setTagsSnapshot(issue.tags);
    setKeyResultIdDraft(issue.keyResultId ?? "");
    setThemeIdDraft(issue.themeId ?? "");
    setTeamIdDraft(issue.teamId ?? "");
  }

  async function handleChangeKeyResult(keyResultId: string) {
    if (!issue) return;
    setKeyResultIdDraft(keyResultId);
    setKeyResultSaving(true);
    try {
      const res = await fetch(`/api/issues/${issue.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyResultId: keyResultId || null }),
      });
      if (res.ok) await refreshIssue();
    } finally {
      setKeyResultSaving(false);
    }
  }

  async function handleChangeTheme(themeId: string) {
    if (!issue) return;
    setThemeIdDraft(themeId);
    setThemeLinkSaving(true);
    try {
      const res = await fetch(`/api/issues/${issue.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ themeId: themeId || null }),
      });
      if (res.ok) await refreshIssue();
    } finally {
      setThemeLinkSaving(false);
    }
  }

  async function handleChangeTeam(teamId: string) {
    if (!issue) return;
    setTeamIdDraft(teamId);
    setTeamLinkSaving(true);
    try {
      const res = await fetch(`/api/issues/${issue.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: teamId || null }),
      });
      if (res.ok) await refreshIssue();
    } finally {
      setTeamLinkSaving(false);
    }
  }

  function toggleInterventionType(label: string) {
    if (!tagsRef.current) return;
    const current = tagsRef.current.value.split(",").map((t) => t.trim()).filter(Boolean);
    const next = current.includes(label) ? current.filter((t) => t !== label) : [...current, label];
    tagsRef.current.value = next.join(", ");
    setTagsSnapshot(next);
    recomputeCharterDirty();
  }

  function recomputeCharterDirty() {
    if (!issue) {
      setCharterDirty(false);
      return;
    }
    const why = whyRef.current?.value ?? "";
    const what = whatRef.current?.value ?? "";
    const how = howRef.current?.value ?? "";
    const tags = (tagsRef.current?.value ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    setCharterDirty(
      why !== issue.charter.why ||
        what !== issue.charter.what ||
        how !== issue.charter.how ||
        JSON.stringify(tags) !== JSON.stringify(issue.tags),
    );
  }

  function startEditingTitle() {
    if (!issue || titlePending) return;
    setTitleDraft(issue.title);
    setTitleError(null);
    setTitlePendingError(null);
    setTitleEditing(true);
  }

  async function sendTitlePatch(trimmed: string, retry: () => void) {
    if (!issue) return;
    setTitlePending(true);
    setTitlePendingError(null);
    try {
      const { res, data } = await fetchWithNameConfirm(
        `/api/issues/${issue.id}`,
        { method: "PATCH", body: { title: trimmed } },
        "保存する",
      );
      if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? "保存に失敗しました");
      await Promise.all([refreshIssue(), refreshIssues()]);
    } catch (err) {
      if ((err as Error).message !== "人名候補の確認をキャンセルしました") {
        setTitlePendingError({ message: (err as Error).message, retry });
      }
    } finally {
      setTitlePending(false);
    }
  }

  function handleSaveTitle() {
    if (!issue) return;
    const trimmed = titleDraft.trim();
    if (!trimmed) {
      setTitleError("タイトルは必須です");
      return;
    }
    if (trimmed === issue.title) {
      setTitleEditing(false);
      setTitleError(null);
      return;
    }
    setTitleError(null);
    setTitleEditing(false);
    const retry = () => {
      void sendTitlePatch(trimmed, retry);
    };
    void sendTitlePatch(trimmed, retry);
  }

  async function sendCharterPatch(body: Record<string, unknown>, retry: () => void) {
    if (!issue) return;
    setCharterPending(true);
    setCharterPendingError(null);
    try {
      const { res, data } = await fetchWithNameConfirm(
        `/api/issues/${issue.id}`,
        { method: "PATCH", body },
        "保存する",
      );
      if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? "保存に失敗しました");
      await Promise.all([refreshIssue(), refreshRuns()]);
    } catch (err) {
      if ((err as Error).message !== "人名候補の確認をキャンセルしました") {
        setCharterPendingError({ message: (err as Error).message, retry });
      }
    } finally {
      setCharterPending(false);
    }
  }

  function handleSaveCharter() {
    if (!issue || !charterDirty) return;
    const body = {
      why: whyRef.current?.value ?? "",
      what: whatRef.current?.value ?? "",
      how: howRef.current?.value ?? "",
      tags: (tagsRef.current?.value ?? "").split(",").map((t) => t.trim()).filter(Boolean),
    };
    setCharterError(null);
    setCharterEditing(false);
    setCharterDirty(false);
    const retry = () => {
      void sendCharterPatch(body, retry);
    };
    void sendCharterPatch(body, retry);
  }

  function startEditingCharter() {
    if (charterPending) return;
    setCharterError(null);
    setCharterPendingError(null);
    setCharterDirty(false);
    setCharterEditing(true);
  }

  function handleCancelCharter() {
    setCharterError(null);
    setCharterDirty(false);
    setCharterEditing(false);
  }

  const [archiving, setArchiving] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);
  const [prioritySaving, setPrioritySaving] = useState(false);
  const [triageRescoring, setTriageRescoring] = useState(false);
  const [triageRescoreMessage, setTriageRescoreMessage] = useState<string | null>(null);
  const [strategyLinkSuggesting, setStrategyLinkSuggesting] = useState(false);
  const [strategyLinkError, setStrategyLinkError] = useState<string | null>(null);
  const [strategyLinkPreview, setStrategyLinkPreview] = useState<{
    suggestions: IssueStrategyLinkSuggestion[];
    source: "cloud" | "heuristic";
    fallbackReason?: string;
  } | null>(null);
  const [strategyLinkApplyingId, setStrategyLinkApplyingId] = useState<string | null>(null);

  // docs/em_ui_ux_issue.md 4節「ステータス管理の導入」対応。カンバンのドラッグ&ドロップは
  // 実装しないため、列（ステータス）の切り替えはここから行う。
  async function handleChangeStatus(status: IssueStatus) {
    if (!issue) return;
    setStatusSaving(true);
    try {
      const res = await fetch(`/api/issues/${issue.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) await refreshIssue();
    } finally {
      setStatusSaving(false);
    }
  }

  async function handleChangePriority(priority: IssuePriority) {
    if (!issue) return;
    setPrioritySaving(true);
    try {
      const res = await fetch(`/api/issues/${issue.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priority }),
      });
      if (res.ok) await Promise.all([refreshIssue(), refreshIssues()]);
    } finally {
      setPrioritySaving(false);
    }
  }

  async function handleRescoreTriage() {
    if (!issue) return;
    setTriageRescoring(true);
    setTriageRescoreMessage(null);
    try {
      const res = await fetch(`/api/issues/${issue.id}/triage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applySuggested: true }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "評価の更新に失敗しました");
      await Promise.all([refreshIssue(), refreshIssues()]);
      setTriageRescoreMessage(
        data?.changed
          ? `評価を更新し、優先度を反映しました: ${data.fromLabel} → ${data.toLabel}`
          : `評価を更新しました。優先度は変わりませんでした（提案: ${data?.suggestedLabel ?? "—"}）`,
      );
    } catch (err) {
      setTriageRescoreMessage((err as Error).message);
    } finally {
      setTriageRescoring(false);
    }
  }

  async function handleSuggestStrategyLink() {
    if (!issue) return;
    setStrategyLinkSuggesting(true);
    setStrategyLinkError(null);
    try {
      const res = await fetch("/api/issues/link/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issueIds: [issue.id] }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "戦略リンク提案に失敗しました");
      setStrategyLinkPreview({
        suggestions: Array.isArray(data?.suggestions) ? data.suggestions : [],
        source: data?.source === "cloud" ? "cloud" : "heuristic",
        fallbackReason: typeof data?.fallbackReason === "string" ? data.fallbackReason : undefined,
      });
    } catch (err) {
      setStrategyLinkError((err as Error).message);
    } finally {
      setStrategyLinkSuggesting(false);
    }
  }

  async function handleAdoptStrategyLink(s: IssueStrategyLinkSuggestion) {
    setStrategyLinkApplyingId(s.issueId);
    setStrategyLinkError(null);
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
      setThemeIdDraft(s.themeId ?? "");
      setKeyResultIdDraft(s.keyResultId ?? "");
      await Promise.all([refreshIssue(), refreshIssues()]);
      setStrategyLinkPreview(null);
    } catch (err) {
      setStrategyLinkError((err as Error).message);
    } finally {
      setStrategyLinkApplyingId(null);
    }
  }

  async function handleMoveFocus(direction: "up" | "down") {
    if (!issue) return;
    setPrioritySaving(true);
    try {
      const res = await fetch(`/api/issues/${issue.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ moveFocus: direction }),
      });
      if (res.ok) await Promise.all([refreshIssue(), refreshIssues()]);
    } finally {
      setPrioritySaving(false);
    }
  }

  async function handleToggleArchived() {
    if (!issue) return;
    setArchiving(true);
    try {
      const res = await fetch(`/api/issues/${issue.id}/archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: !issue.archived }),
      });
      if (res.ok) await refreshIssue();
    } finally {
      setArchiving(false);
    }
  }

  const linkedRun: AgentRun | null = issue ? runs.find((r) => r.id === issue.agentRunId) ?? null : null;
  const sourceConsult = issue ? resolveSourceConsultRun(issue, runs) : undefined;
  const pendingStart = pendingAgentStarts.find((p) => p.issueId === id) ?? null;

  async function sendDecision(text: string) {
    if (!linkedRun || !text.trim()) return;
    setDeciding(true);
    setDecideError(null);
    try {
      const { res, data } = await fetchWithNameConfirm(
        `/api/agents/${linkedRun.id}/decide`,
        { method: "POST", body: { message: text } },
        "送信する",
      );
      if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? "送信に失敗しました");
      setMessage("");
      setSelectedOptionId(null);
      await refreshRuns();
    } catch (err) {
      if ((err as Error).message !== "人名候補の確認をキャンセルしました") {
        setDecideError((err as Error).message);
      }
    } finally {
      setDeciding(false);
    }
  }

  function handleConfirmOption() {
    if (!linkedRun || !selectedOptionId) return;
    const opt = linkedRun.yieldRequest?.options.find((o) => o.id === selectedOptionId);
    if (!opt) return;
    sendDecision(`Option ${opt.id}（${opt.label}）を採用します。この方針で進めてください。`);
  }

  function handleFocusChat() {
    document.getElementById("issue-chat-input")?.focus();
  }

  async function handleAddActionItem() {
    if (!issue || !actionItemText.trim()) return;
    try {
      const { res } = await fetchWithNameConfirm(
        `/api/issues/${issue.id}/action-items`,
        { method: "POST", body: { text: actionItemText } },
        "保存する",
      );
      if (res.ok) {
        setActionItemText("");
        await refreshIssue();
      }
    } catch {
      // キャンセル・失敗時は次回のポーリングで状態が揃う
    }
  }

  // ユーザー依頼「EMがIssueに対して考えたこと・取ったアクション・結果を反映する」対応。
  // Action Itemsと同じ「1件ずつ即追記」の作りだが、done等の状態は持たない自由記述ログ。
  // ローカルNER込みの保存は完了を待たず、入力欄を空けて裏で処理する。
  async function sendLogPatch(text: string, retry: () => void) {
    if (!issue) return;
    setLogPending(true);
    setLogPendingError(null);
    try {
      const { res, data } = await fetchWithNameConfirm(
        `/api/issues/${issue.id}/log`,
        { method: "POST", body: { text } },
        "保存する",
      );
      if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? "記録に失敗しました");
      await Promise.all([refreshIssue(), refreshRuns()]);
    } catch (err) {
      if ((err as Error).message !== "人名候補の確認をキャンセルしました") {
        setLogPendingError({ message: (err as Error).message, retry });
      }
    } finally {
      setLogPending(false);
    }
  }

  function handleAddLogEntry() {
    if (!issue || !logText.trim() || logPending) return;
    const text = logText.trim();
    setLogText("");
    const retry = () => {
      void sendLogPatch(text, retry);
    };
    void sendLogPatch(text, retry);
  }

  const [actionItemsSubmitting, setActionItemsSubmitting] = useState(false);

  // docs/first_implession 3.8対応。AIが提案したAction Itemsを、実際にIssue.actionItemsへ
  // 追加するかどうかはEMが選ぶ（採用/却下いずれの場合も提案自体はrunから消し、
  // 同じ提案が表示され続けないようにする）。
  // 先頭1件だけ asNext で「次の一手」にし、残りは backlog へ追加する。
  async function handleAdoptSuggestedActionItems(items: string[]) {
    if (!issue || !linkedRun) return;
    setActionItemsSubmitting(true);
    try {
      for (let i = 0; i < items.length; i++) {
        await fetch(`/api/issues/${issue.id}/action-items`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: items[i], asNext: i === 0 }),
        });
      }
      await fetch(`/api/agents/${linkedRun.id}/action-items/dismiss`, { method: "POST" });
      await Promise.all([refreshIssue(), refreshRuns()]);
    } finally {
      setActionItemsSubmitting(false);
    }
  }

  async function handleDismissSuggestedActionItems() {
    if (!linkedRun) return;
    setActionItemsSubmitting(true);
    try {
      await fetch(`/api/agents/${linkedRun.id}/action-items/dismiss`, { method: "POST" });
      await refreshRuns();
    } finally {
      setActionItemsSubmitting(false);
    }
  }

  const [subIssuesSubmitting, setSubIssuesSubmitting] = useState(false);

  // docs/memo.md「K. ズームイン／ズームアウトの協働計画」対応。AIが提案した子Issue分解案を、
  // 実際にサブIssueとして作成するかどうかはEMが選ぶ（既存のサブIssue作成APIをそのまま
  // 複数回叩くだけで、新しい起票経路は増やさない）。
  async function handleAdoptSuggestedSubIssues(items: SuggestedSubIssue[]) {
    if (!issue || !linkedRun) return;
    setSubIssuesSubmitting(true);
    try {
      for (const item of items) {
        await fetch("/api/issues", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: item.title, parentId: issue.id, priority: item.priority }),
        });
      }
      await fetch(`/api/agents/${linkedRun.id}/sub-issues/dismiss`, { method: "POST" });
      await Promise.all([refreshIssue(), refreshIssues(), refreshRuns()]);
    } finally {
      setSubIssuesSubmitting(false);
    }
  }

  async function handleDismissSuggestedSubIssues() {
    if (!linkedRun) return;
    setSubIssuesSubmitting(true);
    try {
      await fetch(`/api/agents/${linkedRun.id}/sub-issues/dismiss`, { method: "POST" });
      await refreshRuns();
    } finally {
      setSubIssuesSubmitting(false);
    }
  }

  const [charterSubmitting, setCharterSubmitting] = useState(false);
  const [prioritySubmitting, setPrioritySubmitting] = useState(false);

  // ユーザー依頼「Journal等からIssueを生成する際、AIエージェントチームに内容を埋めさせる」
  // 対応。AIが提案したWhy/What/Howの埋め合わせ案を、実際にIssue.charterへ反映するか
  // どうかはEMが選ぶ（既存のPATCH /api/issues/[id]をそのまま叩くだけで、新しい更新経路は
  // 増やさない。提案に含まれない項目はキー自体を送らないため上書きされない）。
  async function handleAdoptSuggestedCharter(charter: { why?: string; what?: string; how?: string }) {
    if (!issue || !linkedRun) return;
    setCharterSubmitting(true);
    try {
      await fetchWithNameConfirm(
        `/api/issues/${issue.id}`,
        { method: "PATCH", body: charter },
        "保存する",
      );
      await fetch(`/api/agents/${linkedRun.id}/charter/dismiss`, { method: "POST" });
      await Promise.all([refreshIssue(), refreshRuns()]);
    } finally {
      setCharterSubmitting(false);
    }
  }

  async function handleDismissSuggestedCharter() {
    if (!linkedRun) return;
    setCharterSubmitting(true);
    try {
      await fetch(`/api/agents/${linkedRun.id}/charter/dismiss`, { method: "POST" });
      await refreshRuns();
    } finally {
      setCharterSubmitting(false);
    }
  }

  async function handleAdoptSuggestedPriority(priority: IssuePriority) {
    if (!issue || !linkedRun) return;
    setPrioritySubmitting(true);
    try {
      await fetch(`/api/issues/${issue.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priority }),
      });
      await fetch(`/api/agents/${linkedRun.id}/priority/dismiss`, { method: "POST" });
      await Promise.all([refreshIssue(), refreshIssues(), refreshRuns()]);
    } finally {
      setPrioritySubmitting(false);
    }
  }

  async function handleDismissSuggestedPriority() {
    if (!linkedRun) return;
    setPrioritySubmitting(true);
    try {
      await fetch(`/api/agents/${linkedRun.id}/priority/dismiss`, { method: "POST" });
      await refreshRuns();
    } finally {
      setPrioritySubmitting(false);
    }
  }

  async function handleToggleActionItem(itemId: string) {
    if (!issue) return;
    try {
      const res = await fetch(`/api/issues/${issue.id}/action-items/${itemId}`, { method: "PATCH" });
      if (res.ok) await refreshIssue();
    } catch {
      // 失敗時は次回のポーリングで状態が揃う
    }
  }

  async function handleSetActionItemAsNext(itemId: string) {
    if (!issue) return;
    try {
      const res = await fetch(`/api/issues/${issue.id}/action-items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asNext: true }),
      });
      if (res.ok) await refreshIssue();
    } catch {
      // 失敗時は次回のポーリングで状態が揃う
    }
  }

  async function handleRemoveActionItem(itemId: string, text: string) {
    if (!issue) return;
    if (!window.confirm(`Action Item「${text}」を削除しますか？`)) return;
    try {
      const res = await fetch(`/api/issues/${issue.id}/action-items/${itemId}`, { method: "DELETE" });
      if (res.ok) await refreshIssue();
    } catch {
      // 失敗時は次回のポーリングで状態が揃う
    }
  }

  const [promotingItemId, setPromotingItemId] = useState<string | null>(null);

  // Action Item → 子Issue。独自の介入物語として切り出す（1階層制限はAPI側でも拒否）。
  async function handlePromoteActionItem(itemId: string) {
    if (!issue || issue.parentId) return;
    setPromotingItemId(itemId);
    try {
      const { res } = await fetchWithNameConfirm(
        `/api/issues/${issue.id}/action-items/${itemId}/promote`,
        { method: "POST", body: {} },
        "子Issueとして作成する",
      );
      if (res.ok) await Promise.all([refreshIssue(), refreshIssues()]);
    } catch {
      // キャンセル・失敗時は次回のポーリングで状態が揃う
    } finally {
      setPromotingItemId(null);
    }
  }

  if (!issue) {
    return (
      <p className={styles.subtitle}>
        {!issueLoaded ? "読み込み中…" : "Issueが見つかりません。"}
      </p>
    );
  }

  // docs/em_ui_ux_issue.md 7節対応。閲覧モードでチーム・Key Resultを文字列表示するための
  // 逆引き（issues/page.tsxのresolveKeyResultと同じ考え方）。
  const teamName = issue.teamId ? teams.find((t) => t.id === issue.teamId)?.name : undefined;
  const themeTitle = issue.themeId ? themes.find((t) => t.id === issue.themeId)?.title : undefined;
  const krRef = issue.keyResultId
    ? objectives
        .flatMap((o) => o.keyResults.map((kr) => ({ objectiveId: o.id, objTitle: o.title, kr })))
        .find((x) => x.kr.id === issue.keyResultId)
    : undefined;
  const strategyUnlinked = isIssueStrategyUnlinked(issue);
  const originJournals =
    sourceJournals.length > 0
      ? sourceJournals
      : issue.sourceJournalId
        ? [{ id: issue.sourceJournalId, rawText: journalExcerptFromTask(sourceConsult?.task ?? linkedRun?.task ?? "") ?? "" }]
        : [];

  return (
    <>
      {parentIssue && (
        <Link href={`/issues/${parentIssue.id}`} className={styles.backLink} style={{ display: "block" }}>
          ⬆ 上位Issue: {parentIssue.title}
        </Link>
      )}
      <OriginTrace journals={originJournals} consult={sourceConsult ?? null} />

      <div className={styles.issueTitleRow}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {titleEditing ? (
            <div className={styles.field} style={{ maxWidth: 480 }}>
              <input
                type="text"
                aria-label="タイトル"
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                autoFocus
              />
              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                <button
                  className={styles.primaryBtn}
                  style={{ width: "auto" }}
                  disabled={!titleDraft.trim() || titleDraft.trim() === issue.title}
                  onClick={handleSaveTitle}
                >
                  保存
                </button>
                <button className={styles.btnOutline} onClick={() => setTitleEditing(false)}>
                  キャンセル
                </button>
              </div>
              {titleError && (
                <p className={styles.errorText} role="alert">
                  {titleError}
                </p>
              )}
            </div>
          ) : (
            <>
              <h2 style={{ display: "inline" }}>{issue.title}</h2>{" "}
              {!titlePending && (
                <button
                  className={`${styles.detailToggle} ${styles.detailToggleButton}`}
                  onClick={startEditingTitle}
                >
                  編集
                </button>
              )}
              <br />
              {titlePending && (
                <p className={styles.subtitle} role="status">
                  <span className={styles.spinner} aria-hidden="true" />
                  タイトルを保存中…
                </p>
              )}
              {titlePendingError && (
                <div className={styles.tagRow} style={{ marginTop: 4 }}>
                  <span className={styles.errorText} role="alert">
                    ⚠️ タイトルの保存に失敗しました: {titlePendingError.message}
                  </span>
                  <button className={styles.btnOutline} onClick={titlePendingError.retry}>
                    再試行
                  </button>
                  <button className={styles.btnOutline} onClick={() => setTitlePendingError(null)}>
                    閉じる
                  </button>
                </div>
              )}
              <IssueStatusBadge status={issue.status} />{" "}
              {linkedRun && <StatusBadge status={linkedRun.status} stale={staleRunIds.has(linkedRun.id)} />}
              {issue.archived && (
                <span className={styles.subtitle} style={{ marginLeft: 6 }}>
                  🗄 アーカイブ済み
                </span>
              )}
              {isIssueStalled(issue, now, rules.staleInterventionDays) && (
                <span className={styles.subtitle} style={{ marginLeft: 6 }}>
                  ⏳ 停滞中
                </span>
              )}
            </>
          )}
        </div>
        <button
          className={styles.btnOutline}
          onClick={handleToggleArchived}
          disabled={archiving}
          title="解決（ステータス完了）とは別です。追う必要がなくなったときに一覧から外します。"
        >
          {issue.archived ? "アーカイブを解除" : "アーカイブする（追わない）"}
        </button>
      </div>

      {/* 関連チーム・上位目標（テーマ / OKR）はタイトル直後に置き、詳細確認中に文脈を見失わないようにする。 */}
      <div style={{ marginTop: 8, marginBottom: 12 }}>
        <p className={styles.subtitle} style={{ margin: "0 0 4px" }}>
          👥 関連チーム:{" "}
          {issue.teamId && teamName ? (
            <Link
              href={`/teams?focus=${encodeURIComponent(issue.teamId)}`}
              className={styles.tableRowLink}
              style={{ display: "inline", width: "auto" }}
            >
              {teamName}
            </Link>
          ) : (
            "なし"
          )}
        </p>
        <p className={styles.subtitle} style={{ margin: "0 0 4px" }}>
          🎯 関連テーマ:{" "}
          {issue.themeId && themeTitle ? (
            <Link
              href={`/?theme=${encodeURIComponent(issue.themeId)}`}
              className={styles.tableRowLink}
              style={{ display: "inline", width: "auto" }}
            >
              {themeTitle}
            </Link>
          ) : (
            "なし"
          )}
        </p>
        <p className={styles.subtitle} style={{ margin: strategyUnlinked ? "0 0 4px" : "0 0 0" }}>
          📈 関連OKR:{" "}
          {krRef ? (
            <Link
              href={`/org?objective=${encodeURIComponent(krRef.objectiveId)}`}
              className={styles.tableRowLink}
              style={{ display: "inline", width: "auto" }}
            >
              {krRef.objTitle} ＞ {krRef.kr.title}
            </Link>
          ) : (
            "なし"
          )}
        </p>
        {strategyUnlinked && (
          <div style={{ marginTop: 6 }}>
            <p className={styles.subtitle} style={{ margin: "0 0 6px", color: "var(--warning, #b45309)" }}>
              ⚠ 戦略未接続（テーマ / Key Result のどちらかを紐付けると朝の物語に乗りやすくなります）
            </p>
            {!charterEditing && (
              <>
                <button
                  type="button"
                  className={styles.btnOutline}
                  style={{ fontSize: "0.75rem" }}
                  disabled={strategyLinkSuggesting}
                  onClick={handleSuggestStrategyLink}
                  title="この Issue へテーマ / KR の紐付けをAIが提案します"
                >
                  {strategyLinkSuggesting ? "提案中…" : "🔗 戦略リンクをAI提案"}
                </button>
                {strategyLinkError && (
                  <p className={styles.errorText} role="alert" style={{ marginTop: 6 }}>
                    {strategyLinkError}
                  </p>
                )}
                {strategyLinkPreview && (
                  <div style={{ marginTop: 8 }}>
                    <IssueStrategyLinkSuggestPanel
                      suggestions={strategyLinkPreview.suggestions}
                      source={strategyLinkPreview.source}
                      fallbackReason={strategyLinkPreview.fallbackReason}
                      applyingId={strategyLinkApplyingId}
                      onAdopt={handleAdoptStrategyLink}
                      onDismiss={() => setStrategyLinkPreview(null)}
                      onDismissOne={() => setStrategyLinkPreview(null)}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <div className={styles.field}>
        <span className={styles.fieldCaption}>ステータス</span>
        <IssueStatusSelector status={issue.status} onChange={handleChangeStatus} disabled={statusSaving} />
      </div>
      {!issue.parentId && (
        <div className={styles.field}>
          <span className={styles.fieldCaption}>優先度（今週〜今月の見通し / 今日の順）</span>
          <IssuePrioritySelector
            priority={issue.priority ?? "normal"}
            onChange={handleChangePriority}
            disabled={prioritySaving || triageRescoring}
          />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8, alignItems: "center" }}>
            <button
              type="button"
              className={styles.btnOutline}
              style={{ fontSize: "0.75rem" }}
              disabled={triageRescoring || prioritySaving}
              onClick={handleRescoreTriage}
              title="現状の内容から4軸を再採点し、提案どおり優先度へ反映します"
            >
              {triageRescoring ? "更新中…" : "このIssueの評価を更新"}
            </button>
          </div>
          {triageRescoreMessage && (
            <p className={styles.subtitle} style={{ marginTop: 6 }} role="status">
              {triageRescoreMessage}
            </p>
          )}
          {issue.triage ? (
            <div style={{ marginTop: 8 }}>
              <p className={styles.subtitle} style={{ margin: "0 0 4px" }}>
                優先度の評価根拠
                <span className={styles.tableMuted}>
                  {" "}
                  · 更新 {new Date(issue.triage.scoredAt).toLocaleString("ja-JP")}
                </span>
                {issue.triage.suggestedPriority !== (issue.priority ?? "normal") && (
                  <span style={{ color: "var(--warning, #b45309)" }}>
                    {" "}
                    · 提案は {ISSUE_PRIORITY_META[issue.triage.suggestedPriority].icon}{" "}
                    {ISSUE_PRIORITY_META[issue.triage.suggestedPriority].label}（手動で変えた可能性があります）
                  </span>
                )}
              </p>
              <IssueTriageAxes triage={issue.triage} />
              <p className={styles.subtitle} style={{ marginTop: 6 }}>
                Charter やテーマ／KR 紐付けを直したあとは「このIssueの評価を更新」で見直せます（優先度への反映も含みます）。
              </p>
            </div>
          ) : (
            <p className={styles.subtitle} style={{ marginTop: 8 }}>
              まだ評価がありません。上のボタン、または課題一覧の「評価を一括更新」から更新できます。
            </p>
          )}
          {issue.priority === "focus" && (
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <button
                type="button"
                className={styles.btnOutline}
                style={{ fontSize: "0.75rem" }}
                disabled={prioritySaving}
                onClick={() => handleMoveFocus("up")}
              >
                ↑ フォーカス順を前へ
              </button>
              <button
                type="button"
                className={styles.btnOutline}
                style={{ fontSize: "0.75rem" }}
                disabled={prioritySaving}
                onClick={() => handleMoveFocus("down")}
              >
                ↓ フォーカス順を後へ
              </button>
            </div>
          )}
        </div>
      )}
      <div className={styles.field} style={{ maxWidth: 260 }}>
        <span className={styles.fieldCaption}>進捗（Action Items + サブIssue。アーカイブした子は除外）</span>
        <ProgressBar {...issueProgress(issue, childIssues)} />
      </div>

      {decideError && <p className={styles.errorText} role="alert">{decideError}</p>}

      {pendingStart && <PendingAgentStartNotice pending={pendingStart} />}

      {/* ユーザー依頼「EMがIssueに対して考えたこと・取ったアクション・結果を反映する」
          対応。Action Items（やる/やった）とは別に、進行中いつでも書き足せる自由記述の
          経過ログ。種別（考えたこと／アクション／結果）は分けず、EMが自由に書く。 */}
      <div className={styles.panel}>
        <h2>経過ログ</h2>
        <p className={styles.subtitle} style={{ marginBottom: 10 }}>
          考えたこと・取ったアクション・分かった結果を、思いついた時にひとことずつ書き足してください。まとめて振り返る必要はありません。
        </p>
        <div className={styles.journalInputRow}>
          <textarea
            value={logText}
            onChange={(e) => setLogText(e.target.value)}
            rows={3}
            placeholder="例: Bチームと調整し、割り込み受付時間を14〜15時に限定することで合意"
            disabled={logPending}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                e.preventDefault();
                handleAddLogEntry();
              }
            }}
          />
          <button
            className={styles.primaryBtn}
            style={{ width: "auto" }}
            type="button"
            disabled={logPending || !logText.trim()}
            onClick={handleAddLogEntry}
          >
            記録
          </button>
        </div>
        {logPending && (
          <p className={styles.subtitle} style={{ marginTop: 8 }} role="status">
            <span className={styles.spinner} aria-hidden="true" />
            経過ログを保存中…
          </p>
        )}
        {logPendingError && (
          <div className={styles.tagRow} style={{ marginTop: 8 }}>
            <span className={styles.errorText} role="alert">
              ⚠️ 経過ログの保存に失敗しました: {logPendingError.message}
            </span>
            <button className={styles.btnOutline} onClick={logPendingError.retry}>
              再試行
            </button>
            <button className={styles.btnOutline} onClick={() => setLogPendingError(null)}>
              閉じる
            </button>
          </div>
        )}
        {issue.logEntries.length === 0 ? (
          <p className={styles.subtitle} style={{ marginTop: 10 }}>
            まだ記録がありません。
          </p>
        ) : (
          <ul style={{ listStyle: "none", marginTop: 10 }}>
            {[...issue.logEntries].reverse().map((entry) => (
              <li key={entry.id} className={styles.field} style={{ marginBottom: 8 }}>
                <div style={{ fontSize: "0.8125rem" }}>{entry.text}</div>
                <div className={styles.subtitle}>{new Date(entry.createdAt).toLocaleString("ja-JP")}</div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {issue.teamId && (
        <div className={styles.panel}>
          <h2>介入の効果（{teams.find((t) => t.id === issue.teamId)?.name ?? "関連チーム"}）{impact?.inProgress && "・進行中"}</h2>
          <p className={styles.subtitle}>
            {impact?.inProgress
              ? "「感覚」ではなく観測に基づいて判断できるよう、このIssueの介入開始前とその後（現在まで）でチームのJournal傾向がどう変化したかを機械的に比較します（手動でのスコア入力はありません）。解決（ステータス完了）前の暫定値です。"
              : "「感覚」ではなく観測に基づいてピボット判断できるよう、このIssueの解決（ステータス完了）前後でチームのJournal傾向がどう変化したかを機械的に比較します（手動でのスコア入力はありません）。"}
          </p>
          {!impactLoaded ? (
            <p className={styles.subtitle}>読み込み中…</p>
          ) : !impact ? (
            <p className={styles.subtitle}>介入の効果を算出できる状態ではありません。</p>
          ) : (
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <div className={styles.vitalCard} style={{ minWidth: 220 }}>
                <div className={styles.vitalLabel}>{impact.inProgress ? "介入開始前" : "解決前"} 直近{impact.windowDays}日間</div>
                <div className={styles.vitalValue}>
                  Journal {impact.before.total}件（🙂{impact.before.positive} 🙁{impact.before.negative}）
                </div>
              </div>
              <div className={styles.vitalCard} style={{ minWidth: 220 }}>
                <div className={styles.vitalLabel}>{impact.inProgress ? "介入開始〜現在" : `解決後 直近${impact.windowDays}日間`}</div>
                <div className={styles.vitalValue}>
                  Journal {impact.after.total}件（🙂{impact.after.positive} 🙁{impact.after.negative}）
                </div>
              </div>
            </div>
          )}
          {impact && impact.after.total === 0 && (
            <p className={styles.subtitle} style={{ marginTop: 8 }}>
              {impact.inProgress
                ? "介入開始後、このチームに関するJournalの記録がまだありません。効果測定のためにも、関連するJournalを記録してください。"
                : "解決後まだ観測期間が経過していない、またはJournalの記録がありません。しばらく経ってから確認してください。"}
            </p>
          )}
        </div>
      )}

      {!issue.parentId && (
        <div className={`${styles.panel} ${styles.charterSection}`}>
          <div className={styles.detailHeader}>
            <h2 style={{ margin: 0 }}>サブIssue（分解した子Issue）</h2>
            <div style={{ display: "flex", gap: 8 }}>
              <button className={styles.btnOutline} onClick={() => setHierarchyDialog("child")}>
                ＋ サブIssueを追加
              </button>
              {childIssues.length === 0 && (
                <button className={styles.btnOutline} onClick={() => setHierarchyDialog("parent")}>
                  ⬆ 上位Issueを作る
                </button>
              )}
            </div>
          </div>
          <p className={styles.subtitle} style={{ marginBottom: 10 }}>
            複雑な階層を避けるため、親子関係は1階層まで（サブIssueがさらに自分の子を持つことはできません）。
          </p>
          {childIssues.length === 0 ? (
            <p className={styles.subtitle}>まだサブIssueはありません。</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>タイトル</th>
                    <th>ステータス</th>
                    <th>Why/What/How</th>
                    <th>進捗</th>
                  </tr>
                </thead>
                <tbody>
                  {childIssues.map((child) => {
                    const childRun = runs.find((r) => r.id === child.agentRunId);
                    const childCharter = charterFilledCount(child.charter);
                    return (
                      <tr key={child.id} style={child.archived ? { opacity: 0.6 } : undefined}>
                        <td>
                          <button className={styles.tableRowLink} onClick={() => router.push(`/issues/${child.id}`)}>
                            {child.title}
                          </button>
                          <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                            {childRun && <StatusBadge status={childRun.status} stale={staleRunIds.has(childRun.id)} />}
                            {child.archived && <span className={styles.tableMuted}>🗄 アーカイブ済み</span>}
                          </div>
                        </td>
                        <td>
                          <IssueStatusBadge status={child.status} />
                        </td>
                        <td>
                          <span className={childCharter === 3 ? styles.charterBadgeReady : styles.charterBadgeWarn}>
                            {childCharter === 3 ? "✅" : "❓"} {childCharter}/3
                          </span>
                        </td>
                        <td>
                          <ProgressBar {...issueProgress(child)} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className={`${styles.panel} ${styles.charterSection}`} key={issue.id}>
        <h2>Why / What / How</h2>
        <p className={styles.subtitle} style={{ marginBottom: 10 }}>
          計画・実行の前に明らかにしておくべき3要素。分かっている範囲で記入し、空欄（点線＝未整理）が残っている場合は着手前に明確にしてください。
        </p>

        {charterFilledCount(issue.charter) < 3 && (
          <div className={styles.charterWarnBanner}>
            ⚠️ Why/What/Howが{charterFilledCount(issue.charter)}/3しか整理されていません。{charterEditing ? "点線の欄が「まだ分かっていないこと」です。" : ""}計画や実行を進める前に明確にすることを推奨します。
          </div>
        )}

        {/* docs/em_ui_ux_issue.md 7節「閲覧ビューと編集ビューの分離」対応。デフォルトは
            入力フォームを持たない閲覧モード。テキストクリックまたは「編集」ボタンで
            編集モードへ切り替える（titleEditingと同じ思想）。
            保存はJournalと同様にフォームを閉じて裏で処理し、対象パネルにスピナーを出す。 */}
        {charterPending && (
          <p className={styles.subtitle} style={{ marginBottom: 10 }} role="status">
            <span className={styles.spinner} aria-hidden="true" />
            Why/What/How・タグを保存中…
          </p>
        )}
        {charterPendingError && (
          <div className={styles.tagRow} style={{ marginBottom: 10 }}>
            <span className={styles.errorText} role="alert">
              ⚠️ 保存に失敗しました: {charterPendingError.message}
            </span>
            <button className={styles.btnOutline} onClick={charterPendingError.retry}>
              再試行
            </button>
            <button className={styles.btnOutline} onClick={() => setCharterPendingError(null)}>
              閉じる
            </button>
          </div>
        )}
        {!charterEditing ? (
          <>
            {CHARTER_VIEW_FIELDS.map(({ key, label }) => (
              <div key={key} className={styles.charterField}>
                <span className={styles.fieldCaption}>{label}</span>
                {issue.charter[key] ? (
                  <div
                    className={styles.editableTextView}
                    onClick={charterPending ? undefined : startEditingCharter}
                  >
                    <MarkdownView text={issue.charter[key]} />
                  </div>
                ) : (
                  <div
                    className={styles.charterEmptyView}
                    onClick={charterPending ? undefined : startEditingCharter}
                  >
                    未整理（クリックして記入）
                  </div>
                )}
              </div>
            ))}

            {issue.tags.length > 0 && (
              <div className={styles.tagRow} style={{ marginBottom: 10 }}>
                {issue.tags.map((tag) => (
                  <span key={tag} className={`${styles.tag} ${styles.tagTopic}`}>
                    #{tag}
                  </span>
                ))}
              </div>
            )}

            {!charterPending && (
              <button className={`${styles.detailToggle} ${styles.detailToggleButton}`} onClick={startEditingCharter}>
                編集
              </button>
            )}
          </>
        ) : (
          <>
            <div className={styles.charterField}>
              <label>Why（生む価値・誰のため・なぜ今か）
              <textarea
                ref={whyRef}
                rows={2}
                defaultValue={issue.charter.why}
                className={issue.charter.why ? "" : styles.charterEmpty}
                placeholder="未整理（クリックして記入）"
                onChange={recomputeCharterDirty}
              /></label>
            </div>
            <div className={styles.charterField}>
              <label>What（何を・どこまで・どのくらい・完了の定義）
              <textarea
                ref={whatRef}
                rows={2}
                defaultValue={issue.charter.what}
                className={issue.charter.what ? "" : styles.charterEmpty}
                placeholder="未整理（クリックして記入）"
                onChange={recomputeCharterDirty}
              /></label>
            </div>
            <div className={styles.charterField}>
              <label>How（どのように実現するか・前提や制約）
              <textarea
                ref={howRef}
                rows={2}
                defaultValue={issue.charter.how}
                className={issue.charter.how ? "" : styles.charterEmpty}
                placeholder="未整理（クリックして記入）"
                onChange={recomputeCharterDirty}
              /></label>
            </div>
            <div className={styles.field}>
              <label>関連チーム（任意。そのチームのMission/制約を前提として注入する）
              <Select
                value={teamIdDraft}
                onChange={handleChangeTeam}
                disabled={teamLinkSaving}
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
                value={themeIdDraft}
                onChange={handleChangeTheme}
                disabled={themeLinkSaving}
                options={[
                  { value: "", label: "なし" },
                  ...themes
                    .filter((t) => t.status === "adopted")
                    .map((t) => ({ value: t.id, label: t.title })),
                ]}
                style={{ display: "block", width: "100%" }}
              /></label>
            </div>
            <div className={styles.field}>
              <label>紐付けるKey Result（任意。「今期何を解いているか」の一本線を作る）
              <Select
                value={keyResultIdDraft}
                onChange={handleChangeKeyResult}
                disabled={keyResultSaving}
                options={[
                  { value: "", label: "なし" },
                  ...objectives.flatMap((o) => o.keyResults.map((kr) => ({ value: kr.id, label: `${o.title} ＞ ${kr.title}` }))),
                ]}
                style={{ display: "block", width: "100%" }}
              /></label>
            </div>
            {isIssueStrategyUnlinked({ themeId: themeIdDraft || undefined, keyResultId: keyResultIdDraft || undefined }) && (
              <div style={{ marginBottom: 8 }}>
                <p className={styles.subtitle} style={{ margin: "0 0 6px", color: "var(--warning, #b45309)" }}>
                  ⚠ 戦略未接続（必須ではありません）
                </p>
                <button
                  type="button"
                  className={styles.btnOutline}
                  style={{ fontSize: "0.75rem" }}
                  disabled={strategyLinkSuggesting}
                  onClick={handleSuggestStrategyLink}
                >
                  {strategyLinkSuggesting ? "提案中…" : "🔗 戦略リンクをAI提案"}
                </button>
                {strategyLinkError && (
                  <p className={styles.errorText} role="alert" style={{ marginTop: 6 }}>
                    {strategyLinkError}
                  </p>
                )}
                {strategyLinkPreview && (
                  <div style={{ marginTop: 8 }}>
                    <IssueStrategyLinkSuggestPanel
                      suggestions={strategyLinkPreview.suggestions}
                      source={strategyLinkPreview.source}
                      fallbackReason={strategyLinkPreview.fallbackReason}
                      applyingId={strategyLinkApplyingId}
                      onAdopt={handleAdoptStrategyLink}
                      onDismiss={() => setStrategyLinkPreview(null)}
                      onDismissOne={() => setStrategyLinkPreview(null)}
                    />
                  </div>
                )}
              </div>
            )}
            <div className={styles.field}>
              <span className={styles.fieldCaption}>介入の型（実装タスクではなく仕組み・人・組織への介入の切り口）</span>
              <div role="group" aria-label="介入の型（複数選択可）" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {INTERVENTION_TYPES.map((t) => (
                  <button
                    key={t.label}
                    type="button"
                    className={`${styles.typeChip} ${tagsSnapshot.includes(t.label) ? styles.typeChipSelected : ""}`}
                    onClick={() => toggleInterventionType(t.label)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <div className={styles.field}>
              <label>タグ（カンマ区切り）
              <input
                type="text"
                ref={tagsRef}
                defaultValue={issue.tags.join(", ")}
                onChange={(e) => {
                  setTagsSnapshot(e.target.value.split(",").map((t) => t.trim()).filter(Boolean));
                  recomputeCharterDirty();
                }}
                placeholder="例: バグ, リファクタリング, オンボーディング"
              /></label>
            </div>
            {issue.tags.length > 0 && (
              <div className={styles.tagRow} style={{ marginBottom: 10 }}>
                {issue.tags.map((tag) => (
                  <span key={tag} className={`${styles.tag} ${styles.tagTopic}`}>
                    #{tag}
                  </span>
                ))}
              </div>
            )}
            {charterError && <p className={styles.errorText} role="alert">{charterError}</p>}
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className={styles.primaryBtn}
                style={{ width: "auto" }}
                disabled={!charterDirty}
                onClick={handleSaveCharter}
              >
                {charterDirty ? "Why/What/How・タグを保存" : "保存済み"}
              </button>
              <button className={styles.btnOutline} onClick={handleCancelCharter}>
                キャンセル
              </button>
            </div>
          </>
        )}

        {history.length > 0 && (
          <details style={{ marginTop: 14 }}>
            <summary style={{ cursor: "pointer", fontSize: "0.75rem", color: "var(--text-muted)" }}>
              変更履歴（{history.length}件）
            </summary>
            <ul style={{ listStyle: "none", marginTop: 8 }}>
              {history.map((h) => (
                <li key={h.id} style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: 4 }}>
                  {new Date(h.occurredAt).toLocaleString("ja-JP")} — {h.text}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      <div className={styles.issueColumns}>
        <div className={styles.panel}>
          <h2>Execution State</h2>
          {linkedRun ? (
            <ExecutionState
              run={linkedRun}
              selectedOptionId={selectedOptionId}
              onSelectOption={setSelectedOptionId}
              onConfirmOption={handleConfirmOption}
              onFocusChat={handleFocusChat}
              deciding={deciding}
              stale={staleRunIds.has(linkedRun.id)}
              onRetry={() => sendDecision("直前の処理がエラーで中断しました。同じ内容を踏まえて再度実行してください。")}
              onAdoptActionItems={handleAdoptSuggestedActionItems}
              onDismissActionItems={handleDismissSuggestedActionItems}
              actionItemsSubmitting={actionItemsSubmitting}
              onAdoptSubIssues={handleAdoptSuggestedSubIssues}
              onDismissSubIssues={handleDismissSuggestedSubIssues}
              subIssuesSubmitting={subIssuesSubmitting}
              onAdoptCharter={handleAdoptSuggestedCharter}
              onDismissCharter={handleDismissSuggestedCharter}
              charterSubmitting={charterSubmitting}
              onAdoptPriority={handleAdoptSuggestedPriority}
              onDismissPriority={handleDismissSuggestedPriority}
              prioritySubmitting={prioritySubmitting}
            />
          ) : (
            <p className={styles.subtitle}>
              Agent Runが紐づいていません。Dashboardでタスクを起票するか、Issue一覧から紐づけてください。横断相談から続けたい場合は
              <Link href="/chat"> 「何でも相談」</Link> へ。
            </p>
          )}

          <h2 style={{ marginTop: 16 }}>Action Items</h2>
          <p className={styles.subtitle} style={{ marginBottom: 8 }}>
            {ACTION_ITEM_VS_SUB_ISSUE_HELP}
          </p>
          {(() => {
            const nextItem = issueNextAction(issue);
            const backlog = issueBacklogActionItems(issue);
            const doneItems = issue.actionItems.filter((a) => a.done);
            return (
              <>
                <h3 style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "0 0 6px" }}>次の一手</h3>
                {!nextItem ? (
                  <p className={styles.subtitle} style={{ marginBottom: 10 }}>
                    未設定です。下から追加するか、あとでやる一覧から「次の一手にする」を選んでください。
                  </p>
                ) : (
                  <div
                    style={{
                      fontSize: "0.8125rem",
                      marginBottom: 12,
                      padding: "8px 10px",
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                      background: "var(--surface-raised, transparent)",
                    }}
                  >
                    <label style={{ display: "flex", gap: 6, alignItems: "flex-start", cursor: "pointer" }}>
                      <input type="checkbox" checked={false} onChange={() => handleToggleActionItem(nextItem.id)} style={{ marginTop: 2 }} />
                      <span style={{ flex: 1 }}>{nextItem.text}</span>
                    </label>
                    <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                      {!issue.parentId && (
                        <button
                          type="button"
                          className={styles.btnOutline}
                          style={{ fontSize: "0.75rem" }}
                          disabled={promotingItemId === nextItem.id}
                          onClick={() => handlePromoteActionItem(nextItem.id)}
                        >
                          {promotingItemId === nextItem.id ? "昇格中…" : "子Issueに昇格"}
                        </button>
                      )}
                      <button
                        type="button"
                        className={styles.btnOutline}
                        style={{ fontSize: "0.75rem" }}
                        onClick={() => handleRemoveActionItem(nextItem.id, nextItem.text)}
                      >
                        削除
                      </button>
                    </div>
                  </div>
                )}

                {backlog.length > 0 && (
                  <>
                    <h3 style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "0 0 6px" }}>あとでやる</h3>
                    <ul style={{ listStyle: "none", marginBottom: 10 }}>
                      {backlog.map((item) => (
                        <li key={item.id} style={{ fontSize: "0.8125rem", marginBottom: 8 }}>
                          <label style={{ display: "flex", gap: 6, alignItems: "flex-start", cursor: "pointer" }}>
                            <input type="checkbox" checked={false} onChange={() => handleToggleActionItem(item.id)} style={{ marginTop: 2 }} />
                            <span style={{ flex: 1 }}>{item.text}</span>
                          </label>
                          <div style={{ display: "flex", gap: 6, marginTop: 4, marginLeft: 22 }}>
                            <button
                              type="button"
                              className={styles.btnOutline}
                              style={{ fontSize: "0.7rem", padding: "2px 8px" }}
                              onClick={() => handleSetActionItemAsNext(item.id)}
                            >
                              次の一手にする
                            </button>
                            {!issue.parentId && (
                              <button
                                type="button"
                                className={styles.btnOutline}
                                style={{ fontSize: "0.7rem", padding: "2px 8px" }}
                                disabled={promotingItemId === item.id}
                                onClick={() => handlePromoteActionItem(item.id)}
                              >
                                {promotingItemId === item.id ? "昇格中…" : "子Issueに昇格"}
                              </button>
                            )}
                            <button
                              type="button"
                              className={styles.btnOutline}
                              style={{ fontSize: "0.7rem", padding: "2px 8px" }}
                              onClick={() => handleRemoveActionItem(item.id, item.text)}
                            >
                              削除
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                {doneItems.length > 0 && (
                  <>
                    <h3 style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "0 0 6px" }}>完了</h3>
                    <ul style={{ listStyle: "none", marginBottom: 10 }}>
                      {doneItems.map((item) => (
                        <li key={item.id} style={{ fontSize: "0.8125rem", marginBottom: 6 }}>
                          <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
                            <input type="checkbox" checked onChange={() => handleToggleActionItem(item.id)} />
                            <span style={{ flex: 1, textDecoration: "line-through", color: "var(--text-muted)" }}>{item.text}</span>
                          </label>
                          <div style={{ marginTop: 4, marginLeft: 22 }}>
                            <button
                              type="button"
                              className={styles.btnOutline}
                              style={{ fontSize: "0.7rem", padding: "2px 8px" }}
                              onClick={() => handleRemoveActionItem(item.id, item.text)}
                            >
                              削除
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                {issue.actionItems.length === 0 && <p className={styles.subtitle}>まだありません。</p>}
              </>
            );
          })()}
          <div className={styles.chatRow}>
            <textarea
              placeholder="Action Itemを追加（あとでやるへ）…"
              value={actionItemText}
              onChange={(e) => setActionItemText(e.target.value)}
              rows={2}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                  e.preventDefault();
                  handleAddActionItem();
                }
              }}
            />
            <button className={styles.primaryBtn} style={{ width: "auto" }} disabled={!actionItemText.trim()} onClick={handleAddActionItem}>
              追加
            </button>
          </div>
        </div>

        <div className={styles.panel}>
          <h2>Copilot Workspace (Interactive)</h2>
          {linkedRun ? (
            <>
              <p className={styles.subtitle} style={{ marginBottom: 8 }}>この Issue の壁打ちはここで行います。</p>
              <CopilotChat run={linkedRun} message={message} setMessage={setMessage} deciding={deciding} onDecide={sendDecision} inputId="issue-chat-input" />
            </>
          ) : (
            <p className={styles.subtitle}>Agent Runが無いため会話はありません。</p>
          )}
        </div>
      </div>

      {hierarchyDialog && (
        <Modal
          title={hierarchyDialog === "child" ? "サブIssueを追加" : "上位Issueを作る"}
          size="wide"
          onClose={closeHierarchyDialog}
        >
          <form onSubmit={hierarchyDialog === "child" ? handleCreateChild : handleCreateParent}>
            <div className={styles.field}>
              <label>タイトル
              <input type="text" autoFocus value={hTitle} onChange={(e) => setHTitle(e.target.value)} placeholder="例: 割り込みタスクの受け入れ基準を定める" /></label>
            </div>
            <div className={styles.field}>
              <label>Why（生む価値・誰のため・なぜ今か）
              <textarea rows={2} value={hWhy} onChange={(e) => setHWhy(e.target.value)} /></label>
            </div>
            <div className={styles.field}>
              <label>What（何を・どこまで・どのくらい・完了の定義）
              <textarea rows={2} value={hWhat} onChange={(e) => setHWhat(e.target.value)} /></label>
            </div>
            <div className={styles.field}>
              <label>How（どのように実現するか・前提や制約）
              <textarea rows={2} value={hHow} onChange={(e) => setHHow(e.target.value)} /></label>
            </div>
            {hError && <p className={styles.errorText} role="alert">{hError}</p>}
            <button className={styles.primaryBtn} type="submit" disabled={hSubmitting || !hTitle.trim()}>
              {hierarchyDialog === "child" ? "サブIssueを作成" : "上位Issueを作成"}
            </button>
          </form>
        </Modal>
      )}
      {nameCandidateDialog}
    </>
  );
}
