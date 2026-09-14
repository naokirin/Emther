import { useState } from "react";
import type { AgentRun, SuggestedSubIssue } from "@/components/RunDetail";
import type { Issue } from "@/lib/types";
import type { FetchWithNameConfirm } from "./types";

type Params = {
  issue: Issue | null;
  linkedRun: AgentRun | null;
  fetchWithNameConfirm: FetchWithNameConfirm;
  refreshIssue: () => Promise<void>;
  refreshIssues: () => Promise<void>;
  refreshRuns: () => Promise<void>;
};

// docs/2nd_pivot_version.md Phase 2.4対応。Action Items/優先度の提案採用フローは
// 廃止した（対応UIが無くなったため）。AIが提案したサブIssue/Charter/他Issueへの
// 一言記録の下書きを、EMが個別に採用・却下するためのハンドラ群。JSX本体は持たず
// ExecutionState（RunDetail.tsx）へpropsとして配るだけなので、独立したフックとして集約する。
export function useIssueSuggestions({ issue, linkedRun, fetchWithNameConfirm, refreshIssue, refreshIssues, refreshRuns }: Params) {
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

  const [issueNotesSubmitting, setIssueNotesSubmitting] = useState(false);

  // docs/memo.md「Agentが相談などから他Issueなどへ記録することができない」対応。対象は
  // 「このタスクとは別の」Issueのため、書き込み先はissueではなくrunに紐づくAPIが決める
  // （suggestedThemesと同じく、採用・却下いずれもrun単位のエンドポイントを叩くだけでよい）。
  async function handleAdoptSuggestedIssueNotes() {
    if (!linkedRun) return;
    setIssueNotesSubmitting(true);
    try {
      await fetch(`/api/agents/${linkedRun.id}/issue-notes`, { method: "POST" });
      await Promise.all([refreshIssues(), refreshRuns()]);
    } finally {
      setIssueNotesSubmitting(false);
    }
  }

  async function handleDismissSuggestedIssueNotes() {
    if (!linkedRun) return;
    setIssueNotesSubmitting(true);
    try {
      await fetch(`/api/agents/${linkedRun.id}/issue-notes`, { method: "DELETE" });
      await refreshRuns();
    } finally {
      setIssueNotesSubmitting(false);
    }
  }

  return {
    subIssuesSubmitting,
    handleAdoptSuggestedSubIssues,
    handleDismissSuggestedSubIssues,
    charterSubmitting,
    handleAdoptSuggestedCharter,
    handleDismissSuggestedCharter,
    issueNotesSubmitting,
    handleAdoptSuggestedIssueNotes,
    handleDismissSuggestedIssueNotes,
  };
}
