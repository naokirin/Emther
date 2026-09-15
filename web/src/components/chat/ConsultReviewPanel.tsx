"use client";

import { useState } from "react";
import styles from "@/app/page.module.css";
import { CopilotChat, ExecutionState, listIssueCandidatesFromProposal, runFallbackTitle, type AgentRun } from "@/components/RunDetail";
import { OriginTrace, type OriginTraceJournal } from "@/components/OriginTrace";
import { IdLinkedText } from "@/components/IdLinkedText";
import { useSuggestionPeek } from "@/components/IdFragmentLink";
import type { useNameCandidateConfirm } from "@/lib/useNameCandidateConfirm";
import { truncateForTitle } from "@/lib/types";
import { journalExcerptFromTask } from "@/lib/origin-trace";

const ORIGIN_LABEL: Record<AgentRun["origin"], string> = {
  manual: "",
  "auto-anomaly": "Journal自動分析",
  "auto-summary": "朝のサマリー",
  "auto-issue-update": "提案更新分析",
  "auto-distill": "状況蒸留",
};

const TRIAGE_LABEL: Record<"watching" | "dismissed", string> = {
  watching: "👀 様子見",
  dismissed: "却下",
};

type IssueCandidate = ReturnType<typeof listIssueCandidatesFromProposal>[number];
type CandidatePick = { runId: string; selected: boolean[] } | null;

type Props = {
  selectedRun: AgentRun;
  sourceJournal: OriginTraceJournal | null;
  issueCandidates: IssueCandidate[];
  candidatePick: CandidatePick;
  setCandidatePick: (pick: CandidatePick) => void;
  stale: boolean;
  fetchWithNameConfirm: ReturnType<typeof useNameCandidateConfirm>["fetchWithNameConfirm"];
  refreshRuns: () => Promise<void>;
  refreshIssues: () => Promise<void>;
};

