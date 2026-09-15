"use client";

import { useState } from "react";
import Link from "next/link";
import styles from "@/app/page.module.css";
import { CopilotChat, ExecutionState, type AgentRun } from "@/components/RunDetail";
import { OriginTrace } from "@/components/OriginTrace";
import { PendingAgentStartNotice } from "@/components/PendingAgentStartNotice";
import { Select } from "@/components/Select";
import { useAgentDecision } from "@/components/useAgentDecision";
import {
  useObjectives,
  useRuns,
  useSettingsRules,
  useSuggestion,
  useSuggestions,
  useTeams,
  useThemes,
} from "@/lib/hooks";
import { useNameCandidateConfirm } from "@/lib/useNameCandidateConfirm";
import {
  CONFIRM_PRIORITIES,
  CONFIRM_PRIORITY_META,
  SUGGESTION_REVIEW_STATUSES,
  SUGGESTION_REVIEW_STATUS_META,
  isRunStale,
  isSuggestionStrategyUnlinked,
  type ConfirmPriority,
  type SuggestionReviewStatus,
} from "@/lib/types";
import { journalExcerptFromTask, resolveSourceConsultRun } from "@/lib/origin-trace";
import { StrategyTrail } from "@/components/StrategyTrail";
import { buildIssueStrategyTrail } from "@/lib/strategy-trail";

