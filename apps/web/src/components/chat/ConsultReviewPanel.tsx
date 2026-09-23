import { useState } from "react";
import styles from "../../styles/page.module.css";
import { CopilotChat, ExecutionState, type AgentRun } from "../RunDetail";
import { listSuggestionCandidatesFromProposal } from "../run-detail/run-view-helpers";
import { runFallbackTitle } from "../runDetailMeta";
import { OriginTrace, type OriginTraceJournal } from "../OriginTrace";
import { IdLinkedText } from "../IdLinkedText";
import { useSuggestionPeek } from "../useSuggestionPeek";
import type { useNameCandidateConfirm } from "../../lib/useNameCandidateConfirm";
import { api, rpcInit } from "../../lib/api-client";
import { truncateForTitle } from "@emther/core/types";
import { journalExcerptFromTask } from "@emther/core/origin-trace";
import { dateStringToNoonTimestamp } from "@emther/core/journal-date-parser";
import type { Suggestion } from "@emther/core/types";
import type { AgentRunMutationResponse, SuggestionMutationResponse } from "@emther/api-contract";

const ORIGIN_LABEL: Record<AgentRun["origin"], string> = {
  manual: "",
  "auto-anomaly": "Journal自動分析",
  "auto-summary": "朝のサマリー",
  "auto-suggestion-update": "提案更新分析",
  "auto-distill": "状況蒸留",
  "auto-journal-batch": "Journal集約解釈",
  "auto-weekly-report": "週次レビュー",
  "auto-monthly-report": "月次レビュー",
};

const TRIAGE_LABEL: Record<"watching" | "dismissed", string> = {
  watching: "👀 様子見",
  dismissed: "却下",
};

/** 様子見の次確認日プリセット（トリアージ時点からのローリング。曜日固定にしない）。 */
const WATCH_NEXT_REVIEW_PRESETS: { label: string; days: number }[] = [
  { label: "3日後", days: 3 },
  { label: "1週間後", days: 7 },
  { label: "2週間後", days: 14 },
  { label: "1ヶ月後", days: 30 },
];

function noonDaysFromNow(days: number, now = Date.now()): number {
  const d = new Date(now);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return dateStringToNoonTimestamp(`${y}-${m}-${day}`) ?? d.getTime();
}

type SuggestionCandidate = ReturnType<typeof listSuggestionCandidatesFromProposal>[number];
type CandidatePick = { runId: string; selected: boolean[] } | null;

type Props = {
  selectedRun: AgentRun;
  sourceJournal: OriginTraceJournal | null;
  suggestionCandidates: SuggestionCandidate[];
  candidatePick: CandidatePick;
  setCandidatePick: (pick: CandidatePick) => void;
  stale: boolean;
  fetchWithNameConfirm: ReturnType<typeof useNameCandidateConfirm>["fetchWithNameConfirm"];
  refreshRuns: () => Promise<void>;
  refreshSuggestions: () => Promise<void>;
  // docs/suggestion_organize_via_consult.md。整理差分のbefore値表示用。
  suggestions: Suggestion[];
  // docs/memo.md「Journalで個人名が混じった場合、編集し直しても同じ相談に接続されて
  // AIを再度実行できない」対応。リセット後に新しく生まれたrunを選択状態にする。
  onReanalyzed?: (runId: string) => void;
};

