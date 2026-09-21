import { useState } from "react";
import { Link } from "react-router";
import styles from "../styles/page.module.css";
import { CopilotChat, ExecutionState, type AgentRun } from "./RunDetail";
import { IdLinkedText } from "./IdLinkedText";
import { OriginTrace } from "./OriginTrace";
import { PendingAgentStartNotice } from "./PendingAgentStartNotice";
import { Select } from "./Select";
import { useAgentDecision } from "./useAgentDecision";
import {
  useRuns,
  useSettingsRules,
  useSuggestion,
  useSuggestions,
  useTeams,
  useThemes,
} from "../lib/queries";
import { useNameCandidateConfirm } from "../lib/useNameCandidateConfirm";
import { dateStringToNoonTimestamp, timestampToDateInputValue } from "@emther/core/journal-date-parser";
import {
  CONFIRM_PRIORITIES,
  CONFIRM_PRIORITY_META,
  SUGGESTION_REVIEW_STATUSES,
  SUGGESTION_REVIEW_STATUS_META,
  isRunStale,
  isSuggestionReviewOverdue,
  isSuggestionStrategyUnlinked,
  type ConfirmPriority,
  type SuggestionReviewStatus,
} from "@emther/core/types";
import { journalExcerptFromTask, resolveSourceConsultRun } from "@emther/core/origin-trace";
import { StrategyTrail } from "./StrategyTrail";
import { buildSuggestionStrategyTrail } from "@emther/core/strategy-trail";

