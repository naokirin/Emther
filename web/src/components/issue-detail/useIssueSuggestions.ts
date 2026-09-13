import { useState } from "react";
import type { AgentRun, SuggestedSubIssue } from "@/components/RunDetail";
import type { Issue, IssuePriority } from "@/lib/types";
import type { FetchWithNameConfirm } from "./types";

type Params = {
  issue: Issue | null;
  linkedRun: AgentRun | null;
  fetchWithNameConfirm: FetchWithNameConfirm;
  refreshIssue: () => Promise<void>;
  refreshIssues: () => Promise<void>;
  refreshRuns: () => Promise<void>;
};

// AIが提案したAction Items/サブIssue/Charter/優先度の下書きを、EMが個別に採用・却下
// するためのハンドラ群。JSX本体は持たず ExecutionState（RunDetail.tsx）へpropsとして
// 配るだけなので、独立したフックとして集約する。
export function useIssueSuggestions({ issue, linkedRun, fetchWithNameConfirm, refreshIssue, refreshIssues, refreshRuns }: Params) {
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

  return {
    actionItemsSubmitting,
    handleAdoptSuggestedActionItems,
    handleDismissSuggestedActionItems,
    subIssuesSubmitting,
    handleAdoptSuggestedSubIssues,
    handleDismissSuggestedSubIssues,
    charterSubmitting,
    handleAdoptSuggestedCharter,
    handleDismissSuggestedCharter,
    prioritySubmitting,
    handleAdoptSuggestedPriority,
    handleDismissSuggestedPriority,
  };
}