// docs/2nd_pivot_version.md Phase 7。提案詳細: 確認状態・確認優先度・メモ・壁打ちに絞る。
export function SuggestionDetailContent({ id }: { id: string }) {
  const { suggestion, sourceJournals, suggestionLoaded, refreshSuggestion } = useSuggestion(id);
  const { refreshSuggestions } = useSuggestions();
  const { runs, pendingAgentStarts, refreshRuns } = useRuns();
  const { fetchWithNameConfirm, nameCandidateDialog } = useNameCandidateConfirm();
  const { objectives } = useObjectives();
  const { teams } = useTeams();
  const { themes } = useThemes();
  const { rules } = useSettingsRules();
  const staleRunIds = new Set(
    runs.filter((r) => isRunStale(r.status, r.updatedAt, rules.agentStaleAfterSeconds)).map((r) => r.id),
  );

  const linkedRun: AgentRun | null = suggestion ? runs.find((r) => r.id === suggestion.agentRunId) ?? null : null;
  const sourceConsult = suggestion
    ? resolveSourceConsultRun(
        {
          sourceRunId: suggestion.sourceRunId,
          agentRunId: suggestion.agentRunId,
        },
        runs,
      )
    : undefined;
  const pendingStart = pendingAgentStarts.find((p) => p.issueId === id) ?? null;

  const { selectedOptionId, setSelectedOptionId, message, setMessage, deciding, decideError, sendDecision, handleConfirmOption, handleFocusChat } =
    useAgentDecision({ linkedRun, fetchWithNameConfirm, refreshRuns });

  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [memoText, setMemoText] = useState("");
  const [saving, setSaving] = useState(false);

  async function patchSuggestion(body: Record<string, unknown>) {
    if (!suggestion) return;
    setSaving(true);
    try {
      const { res } = await fetchWithNameConfirm(`/api/suggestions/${suggestion.id}`, { method: "PATCH", body }, "保存する");
      if (res.ok) {
        await Promise.all([refreshSuggestion(), refreshSuggestions()]);
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleAddMemo() {
    if (!suggestion || !memoText.trim()) return;
    setSaving(true);
    try {
      const { res } = await fetchWithNameConfirm(
        `/api/suggestions/${suggestion.id}/memo`,
        { method: "POST", body: { text: memoText.trim() } },
        "保存する",
      );
      if (res.ok) {
        setMemoText("");
        await Promise.all([refreshSuggestion(), refreshSuggestions()]);
      }
    } finally {
      setSaving(false);
    }
  }

  if (!suggestion) {
    return <p className={styles.subtitle}>{!suggestionLoaded ? "読み込み中…" : "提案が見つかりません。"}</p>;
  }

  const originJournals =
    sourceJournals.length > 0
      ? sourceJournals
      : suggestion.sourceJournalId
        ? [{ id: suggestion.sourceJournalId, rawText: journalExcerptFromTask(sourceConsult?.task ?? linkedRun?.task ?? "") ?? "" }]
        : [];

  const trail = buildIssueStrategyTrail(
    {
      id: suggestion.id,
      title: suggestion.title,
      keyResultId: suggestion.keyResultId,
    },
    objectives,
  );

  return (
    <>
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
                disabled={saving}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button
                  className={styles.primaryBtn}
                  style={{ width: "auto" }}
                  disabled={saving}
                  onClick={async () => {
                    await patchSuggestion({ title: titleDraft });
                    setTitleEditing(false);
                  }}
                >
                  保存
                </button>
                <button className={styles.btnOutline} disabled={saving} onClick={() => setTitleEditing(false)}>
                  キャンセル
                </button>
              </div>
            </div>
          ) : (
            <h1 className={styles.issueTitle}>
              {suggestion.title}{" "}
              <button
                type="button"
                className={styles.btnOutline}
                style={{ fontSize: "0.75rem", padding: "2px 8px" }}
                onClick={() => {
                  setTitleDraft(suggestion.title);
                  setTitleEditing(true);
                }}
              >
                編集
              </button>
            </h1>
          )}
        </div>
      </div>

      <div className={styles.panel} style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-end" }}>
        <label className={styles.field} style={{ margin: 0 }}>
          <span className={styles.fieldCaption}>確認状態</span>
          <Select
            value={suggestion.reviewStatus}
            disabled={saving}
            onChange={(v) => void patchSuggestion({ reviewStatus: v as SuggestionReviewStatus })}
            options={SUGGESTION_REVIEW_STATUSES.map((v) => ({
              value: v,
              label: `${SUGGESTION_REVIEW_STATUS_META[v].icon} ${SUGGESTION_REVIEW_STATUS_META[v].label}`,
            }))}
          />
        </label>
        <label className={styles.field} style={{ margin: 0 }}>
          <span className={styles.fieldCaption}>確認優先度</span>
          <Select
            value={suggestion.confirmPriority}
            disabled={saving}
            onChange={(v) => void patchSuggestion({ confirmPriority: v as ConfirmPriority })}
            options={CONFIRM_PRIORITIES.map((v) => ({
              value: v,
              label: `${CONFIRM_PRIORITY_META[v].icon} ${CONFIRM_PRIORITY_META[v].label}`,
            }))}
          />
        </label>
      </div>

      {isSuggestionStrategyUnlinked(suggestion) && (
        <p className={styles.subtitle}>テーマ／KR 未接続（任意）。方針の縦糸につなぐ場合は下で設定できます。</p>
      )}
      <StrategyTrail nodes={trail} currentKind="issue" />

      <div className={styles.panel} style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        <label className={styles.field} style={{ margin: 0, minWidth: 160 }}>
          <span className={styles.fieldCaption}>チーム</span>
          <Select
            value={suggestion.teamId ?? ""}
            disabled={saving}
            onChange={(v) => void patchSuggestion({ teamId: v || null })}
            options={[{ value: "", label: "（なし）" }, ...teams.filter((t) => !t.archived).map((t) => ({ value: t.id, label: t.name }))]}
          />
        </label>
        <label className={styles.field} style={{ margin: 0, minWidth: 160 }}>
          <span className={styles.fieldCaption}>テーマ</span>
          <Select
            value={suggestion.themeId ?? ""}
            disabled={saving}
            onChange={(v) => void patchSuggestion({ themeId: v || null })}
            options={[{ value: "", label: "（なし）" }, ...themes.map((t) => ({ value: t.id, label: t.title }))]}
          />
        </label>
        <label className={styles.field} style={{ margin: 0, minWidth: 200 }}>
          <span className={styles.fieldCaption}>Key Result</span>
          <Select
            value={suggestion.keyResultId ?? ""}
            disabled={saving}
            onChange={(v) => void patchSuggestion({ keyResultId: v || null })}
            options={[
              { value: "", label: "（なし）" },
              ...objectives.flatMap((o) =>
                o.keyResults.map((kr) => ({ value: kr.id, label: `${o.title} ＞ ${kr.title}` })),
              ),
            ]}
          />
        </label>
      </div>

      <div className={styles.panel}>
        <h2 style={{ marginTop: 0 }}>メモ</h2>
        <div className={styles.journalInputRow}>
          <textarea
            value={memoText}
            onChange={(e) => setMemoText(e.target.value)}
            rows={3}
            placeholder="考えたこと・確認したこと（例: 来週の1on1で触れる）"
            disabled={saving}
          />
          <button className={styles.primaryBtn} style={{ width: "auto" }} disabled={saving || !memoText.trim()} onClick={() => void handleAddMemo()}>
            追記
          </button>
        </div>
        {suggestion.memos.length === 0 ? (
          <p className={styles.subtitle}>まだメモはありません。</p>
        ) : (
          <ul style={{ margin: "12px 0 0", paddingLeft: 18 }}>
            {[...suggestion.memos].reverse().map((m) => (
              <li key={m.id} style={{ marginBottom: 8 }}>
                <span className={styles.tableMuted}>{new Date(m.createdAt).toLocaleString("ja-JP")} — </span>
                {m.text}
              </li>
            ))}
          </ul>
        )}
      </div>

      {decideError && (
        <p className={styles.errorText} role="alert">
          {decideError}
        </p>
      )}
      {pendingStart && <PendingAgentStartNotice pending={pendingStart} />}

      <div className={styles.issueColumns}>
        <div className={styles.panel}>
          <h2>判断・提案（Agent）</h2>
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
            />
          ) : (
            <p className={styles.subtitle}>
              この提案に紐づく Agent Run はありません。
              {sourceConsult ? (
                <>
                  {" "}
                  <Link href={`/chat?runId=${encodeURIComponent(sourceConsult.id)}`}>元の相談を開く</Link>
                  から続きの壁打ちができます。
                </>
              ) : (
                <>
                  {" "}
                  <Link href="/chat">何でも相談</Link>から続けることもできます。
                </>
              )}
            </p>
          )}
        </div>
        <div className={styles.panel}>
          <h2>壁打ち</h2>
          {linkedRun ? (
            <CopilotChat
              run={linkedRun}
              message={message}
              setMessage={setMessage}
              deciding={deciding}
              onDecide={sendDecision}
              inputId="suggestion-chat-input"
            />
          ) : (
            <p className={styles.subtitle}>
              {sourceConsult
                ? "相談から提案化した場合、会話は相談履歴側に残っています。「元の相談を開く」から続けられます。"
                : "Agent Runが無いため会話はありません。"}
            </p>
          )}
        </div>
      </div>

      {nameCandidateDialog}
    </>
  );
}