// 「何でも相談」画面の、選択中run（Lead Agentへの相談）の右パネル。提案候補の選択・
// 様子見/却下・ExecutionState・CopilotChatをまとめて持つ。candidatePickは、URL経由の
// run切り替え（selectHistoryRunを経ないケース）でも既存の挙動を変えないよう親
// （ChatPageInner）に残している。
export function ConsultReviewPanel({
  selectedRun,
  sourceJournal,
  suggestionCandidates,
  candidatePick,
  setCandidatePick,
  stale,
  fetchWithNameConfirm,
  refreshRuns,
  refreshSuggestions,
  suggestions,
  onReanalyzed,
}: Props) {
  const suggestionPeek = useSuggestionPeek();
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [deciding, setDeciding] = useState(false);
  const [decideError, setDecideError] = useState<string | null>(null);
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [themesSubmitting, setThemesSubmitting] = useState(false);
  const [suggestionNotesSubmitting, setSuggestionNotesSubmitting] = useState(false);
  const [suggestionUpdatesSubmitting, setSuggestionUpdatesSubmitting] = useState(false);
  const currentSuggestions = new Map(suggestions.map((s) => [s.id, s]));
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  // この相談（selectedRun）から生まれた提案一覧
  const createdSuggestionsFromRun = suggestions.filter(
    (s) => s.sourceRunId === selectedRun.id || s.agentRunId === selectedRun.id,
  );
  const existingTitles = new Set(
    createdSuggestionsFromRun.flatMap((s) => [s.title.trim(), truncateForTitle(s.title).trim()]),
  );

  // 各候補が既に提案化されているか判定
  const candidatePromotedFlags = suggestionCandidates.map((c) =>
    existingTitles.has(c.title.trim()) || existingTitles.has(truncateForTitle(c.title).trim()),
  );

  const candidateSelectedFlags =
    candidatePick?.runId === selectedRun.id && candidatePick.selected.length === suggestionCandidates.length
      ? candidatePick.selected.map((sel, i) => (candidatePromotedFlags[i] ? false : sel))
      : suggestionCandidates.map((_, i) => !candidatePromotedFlags[i]);

  const selectedCandidateTitles = suggestionCandidates
    .filter((_, i) => !candidatePromotedFlags[i] && candidateSelectedFlags[i])
    .map((c) => c.title);

  const fallbackTitle = runFallbackTitle(selectedRun);
  const isSinglePromoted =
    suggestionCandidates.length === 1
      ? (candidatePromotedFlags[0] ?? false)
      : existingTitles.has(fallbackTitle.trim()) ||
        existingTitles.has(truncateForTitle(fallbackTitle).trim()) ||
        createdSuggestionsFromRun.length > 0;

  function toggleCandidate(index: number) {
    if (candidatePromotedFlags[index]) return;
    const next = [...candidateSelectedFlags];
    next[index] = !next[index];
    setCandidatePick({ runId: selectedRun.id, selected: next });
  }

  async function handlePromoteToSuggestion() {
    const titles =
      suggestionCandidates.length > 1
        ? selectedCandidateTitles
        : suggestionCandidates.length === 1
          ? [suggestionCandidates[0].title]
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
        createdIds.push((data as SuggestionMutationResponse).suggestion.id);
      }
      await Promise.all([refreshSuggestions(), refreshRuns()]);
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

  async function handleTriage(status: "watching" | "dismissed", nextReviewAt?: number) {
    setReviewSubmitting(true);
    setReviewError(null);
    try {
      const body: { triageStatus: "watching" | "dismissed"; triageNextReviewAt?: number } = {
        triageStatus: status,
      };
      if (status === "watching" && nextReviewAt !== undefined) {
        body.triageNextReviewAt = nextReviewAt;
      }
      const res = await api.api.agents[":id"].review.$post(rpcInit({
        param: { id: selectedRun.id },
        json: body,
      }));
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
      const res = await api.api.agents[":id"].review.$post(rpcInit({
        param: { id: selectedRun.id },
        json: { archived: !selectedRun.archivedAt },
      }));
      if (!res.ok) throw new Error("記録に失敗しました");
      await refreshRuns();
    } catch (err) {
      setReviewError((err as Error).message);
    } finally {
      setReviewSubmitting(false);
    }
  }

  // docs/memo.md「Journalで個人名が混じった場合、編集し直しても同じ相談に接続されて
  // AIを再度実行できない」対応。実名リークでerrorのまま詰まったrunを、EMが内容を
  // 直した後に1クリックでやり直せるようにする。今のrunはアーカイブして「現行の相談」から
  // 外し（ログは残す）、同じタスク・Journal本文で新しい相談を起動し直す。
  async function handleResetAndReanalyze() {
    setResetSubmitting(true);
    setResetError(null);
    try {
      const archiveRes = await api.api.agents[":id"].review.$post(rpcInit({
        param: { id: selectedRun.id },
        json: { archived: true },
      }));
      if (!archiveRes.ok) throw new Error("相談のアーカイブに失敗しました");

      let newRunId: string;
      if (selectedRun.sourceJournalId) {
        const { res, data } = await fetchWithNameConfirm(
          `/api/journal/${selectedRun.sourceJournalId}/analyze`,
          { method: "POST", body: {} },
          "分析を開始する",
        );
        if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? "再分析の起動に失敗しました");
        newRunId = (data as AgentRunMutationResponse).run.id;
      } else {
        const { res, data } = await fetchWithNameConfirm(
          "/api/agents",
          {
            method: "POST",
            body: {
              agentName: selectedRun.agentName,
              task: selectedRun.task,
            },
          },
          "送信する",
        );
        if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? "再分析の起動に失敗しました");
        newRunId = (data as AgentRunMutationResponse).run.id;
      }

      await refreshRuns();
      onReanalyzed?.(newRunId);
    } catch (err) {
      if ((err as Error).message !== "人名候補の確認をキャンセルしました") {
        setResetError((err as Error).message);
      }
    } finally {
      setResetSubmitting(false);
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
      const res = await api.api.agents[":id"].themes.$post({
        param: { id: selectedRun.id },
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
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
      const res = await api.api.agents[":id"].themes.$delete({
        param: { id: selectedRun.id },
      });
      if (!res.ok) throw new Error("テーマ提案の却下に失敗しました");
      await refreshRuns();
    } catch (err) {
      setDecideError((err as Error).message);
    } finally {
      setThemesSubmitting(false);
    }
  }

  // docs/memo.md「Agentが相談などから他提案などへ記録することができない」対応。
  // 「他提案への追記提案で追記対象を個別に選択できるようにする」対応でindicesを渡すよう拡張。
  async function handleAdoptSuggestionNotes(indices: number[]) {
    setSuggestionNotesSubmitting(true);
    setDecideError(null);
    try {
      const res = await api.api.agents[":id"]["suggestion-notes"].$post(rpcInit({
        param: { id: selectedRun.id },
        json: { indices },
      }));
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(data?.error ?? "追記の採用に失敗しました");
      await Promise.all([refreshSuggestions(), refreshRuns()]);
    } catch (err) {
      setDecideError((err as Error).message);
    } finally {
      setSuggestionNotesSubmitting(false);
    }
  }

  async function handleDismissSuggestionNotes(indices: number[]) {
    setSuggestionNotesSubmitting(true);
    setDecideError(null);
    try {
      const res = await api.api.agents[":id"]["suggestion-notes"].$delete(rpcInit({
        param: { id: selectedRun.id },
        json: { indices, reason: "dismissed" },
      }));
      if (!res.ok) throw new Error("追記提案の却下に失敗しました");
      await refreshRuns();
    } catch (err) {
      setDecideError((err as Error).message);
    } finally {
      setSuggestionNotesSubmitting(false);
    }
  }

  // docs/memo.md「却下だけでなく対応済みも」対応。却下（提案自体が誤り）と違い、別口ですでに
  // 対応済みであることをrunのログに残した上で提案を消す。
  async function handleMarkHandledSuggestionNotes(indices: number[]) {
    setSuggestionNotesSubmitting(true);
    setDecideError(null);
    try {
      const res = await api.api.agents[":id"]["suggestion-notes"].$delete(rpcInit({
        param: { id: selectedRun.id },
        json: { indices, reason: "handled" },
      }));
      if (!res.ok) throw new Error("追記提案を対応済みにできませんでした");
      await refreshRuns();
    } catch (err) {
      setDecideError((err as Error).message);
    } finally {
      setSuggestionNotesSubmitting(false);
    }
  }

  // docs/suggestion_organize_via_consult.md「5. 反映の契約（HITL）」対応。
  async function handleAdoptSuggestionUpdates(indices: number[]) {
    setSuggestionUpdatesSubmitting(true);
    setDecideError(null);
    try {
      const res = await api.api.agents[":id"]["suggestion-updates"].$post(rpcInit({
        param: { id: selectedRun.id },
        json: { indices },
      }));
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(data?.error ?? "整理差分の反映に失敗しました");
      await Promise.all([refreshSuggestions(), refreshRuns()]);
    } catch (err) {
      setDecideError((err as Error).message);
    } finally {
      setSuggestionUpdatesSubmitting(false);
    }
  }

  async function handleDismissSuggestionUpdates(indices: number[]) {
    setSuggestionUpdatesSubmitting(true);
    setDecideError(null);
    try {
      const res = await api.api.agents[":id"]["suggestion-updates"].$delete(rpcInit({
        param: { id: selectedRun.id },
        json: { indices },
      }));
      if (!res.ok) throw new Error("整理差分の却下に失敗しました");
      await refreshRuns();
    } catch (err) {
      setDecideError((err as Error).message);
    } finally {
      setSuggestionUpdatesSubmitting(false);
    }
  }

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Lead Agentへの相談</h2>
        <button
          className={styles.btnOutline}
          style={{ fontSize: "0.75rem", padding: "4px 8px" }}
          disabled={reviewSubmitting}
          onClick={handleToggleArchived}
        >
          {selectedRun.archivedAt ? "アーカイブを解除" : "アーカイブする"}
        </button>
      </div>
      <OriginTrace
        journals={
          sourceJournal && sourceJournal.id === selectedRun.sourceJournalId
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
      <div style={{ marginBottom: 12 }}>
        {selectedRun.origin !== "manual" && !selectedRun.reviewed && (
          <div style={{ marginTop: 8 }}>
            <strong>📋 ドラフト提案（起票待ち）— {ORIGIN_LABEL[selectedRun.origin]}</strong>
          </div>
        )}
        {selectedRun.triageStatus && (
          <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 8, marginBottom: 0 }}>
            {TRIAGE_LABEL[selectedRun.triageStatus]}
            {selectedRun.triageStatus === "watching" && selectedRun.triageNextReviewAt
              ? ` · 次確認 ${new Date(selectedRun.triageNextReviewAt).toLocaleDateString("ja-JP")}`
              : null}
          </p>
        )}
        {selectedRun.archivedAt && (
          <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 8, marginBottom: 0 }}>
            🗄 アーカイブ済み（相談履歴一覧・AIの判断材料からは除外されています）
          </p>
        )}
        {selectedRun.status === "error" && !selectedRun.archivedAt && (
          // docs/memo.md「Journalで個人名が混じった場合、編集し直しても同じ相談に接続されて
          // AIを再度実行できない」対応。実名リーク等でこのrunがエラーのまま詰まっている
          // 可能性があるため、内容を直した前提で1クリックでやり直せる導線を出す。
          // Journal起点以外の相談（手動入力など）でも同様にリセットして再分析できるようにする。
          <div style={{ margin: "8px 0", padding: 8, border: "1px solid var(--border)", borderRadius: 6 }}>
            <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "0 0 6px" }}>
              {selectedRun.sourceJournalId
                ? "この相談はエラーで停止しています（実名の混入など、Journal側の内容が原因のことがあります）。Journal本文を直した場合は、この相談をアーカイブしてリセットし、直した内容で再分析できます。"
                : "この相談はエラーで停止しています（実名の混入や外部APIエラーなどが原因のことがあります）。問題を解消したあと、この相談をアーカイブしてリセットし、同じ内容で再分析できます。"}
            </p>
            <button className={styles.btnOutline} disabled={resetSubmitting} onClick={() => void handleResetAndReanalyze()}>
              {resetSubmitting ? "リセット中…" : "🔁 相談をリセットして再分析する"}
            </button>
            {resetError && (
              <p className={styles.errorText} role="alert" style={{ marginTop: 6 }}>
                {resetError}
              </p>
            )}
          </div>
        )}
        {reviewError && <p className={styles.errorText} role="alert" style={{ marginTop: 8, marginBottom: 0 }}>{reviewError}</p>}
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
        onAdoptSuggestionNotes={handleAdoptSuggestionNotes}
        onDismissSuggestionNotes={handleDismissSuggestionNotes}
        onMarkHandledSuggestionNotes={handleMarkHandledSuggestionNotes}
        suggestionNotesSubmitting={suggestionNotesSubmitting}
        onAdoptSuggestionUpdates={handleAdoptSuggestionUpdates}
        onDismissSuggestionUpdates={handleDismissSuggestionUpdates}
        suggestionUpdatesSubmitting={suggestionUpdatesSubmitting}
        currentSuggestions={currentSuggestions}
      />
      {selectedRun.status === "idle" && selectedRun.proposal && (
        <div className={styles.yieldBlock} style={{ marginTop: 12 }}>
          <strong>
            📋 この相談への結論
            {(selectedRun.triageStatus || createdSuggestionsFromRun.length > 0) && (
              <span style={{ marginLeft: 8, color: "var(--yellow-fg)" }}>
                [{selectedRun.triageStatus ? (selectedRun.triageStatus === "watching" ? "様子見" : "却下") : "提案化済み"}]
              </span>
            )}
          </strong>
          {suggestionCandidates.length > 1 && (
            <div style={{ width: "100%", margin: "8px 0" }}>
              <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "0 0 6px" }}>
                AIが親なしの独立提案候補を複数出しています。起票する件にチェックを入れてください（Journal紐付けは先頭の1件のみ）。
              </p>
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {suggestionCandidates.map((c, i) => {
                  const isPromoted = candidatePromotedFlags[i];
                  return (
                    <li key={`${c.title}-${i}`} style={{ marginBottom: 4 }}>
                      <label
                        style={{
                          display: "flex",
                          gap: 8,
                          alignItems: "flex-start",
                          fontSize: "0.875rem",
                          cursor: isPromoted ? "default" : "pointer",
                          opacity: isPromoted ? 0.6 : 1,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={candidateSelectedFlags[i] ?? false}
                          onChange={() => toggleCandidate(i)}
                          disabled={reviewSubmitting || isPromoted}
                          style={{ marginTop: 3 }}
                        />
                        <span>
                          <IdLinkedText text={c.title} />
                          {isPromoted && (
                            <span
                              style={{
                                marginLeft: 6,
                                fontSize: "0.7rem",
                                color: "var(--yellow-fg)",
                                border: "1px solid var(--border)",
                                padding: "1px 5px",
                                borderRadius: 4,
                              }}
                            >
                              提案済み
                            </span>
                          )}
                          {c.rationale ? (
                            <span style={{ color: "var(--text-muted)", display: "block", fontSize: "0.75rem" }}>
                              <IdLinkedText text={c.rationale} />
                            </span>
                          ) : null}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          <div className={styles.yieldActions} style={{ marginTop: suggestionCandidates.length > 1 ? 0 : 8 }}>
            <button
              className={styles.primaryBtn}
              style={{ width: "auto" }}
              disabled={
                reviewSubmitting ||
                (suggestionCandidates.length > 1 ? selectedCandidateTitles.length === 0 : isSinglePromoted)
              }
              onClick={handlePromoteToSuggestion}
            >
              {suggestionCandidates.length > 1
                ? selectedCandidateTitles.length > 0
                  ? `📌 選択した${selectedCandidateTitles.length}件を提案として残す`
                  : candidatePromotedFlags.every(Boolean)
                    ? "すべての候補を提案済み"
                    : "起票する候補を選択"
                : isSinglePromoted
                  ? "📌 提案済み"
                  : "📌 提案として残す"}
            </button>
            <button className={styles.btnOutline} disabled={reviewSubmitting} onClick={() => handleTriage("watching")}>
              {selectedRun.triageStatus === "watching" ? "👀 継続して様子見する" : "👀 様子見する"}
            </button>
            <button className={styles.btnOutline} disabled={reviewSubmitting} onClick={() => handleTriage("dismissed")}>
              却下する（対応不要）
            </button>
          </div>
          <div style={{ marginTop: 8 }}>
            <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "0 0 6px" }}>
              把握済みで日次に出したくないとき — 次の確認日を指定して様子見（トリアージ時点からの日数）
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {WATCH_NEXT_REVIEW_PRESETS.map((p) => (
                <button
                  key={p.days}
                  type="button"
                  className={styles.btnOutline}
                  style={{ fontSize: "0.75rem", padding: "4px 8px" }}
                  disabled={reviewSubmitting}
                  onClick={() => handleTriage("watching", noonDaysFromNow(p.days))}
                >
                  {p.label}に確認
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      <hr style={{ margin: "14px 0", border: "none", borderTop: "1px solid var(--border)" }} />
      <CopilotChat run={selectedRun} message={message} setMessage={setMessage} deciding={deciding} onDecide={sendDecision} inputId="chat-page-input" />
      {decideError && <p className={styles.errorText} role="alert">{decideError}</p>}
    </>
  );
}