// docs/2nd_pivot_version.md Phase 7。提案詳細: 確認状態・確認優先度・メモ・壁打ちに絞る。
export function SuggestionDetailContent({ id }: { id: string }) {
  // eslint-disable-next-line react-hooks/purity -- 確認期日の期日超過表示にのみ使う
  const now = Date.now();
  const { suggestion, sourceJournals, suggestionLoaded, refreshSuggestion } = useSuggestion(id);
  const { refreshSuggestions } = useSuggestions();
  const { runs, pendingAgentStarts, refreshRuns } = useRuns();
  const { fetchWithNameConfirm, nameCandidateDialog } = useNameCandidateConfirm();
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
  const pendingStart = pendingAgentStarts.find((p) => p.suggestionId === id) ?? null;

  // docs/memo.md「判断・提案（Agent）／壁打ちにも元の相談の内容を反映し、やり取りを継続
  // できるようにしたい」対応。提案に専用のAgent Run（linkedRun）がまだ無い場合が多く
  // （相談から提案化しても agentRunId は付与されない設計——docs/memo.md「提案化後も
  // 相談履歴に残す」対応参照）、その間は「元の相談を開く」への片道リンクしか出せず、
  // 会話の続きがここで見えなかった。linkedRunが無ければ、代わりにsourceConsult
  // （元の相談のAgent Run。/chatのConsultReviewPanelと同じ実体）をそのまま表示・継続の
  // 対象にする。
  const activeRun = linkedRun ?? sourceConsult ?? null;
  const showingSourceConsult = !linkedRun && !!sourceConsult;

  const { selectedOptionId, setSelectedOptionId, message, setMessage, deciding, decideError, sendDecision, handleConfirmOption, handleFocusChat } =
    useAgentDecision({ linkedRun: activeRun, fetchWithNameConfirm, refreshRuns });

  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [memoText, setMemoText] = useState("");
  const [saving, setSaving] = useState(false);
  const [detailRefreshing, setDetailRefreshing] = useState(false);
  const [detailRefreshError, setDetailRefreshError] = useState<string | null>(null);
  const [detailEditing, setDetailEditing] = useState(false);
  const [detailDraftConclusion, setDetailDraftConclusion] = useState("");
  const [detailDraftFactsText, setDetailDraftFactsText] = useState("");
  const [detailDraftLogic, setDetailDraftLogic] = useState("");
  const [detailDraftAdvice, setDetailDraftAdvice] = useState("");
  const [detailSaving, setDetailSaving] = useState(false);
  const [detailSaveError, setDetailSaveError] = useState<string | null>(null);
  const [columnsMode, setColumnsMode] = useState<"split" | "agent" | "chat">("split");

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

  // docs/memo.md「メモとは別に提案自体の詳細を残す単一の場所」対応。壁打ちの継続等で
  // 判断・提案（Agent）の内容が起票時から変わった場合に、現在の内容で詳細を更新し直す。
  async function handleRefreshDetail() {
    if (!suggestion || !activeRun) return;
    setDetailRefreshing(true);
    setDetailRefreshError(null);
    try {
      const { res, data } = await fetchWithNameConfirm(
        `/api/suggestions/${suggestion.id}`,
        { method: "PATCH", body: { refreshDetailFromRunId: activeRun.id } },
        "保存する",
      );
      if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? "詳細の更新に失敗しました");
      await refreshSuggestion();
    } catch (err) {
      if ((err as Error).message !== "人名候補の確認をキャンセルしました") {
        setDetailRefreshError((err as Error).message);
      }
    } finally {
      setDetailRefreshing(false);
    }
  }

  // ユーザー要望「提案の詳細をユーザーでも編集したい」対応。
  function handleStartDetailEdit() {
    if (!suggestion) return;
    setDetailDraftConclusion(suggestion.detail?.conclusion ?? "");
    setDetailDraftFactsText((suggestion.detail?.facts ?? []).join("\n"));
    setDetailDraftLogic(suggestion.detail?.logic ?? "");
    setDetailDraftAdvice(suggestion.detail?.advice ?? "");
    setDetailSaveError(null);
    setDetailEditing(true);
  }

  async function handleSaveDetail() {
    if (!suggestion) return;
    setDetailSaving(true);
    setDetailSaveError(null);
    try {
      const { res, data } = await fetchWithNameConfirm(
        `/api/suggestions/${suggestion.id}`,
        {
          method: "PATCH",
          body: {
            detail: {
              conclusion: detailDraftConclusion,
              facts: detailDraftFactsText.split("\n").map((f) => f.trim()).filter(Boolean),
              logic: detailDraftLogic,
              advice: detailDraftAdvice,
            },
          },
        },
        "保存する",
      );
      if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? "詳細の保存に失敗しました");
      await refreshSuggestion();
      setDetailEditing(false);
    } catch (err) {
      if ((err as Error).message !== "人名候補の確認をキャンセルしました") {
        setDetailSaveError((err as Error).message);
      }
    } finally {
      setDetailSaving(false);
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

  const trail = buildSuggestionStrategyTrail({ id: suggestion.id, title: suggestion.title });

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
              </button>{" "}
              <button
                type="button"
                className={styles.btnOutline}
                style={{ fontSize: "0.75rem", padding: "2px 8px" }}
                disabled={saving}
                onClick={() => void patchSuggestion({ archived: !suggestion.archivedAt })}
              >
                {suggestion.archivedAt ? "アーカイブを解除" : "アーカイブする"}
              </button>
            </h1>
          )}
        </div>
      </div>

      {suggestion.archivedAt && (
        // docs/memo.md「相談、Journal、提案を削除（アーカイブ）したい」対応。
        <p className={styles.subtitle} style={{ marginBottom: 10 }}>
          🗄 アーカイブ済み（一覧・AIの判断材料からは除外されています）
        </p>
      )}

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
        <label className={styles.field} style={{ margin: 0 }}>
          <span className={styles.fieldCaption}>
            確認期日{isSuggestionReviewOverdue(suggestion, now) && <span className={styles.errorText}> ⚠ 期日超過</span>}
          </span>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="date"
              aria-label="確認期日"
              value={suggestion.reviewDueAt ? timestampToDateInputValue(suggestion.reviewDueAt) : ""}
              disabled={saving}
              onChange={(e) => {
                const v = e.target.value;
                void patchSuggestion({ reviewDueAt: v ? (dateStringToNoonTimestamp(v) ?? null) : null });
              }}
            />
            {suggestion.reviewDueAt && (
              <button
                type="button"
                className={styles.btnOutline}
                style={{ fontSize: "0.75rem", padding: "2px 8px" }}
                disabled={saving}
                onClick={() => void patchSuggestion({ reviewDueAt: null })}
              >
                解除
              </button>
            )}
          </div>
        </label>
      </div>

      {isSuggestionStrategyUnlinked(suggestion) && (
        <p className={styles.subtitle}>テーマ 未接続（任意）。方針の縦糸につなぐ場合は下で設定できます。</p>
      )}
      <StrategyTrail nodes={trail} currentKind="suggestion" />

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
      </div>

      <div className={styles.panel}>
        <div className={styles.detailHeader} style={{ alignItems: "center" }}>
          <h2 style={{ margin: 0 }}>提案の詳細</h2>
          {!detailEditing && (
            <div style={{ display: "flex", gap: 8 }}>
              {activeRun?.proposal && (
                <button
                  type="button"
                  className={styles.btnOutline}
                  style={{ fontSize: "0.75rem", padding: "2px 8px" }}
                  disabled={detailRefreshing}
                  onClick={() => void handleRefreshDetail()}
                >
                  {detailRefreshing ? "更新中…" : "🔄 今の判断・提案の内容で更新する"}
                </button>
              )}
              <button
                type="button"
                className={styles.btnOutline}
                style={{ fontSize: "0.75rem", padding: "2px 8px" }}
                onClick={handleStartDetailEdit}
              >
                ✏️ 編集
              </button>
            </div>
          )}
        </div>
        <p className={styles.subtitle} style={{ marginTop: 4 }}>
          AIが起票時点で示した結論・根拠・進め方のアドバイスを、メモとは別に固定で残します。下の「判断・提案（Agent）」は続く壁打ちで内容が変わることがありますが、ここは更新するまで変わりません。EMが直接書き足す・書き直すこともできます。
        </p>
        {detailRefreshError && (
          <p className={styles.errorText} role="alert">
            {detailRefreshError}
          </p>
        )}
        {detailEditing ? (
          <div>
            <label className={styles.field}>
              <span className={styles.fieldCaption}>結論</span>
              <textarea
                rows={2}
                value={detailDraftConclusion}
                onChange={(e) => setDetailDraftConclusion(e.target.value)}
                disabled={detailSaving}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldCaption}>参照ファクト（1行に1件）</span>
              <textarea
                rows={3}
                value={detailDraftFactsText}
                onChange={(e) => setDetailDraftFactsText(e.target.value)}
                disabled={detailSaving}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldCaption}>判断ロジック</span>
              <textarea
                rows={3}
                value={detailDraftLogic}
                onChange={(e) => setDetailDraftLogic(e.target.value)}
                disabled={detailSaving}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldCaption}>進め方のアドバイス（任意）</span>
              <textarea
                rows={3}
                value={detailDraftAdvice}
                onChange={(e) => setDetailDraftAdvice(e.target.value)}
                disabled={detailSaving}
              />
            </label>
            {detailSaveError && (
              <p className={styles.errorText} role="alert">
                {detailSaveError}
              </p>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button
                className={styles.primaryBtn}
                style={{ width: "auto" }}
                disabled={detailSaving || !detailDraftConclusion.trim() || !detailDraftLogic.trim()}
                onClick={() => void handleSaveDetail()}
              >
                {detailSaving ? "保存中…" : "保存"}
              </button>
              <button
                className={styles.btnOutline}
                disabled={detailSaving}
                onClick={() => {
                  setDetailEditing(false);
                  setDetailSaveError(null);
                }}
              >
                キャンセル
              </button>
            </div>
          </div>
        ) : suggestion.detail ? (
          <>
            <div
              style={{
                padding: "12px 14px",
                backgroundColor: "var(--surface)",
                borderRadius: 8,
                border: "1px solid var(--border)",
                borderLeft: "4px solid var(--accent)",
                marginBottom: 12,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                <strong style={{ fontSize: "0.95rem", color: "var(--fg)" }}>✅ 結論</strong>
              </div>
              <p style={{ fontSize: "1rem", lineHeight: 1.6, margin: 0, fontWeight: 500 }}>
                <IdLinkedText text={suggestion.detail.conclusion} />
              </p>

              {suggestion.detail.advice && (
                <div
                  style={{
                    marginTop: 10,
                    paddingTop: 10,
                    borderTop: "1px dashed var(--border)",
                    fontSize: "0.85rem",
                    color: "var(--fg)",
                  }}
                >
                  <strong style={{ color: "var(--accent)" }}>💡 進め方のアドバイス: </strong>
                  <IdLinkedText text={suggestion.detail.advice} />
                </div>
              )}
            </div>

            {(suggestion.detail.facts.length > 0 ||
              Boolean(suggestion.detail.logic) ||
              (suggestion.detail.expansions && suggestion.detail.expansions.length > 0) ||
              (suggestion.detail.challenges && suggestion.detail.challenges.length > 0)) && (
              <details
                style={{
                  margin: "8px 0 12px",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  padding: "8px 12px",
                  background: "var(--bg-subtle, transparent)",
                }}
              >
                <summary
                  style={{
                    cursor: "pointer",
                    fontSize: "0.8rem",
                    color: "var(--text-muted)",
                    fontWeight: 500,
                    userSelect: "none",
                  }}
                >
                  🔍 判断根拠・思考プロセスを確認する
                  {suggestion.detail.facts.length > 0 ? `（参照ファクト ${suggestion.detail.facts.length}件）` : ""}
                </summary>

                <div style={{ marginTop: 10 }}>
                  {suggestion.detail.facts.length > 0 && (
                    <div style={{ marginBottom: 10 }}>
                      <strong style={{ fontSize: "0.75rem" }}>参照ファクト</strong>
                      <ul style={{ margin: "4px 0 8px 18px", fontSize: "0.75rem" }}>
                        {suggestion.detail.facts.map((f, i) => (
                          <li key={i}>
                            <IdLinkedText text={f} />
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {suggestion.detail.logic && (
                    <div style={{ marginBottom: 10 }}>
                      <strong style={{ fontSize: "0.75rem" }}>判断ロジック</strong>
                      <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "4px 0 8px" }}>
                        <IdLinkedText text={suggestion.detail.logic} />
                      </p>
                    </div>
                  )}

                  {suggestion.detail.expansions && suggestion.detail.expansions.length > 0 && (
                    <div style={{ marginBottom: 10 }}>
                      <strong style={{ fontSize: "0.75rem" }}>🔭 視点の広がり（Expand）</strong>
                      <ul style={{ margin: "4px 0 8px 18px", fontSize: "0.75rem" }}>
                        {suggestion.detail.expansions.map((e, i) => (
                          <li key={i}>
                            <IdLinkedText text={e} />
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {suggestion.detail.challenges && suggestion.detail.challenges.length > 0 && (
                    <div style={{ marginBottom: 10 }}>
                      <strong style={{ fontSize: "0.75rem" }}>❓ 前提への問い（Challenge）</strong>
                      <ul style={{ margin: "4px 0 8px 18px", fontSize: "0.75rem" }}>
                        {suggestion.detail.challenges.map((c, i) => (
                          <li key={i}>
                            <IdLinkedText text={c} />
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </details>
            )}

            <p className={styles.subtitle} style={{ marginTop: 0 }}>
              最終更新: {new Date(suggestion.detail.updatedAt).toLocaleString("ja-JP")}
            </p>
          </>
        ) : (
          <p className={styles.subtitle}>
            まだ詳細はありません（相談化されずに直接タイトルだけで作られた提案など）。
            {activeRun?.proposal
              ? "右上のボタンから、今の判断・提案の内容を詳細として残すか、"
              : "右上の「編集」から、"}
            編集から書き起こすこともできます。
          </p>
        )}
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

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, marginTop: 20 }}>
        <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", fontWeight: 500 }}>
          {columnsMode === "split"
            ? "並べて表示（判断と壁打ちを同時に確認）"
            : columnsMode === "agent"
              ? "判断・提案のみ全幅表示"
              : "壁打ちのみ全幅表示"}
        </span>
        <div className={styles.tabs} style={{ margin: 0, gap: 4 }}>
          <button
            type="button"
            className={`${styles.tabBtn} ${columnsMode === "split" ? styles.tabBtnActive : ""}`}
            style={{ fontSize: "0.75rem", padding: "3px 10px" }}
            onClick={() => setColumnsMode("split")}
          >
            ⚖️ 並べて表示
          </button>
          <button
            type="button"
            className={`${styles.tabBtn} ${columnsMode === "agent" ? styles.tabBtnActive : ""}`}
            style={{ fontSize: "0.75rem", padding: "3px 10px" }}
            onClick={() => setColumnsMode("agent")}
          >
            📋 判断・提案
          </button>
          <button
            type="button"
            className={`${styles.tabBtn} ${columnsMode === "chat" ? styles.tabBtnActive : ""}`}
            style={{ fontSize: "0.75rem", padding: "3px 10px" }}
            onClick={() => setColumnsMode("chat")}
          >
            💬 壁打ち
          </button>
        </div>
      </div>

      <div className={columnsMode === "split" ? styles.issueColumns : undefined}>
        {(columnsMode === "split" || columnsMode === "agent") && (
          <div className={styles.panel}>
            <h2>判断・提案（Agent）</h2>
            {showingSourceConsult && (
              <p className={styles.subtitle} style={{ marginTop: 0 }}>
                この提案専用の Agent Run はまだありません。元の相談の内容を表示しています。
                {" "}
                <Link to={`/chat?runId=${encodeURIComponent(activeRun!.id)}`}>相談履歴で開く</Link>
              </p>
            )}
            {activeRun ? (
              <ExecutionState
                run={activeRun}
                selectedOptionId={selectedOptionId}
                onSelectOption={setSelectedOptionId}
                onConfirmOption={handleConfirmOption}
                onFocusChat={handleFocusChat}
                deciding={deciding}
                stale={staleRunIds.has(activeRun.id)}
                onRetry={() => sendDecision("直前の処理がエラーで中断しました。同じ内容を踏まえて再度実行してください。")}
              />
            ) : (
              <p className={styles.subtitle}>
                この提案に紐づく Agent Run はありません。 <Link to="/chat">何でも相談</Link>から続けることもできます。
              </p>
            )}
          </div>
        )}
        {(columnsMode === "split" || columnsMode === "chat") && (
          <div className={styles.panel}>
            <h2>壁打ち</h2>
            {activeRun ? (
              <CopilotChat
                run={activeRun}
                message={message}
                setMessage={setMessage}
                deciding={deciding}
                onDecide={sendDecision}
                inputId="suggestion-chat-input"
              />
            ) : (
              <p className={styles.subtitle}>Agent Runが無いため会話はありません。</p>
            )}
          </div>
        )}
      </div>

      {nameCandidateDialog}
    </>
  );
}