// 「何でも相談」画面の、選択中run（Lead Agentへの相談）の右パネル。Issue候補の選択・
// 様子見/却下・ExecutionState・CopilotChatをまとめて持つ。candidatePickは、URL経由の
// run切り替え（selectHistoryRunを経ないケース）でも既存の挙動を変えないよう親
// （ChatPageInner）に残している。
export function ConsultReviewPanel({
  selectedRun,
  sourceJournal,
  issueCandidates,
  candidatePick,
  setCandidatePick,
  stale,
  fetchWithNameConfirm,
  refreshRuns,
  refreshIssues,
}: Props) {
  const suggestionPeek = useSuggestionPeek();
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [deciding, setDeciding] = useState(false);
  const [decideError, setDecideError] = useState<string | null>(null);
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [themesSubmitting, setThemesSubmitting] = useState(false);
  const [issueNotesSubmitting, setIssueNotesSubmitting] = useState(false);

  const candidateSelectedFlags =
    candidatePick?.runId === selectedRun.id && candidatePick.selected.length === issueCandidates.length
      ? candidatePick.selected
      : issueCandidates.map(() => true);
  const selectedCandidateTitles = issueCandidates
    .filter((_, i) => candidateSelectedFlags[i])
    .map((c) => c.title);

  function toggleCandidate(index: number) {
    const next = [...candidateSelectedFlags];
    next[index] = !next[index];
    setCandidatePick({ runId: selectedRun.id, selected: next });
  }

  async function handlePromoteToIssue() {
    const titles =
      issueCandidates.length > 1
        ? selectedCandidateTitles
        : issueCandidates.length === 1
          ? [issueCandidates[0].title]
          : [runFallbackTitle(selectedRun)];
    if (titles.length === 0) {
      setReviewError("起票する候補を1件以上選んでください");
      return;
    }
    setReviewSubmitting(true);
    setReviewError(null);
    try {
      const createdIds: string[] = [];
      for (let i = 0; i < titles.length; i++) {
        const title = truncateForTitle(titles[i]);
        // 相談スレッドは提案の agentRunId に吸収しない（履歴残存・続きの壁打ち・分割起票のため）。
        // sourceRunId のみ渡し、API 側で reviewed 化と Journal 紐付けを行う。
        const body = {
          title,
          sourceRunId: selectedRun.id,
          ...(i === 0 && selectedRun.sourceJournalId ? { sourceJournalId: selectedRun.sourceJournalId } : {}),
        };
        const { res, data } = await fetchWithNameConfirm("/api/suggestions", { method: "POST", body }, "保存する");
        if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? "提案の保存に失敗しました");
        createdIds.push((data as { suggestion: { id: string } }).suggestion.id);
      }
      await Promise.all([refreshIssues(), refreshRuns()]);
      setCandidatePick(null);
      if (createdIds.length === 1) {
        suggestionPeek.open(createdIds[0]);
      }
      // 複数件時も相談画面に留まり、続きの壁打ち・追加の提案化ができるようにする。
    } catch (err) {
      if ((err as Error).message !== "人名候補の確認をキャンセルしました") {
        setReviewError((err as Error).message);
      }
    } finally {
      setReviewSubmitting(false);
    }
  }

  async function handleTriage(status: "watching" | "dismissed") {
    setReviewSubmitting(true);
    setReviewError(null);
    try {
      const res = await fetch(`/api/agents/${selectedRun.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ triageStatus: status }),
      });
      if (!res.ok) throw new Error("記録に失敗しました");
      await refreshRuns();
    } catch (err) {
      setReviewError((err as Error).message);
    } finally {
      setReviewSubmitting(false);
    }
  }

  // docs/memo.md「相談、Journal、提案を削除（アーカイブ）したい」対応。誤って起票した・
  // テストで作った等の相談を、相談履歴一覧・AIの判断材料から除外する（却下とは独立の軸）。
  async function handleToggleArchived() {
    setReviewSubmitting(true);
    setReviewError(null);
    try {
      const res = await fetch(`/api/agents/${selectedRun.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: !selectedRun.archivedAt }),
      });
      if (!res.ok) throw new Error("記録に失敗しました");
      await refreshRuns();
    } catch (err) {
      setReviewError((err as Error).message);
    } finally {
      setReviewSubmitting(false);
    }
  }

  async function sendDecision(text: string) {
    if (!text.trim()) return;
    setDeciding(true);
    setDecideError(null);
    try {
      const { res, data } = await fetchWithNameConfirm(
        `/api/agents/${selectedRun.id}/decide`,
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
    if (!selectedOptionId) return;
    const opt = selectedRun.yieldRequest?.options.find((o) => o.id === selectedOptionId);
    if (!opt) return;
    sendDecision(`Option ${opt.id}（${opt.label}）を採用します。この方針で進めてください。`);
  }

  function handleFocusChat() {
    document.getElementById("chat-page-input")?.focus();
  }

  async function handleAdoptThemes() {
    setThemesSubmitting(true);
    setDecideError(null);
    try {
      const res = await fetch(`/api/agents/${selectedRun.id}/themes`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "テーマの採用に失敗しました");
      await refreshRuns();
    } catch (err) {
      setDecideError((err as Error).message);
    } finally {
      setThemesSubmitting(false);
    }
  }

  async function handleDismissThemes() {
    setThemesSubmitting(true);
    setDecideError(null);
    try {
      const res = await fetch(`/api/agents/${selectedRun.id}/themes`, { method: "DELETE" });
      if (!res.ok) throw new Error("テーマ提案の却下に失敗しました");
      await refreshRuns();
    } catch (err) {
      setDecideError((err as Error).message);
    } finally {
      setThemesSubmitting(false);
    }
  }

  // docs/memo.md「Agentが相談などから他Issueなどへ記録することができない」対応。
  // 「他Issueへの追記提案で追記対象を個別に選択できるようにする」対応でindicesを渡すよう拡張。
  async function handleAdoptIssueNotes(indices: number[]) {
    setIssueNotesSubmitting(true);
    setDecideError(null);
    try {
      const res = await fetch(`/api/agents/${selectedRun.id}/issue-notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ indices }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "追記の採用に失敗しました");
      await Promise.all([refreshIssues(), refreshRuns()]);
    } catch (err) {
      setDecideError((err as Error).message);
    } finally {
      setIssueNotesSubmitting(false);
    }
  }

  async function handleDismissIssueNotes(indices: number[]) {
    setIssueNotesSubmitting(true);
    setDecideError(null);
    try {
      const res = await fetch(`/api/agents/${selectedRun.id}/issue-notes`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ indices, reason: "dismissed" }),
      });
      if (!res.ok) throw new Error("追記提案の却下に失敗しました");
      await refreshRuns();
    } catch (err) {
      setDecideError((err as Error).message);
    } finally {
      setIssueNotesSubmitting(false);
    }
  }

  // docs/memo.md「却下だけでなく対応済みも」対応。却下（提案自体が誤り）と違い、別口ですでに
  // 対応済みであることをrunのログに残した上で提案を消す。
  async function handleMarkHandledIssueNotes(indices: number[]) {
    setIssueNotesSubmitting(true);
    setDecideError(null);
    try {
      const res = await fetch(`/api/agents/${selectedRun.id}/issue-notes`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ indices, reason: "handled" }),
      });
      if (!res.ok) throw new Error("追記提案を対応済みにできませんでした");
      await refreshRuns();
    } catch (err) {
      setDecideError((err as Error).message);
    } finally {
      setIssueNotesSubmitting(false);
    }
  }

  return (
    <>
      <h2>Lead Agentへの相談</h2>
      <OriginTrace
        journals={
          sourceJournal
            ? [sourceJournal]
            : selectedRun.sourceJournalId
              ? [
                  {
                    id: selectedRun.sourceJournalId,
                    rawText: journalExcerptFromTask(selectedRun.task) ?? "",
                  },
                ]
              : journalExcerptFromTask(selectedRun.task)
                ? [
                    {
                      id: "",
                      rawText: journalExcerptFromTask(selectedRun.task) ?? "",
                    },
                  ]
                : []
        }
      />
      <div className={styles.yieldBlock} style={{ marginBottom: 12 }}>
        {selectedRun.origin !== "manual" && !selectedRun.reviewed && (
          <>
            <strong>📋 ドラフト提案（起票待ち）— {ORIGIN_LABEL[selectedRun.origin]}</strong>
          </>
        )}
        {selectedRun.triageStatus && (
          <p style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
            {TRIAGE_LABEL[selectedRun.triageStatus]}
          </p>
        )}
        {selectedRun.archivedAt && (
          <p style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
            🗄 アーカイブ済み（相談履歴一覧・AIの判断材料からは除外されています）
          </p>
        )}
        <div className={styles.yieldActions}>
          {issueCandidates.length > 1 && (
            <div style={{ width: "100%", marginBottom: 8 }}>
              <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "0 0 6px" }}>
                AIが親なしの独立提案候補を複数出しています。起票する件にチェックを入れてください（Journal紐付けは先頭の1件のみ）。
              </p>
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {issueCandidates.map((c, i) => (
                  <li key={`${c.title}-${i}`} style={{ marginBottom: 4 }}>
                    <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: "0.875rem", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={candidateSelectedFlags[i] ?? false}
                        onChange={() => toggleCandidate(i)}
                        disabled={reviewSubmitting}
                        style={{ marginTop: 3 }}
                      />
                      <span>
                        <IdLinkedText text={c.title} />
                        {c.rationale ? (
                          <span style={{ color: "var(--text-muted)", display: "block", fontSize: "0.75rem" }}>
                            <IdLinkedText text={c.rationale} />
                          </span>
                        ) : null}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button
            className={styles.primaryBtn}
            style={{ width: "auto" }}
            disabled={reviewSubmitting || (issueCandidates.length > 1 && selectedCandidateTitles.length === 0)}
            onClick={handlePromoteToIssue}
          >
            {issueCandidates.length > 1
              ? `📌 選択した${selectedCandidateTitles.length}件を提案として残す`
              : "📌 提案として残す"}
          </button>
          <button className={styles.btnOutline} disabled={reviewSubmitting} onClick={() => handleTriage("watching")}>
            👀 様子見
          </button>
          <button className={styles.btnOutline} disabled={reviewSubmitting} onClick={() => handleTriage("dismissed")}>
            却下する（対応不要）
          </button>
          <button className={styles.btnOutline} disabled={reviewSubmitting} onClick={handleToggleArchived}>
            {selectedRun.archivedAt ? "アーカイブを解除" : "アーカイブする"}
          </button>
        </div>
        {reviewError && <p className={styles.errorText} role="alert">{reviewError}</p>}
      </div>
      <ExecutionState
        run={selectedRun}
        selectedOptionId={selectedOptionId}
        onSelectOption={setSelectedOptionId}
        onConfirmOption={handleConfirmOption}
        onFocusChat={handleFocusChat}
        deciding={deciding}
        stale={stale}
        onRetry={() => sendDecision("直前の処理がエラーで中断しました。同じ内容を踏まえて再度実行してください。")}
        onAdoptThemes={handleAdoptThemes}
        onDismissThemes={handleDismissThemes}
        themesSubmitting={themesSubmitting}
        onAdoptIssueNotes={handleAdoptIssueNotes}
        onDismissIssueNotes={handleDismissIssueNotes}
        onMarkHandledIssueNotes={handleMarkHandledIssueNotes}
        issueNotesSubmitting={issueNotesSubmitting}
      />
      <hr style={{ margin: "14px 0", border: "none", borderTop: "1px solid var(--border)" }} />
      <CopilotChat run={selectedRun} message={message} setMessage={setMessage} deciding={deciding} onDecide={sendDecision} inputId="chat-page-input" />
      {decideError && <p className={styles.errorText} role="alert">{decideError}</p>}
    </>
  );
}
