import { useState } from "react";
import styles from "../../styles/page.module.css";
import { Select } from "../Select";
import { GoalLinkSuggestPanel } from "../HierarchyLinkSuggestPanel";
import { api, rpcInit } from "../../lib/api-client";
import { useEntityHistory } from "../../lib/queries";
import { type Goal, type GoalHorizon, type GoalLinkSuggestion, type GoalStatus } from "@emther/core/types";
import type { GoalMutationResponse, ThemeGoalLinkSuggestResponse } from "@emther/api-contract";
import { treeTitle } from "./treeTitle";

type Props = {
  goals: Goal[];
  goalsLoaded: boolean;
  refreshGoals: () => Promise<void>;
  teamOptions: { value: string; label: string }[];
  refreshThemes: () => Promise<void>;
};

const HORIZON_OPTIONS: { value: GoalHorizon | ""; label: string }[] = [
  { value: "", label: "時間軸なし" },
  { value: "long", label: "遠いGoal" },
  { value: "mid", label: "中間Goal" },
  { value: "near", label: "近いGoal" },
];

const STATUS_OPTIONS: { value: GoalStatus; label: string }[] = [
  { value: "active", label: "active（注入する）" },
  { value: "achieved", label: "achieved（達成済み）" },
  { value: "abandoned", label: "abandoned（断念）" },
];

function horizonLabel(horizon: GoalHorizon | undefined): string {
  return HORIZON_OPTIONS.find((o) => o.value === (horizon ?? ""))?.label ?? "";
}

// Goal（EMとして見据えている到達したい状態）。docs/goal_policy_model_plan.md Decision 1。
// CRUD＋、未リンクの採用テーマへのAI紐づけ提案（HITLパターン）をここに集約する。
export function GoalsPanel({ goals, goalsLoaded, refreshGoals, teamOptions, refreshThemes }: Props) {
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const selectedGoal = editingGoalId ? goals.find((g) => g.id === editingGoalId) ?? null : null;
  const { history: goalHistory } = useEntityHistory("org", selectedGoal?.id ?? null);
  const [showInactiveGoals, setShowInactiveGoals] = useState(false);
  const visibleGoals = goals.filter((g) => showInactiveGoals || g.status === "active");

  const [newTitle, setNewTitle] = useState("");
  const [newElaboration, setNewElaboration] = useState("");
  const [newNote, setNewNote] = useState("");
  const [newTeamId, setNewTeamId] = useState("");
  const [newHorizon, setNewHorizon] = useState<GoalHorizon | "">("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editTitle, setEditTitle] = useState("");
  const [editElaboration, setEditElaboration] = useState("");
  const [editNote, setEditNote] = useState("");
  const [editTeamId, setEditTeamId] = useState("");
  const [editHorizon, setEditHorizon] = useState<GoalHorizon | "">("");
  const [editStatus, setEditStatus] = useState<GoalStatus>("active");
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // docs/goal_policy_model_plan.md Decision 3 / Phase 3。Goal起点で重点テーマ候補を先に置く。
  const [themeGenerating, setThemeGenerating] = useState(false);
  const [themeGenerateError, setThemeGenerateError] = useState<string | null>(null);
  const [themeGenerateResult, setThemeGenerateResult] = useState<string | null>(null);

  // 未リンク採用テーマへのGoal紐づけ提案（HITL・採用まで未反映）。
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [suggestPreview, setSuggestPreview] = useState<{
    suggestions: GoalLinkSuggestion[];
    source: "cloud" | "heuristic";
    fallbackReason?: string;
  } | null>(null);
  const [suggestApplyingId, setSuggestApplyingId] = useState<string | null>(null);

  function beginEdit(goal: Goal) {
    setEditTitle(goal.title);
    setEditElaboration(goal.elaboration ?? "");
    setEditNote(goal.note ?? "");
    setEditTeamId(goal.teamId ?? "");
    setEditHorizon(goal.horizon ?? "");
    setEditStatus(goal.status);
    setEditError(null);
    setEditingGoalId(goal.id);
  }

  function cancelEdit() {
    setEditingGoalId(null);
    setEditError(null);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.api.org.goals.$post({
        json: {
          title: newTitle.trim(),
          elaboration: newElaboration.trim() || undefined,
          note: newNote.trim() || undefined,
          teamId: newTeamId || undefined,
          horizon: newHorizon || undefined,
        },
      });
      const data = (await res.json()) as GoalMutationResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "追加に失敗しました");
      setNewTitle("");
      setNewElaboration("");
      setNewNote("");
      setNewTeamId("");
      setNewHorizon("");
      await refreshGoals();
      beginEdit(data.goal!);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const dirty =
    !!selectedGoal &&
    (editTitle !== selectedGoal.title ||
      editElaboration !== (selectedGoal.elaboration ?? "") ||
      editNote !== (selectedGoal.note ?? "") ||
      editTeamId !== (selectedGoal.teamId ?? "") ||
      editHorizon !== (selectedGoal.horizon ?? "") ||
      editStatus !== selectedGoal.status);

  async function handleSave() {
    if (!selectedGoal || !editTitle.trim() || !dirty) return;
    setSaving(true);
    setEditError(null);
    try {
      const res = await api.api.org.goals[":id"].$patch(rpcInit({
        param: { id: selectedGoal.id },
        json: {
          title: editTitle,
          elaboration: editElaboration,
          note: editNote,
          teamId: editTeamId || null,
          horizon: editHorizon || null,
          status: editStatus,
        },
      }));
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "更新に失敗しました");
      await refreshGoals();
    } catch (err) {
      setEditError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleGenerateThemeFromGoal(goalId: string) {
    setThemeGenerating(true);
    setThemeGenerateError(null);
    setThemeGenerateResult(null);
    try {
      const res = await api.api.themes["from-goal"].$post({
        json: { goalIds: [goalId] },
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(data?.error ?? "テーマ候補の作成に失敗しました");
      await refreshThemes();
      setThemeGenerateResult("テーマ候補を作成しました。「Themes」の候補一覧から確認・採用できます。");
    } catch (err) {
      setThemeGenerateError((err as Error).message);
    } finally {
      setThemeGenerating(false);
    }
  }

  async function handleRemove(id: string) {
    if (!confirm("このGoalを削除しますか？")) return;
    await api.api.org.goals[":id"].$delete({ param: { id } });
    if (editingGoalId === id) setEditingGoalId(null);
    await refreshGoals();
  }

  async function handleSuggest() {
    setSuggesting(true);
    setSuggestError(null);
    try {
      const res = await api.api.themes.link["suggest-goal"].$post({ json: {} });
      const data = (await res.json().catch(() => null)) as (ThemeGoalLinkSuggestResponse & { error?: string }) | null;
      if (!res.ok) throw new Error(data?.error ?? "Goal紐づけ提案に失敗しました");
      setSuggestPreview({
        suggestions: Array.isArray(data?.suggestions) ? data.suggestions : [],
        source: data?.source === "cloud" ? "cloud" : "heuristic",
        fallbackReason: typeof data?.fallbackReason === "string" ? data.fallbackReason : undefined,
      });
    } catch (err) {
      setSuggestError((err as Error).message);
    } finally {
      setSuggesting(false);
    }
  }

  async function handleAdoptSuggestion(s: GoalLinkSuggestion) {
    setSuggestApplyingId(s.sourceId);
    setSuggestError(null);
    try {
      const res = await api.api.themes[":id"].$patch(rpcInit({
        param: { id: s.sourceId },
        json: { action: "link", goalIds: s.goalIds },
      }));
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "リンクの採用に失敗しました");
      }
      await refreshThemes();
      setSuggestPreview((prev) => (prev ? { ...prev, suggestions: prev.suggestions.filter((x) => x.sourceId !== s.sourceId) } : null));
    } catch (err) {
      setSuggestError((err as Error).message);
    } finally {
      setSuggestApplyingId(null);
    }
  }

  return (
    <>
      {!selectedGoal && (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            <button type="button" className={styles.btnOutline} disabled={suggesting} onClick={() => handleSuggest()}>
              {suggesting ? "提案を探しています…" : "未リンクの採用テーマへGoal候補を提案"}
            </button>
          </div>
          {suggestError && (
            <p className={styles.errorText} role="alert">
              {suggestError}
            </p>
          )}
          {suggestPreview && (
            <GoalLinkSuggestPanel
              suggestions={suggestPreview.suggestions}
              title="テーマへのGoalリンク提案"
              emptyText="提案できるリンクがありませんでした。Goalが登録されているか確認してください。"
              source={suggestPreview.source}
              fallbackReason={suggestPreview.fallbackReason}
              applyingId={suggestApplyingId}
              onAdopt={handleAdoptSuggestion}
              onDismiss={() => setSuggestPreview(null)}
              onDismissOne={(sourceId) =>
                setSuggestPreview((prev) => (prev ? { ...prev, suggestions: prev.suggestions.filter((x) => x.sourceId !== sourceId) } : null))
              }
            />
          )}

          <h3 style={{ marginTop: 16, marginBottom: 8, fontSize: "0.875rem" }}>新規追加</h3>
          <form onSubmit={handleAdd}>
            <div className={styles.field}>
              <label>
                見出し（組織・チームの到達状態）
                <textarea rows={2} value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
              </label>
            </div>
            <div className={styles.field}>
              <label>
                補足（任意 · 解釈を閉じる説明）
                <textarea rows={2} value={newElaboration} onChange={(e) => setNewElaboration(e.target.value)} />
              </label>
            </div>
            <div className={styles.field}>
              <label>
                運用メモ（任意 · 非注入）
                <textarea rows={2} value={newNote} onChange={(e) => setNewNote(e.target.value)} />
              </label>
            </div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <div className={styles.field} style={{ flex: 1, minWidth: 160 }}>
                <Select
                  label="所属チーム（未指定＝組織全体）"
                  value={newTeamId}
                  onChange={setNewTeamId}
                  options={[{ value: "", label: "組織全体" }, ...teamOptions]}
                />
              </div>
              <div className={styles.field} style={{ flex: 1, minWidth: 140 }}>
                <Select label="時間軸（任意）" value={newHorizon} onChange={(v) => setNewHorizon(v as GoalHorizon | "")} options={HORIZON_OPTIONS} />
              </div>
            </div>
            {error && (
              <p className={styles.errorText} role="alert">
                {error}
              </p>
            )}
            <button className={styles.primaryBtn} type="submit" style={{ width: "auto" }} disabled={submitting || !newTitle.trim()}>
              {submitting ? "追加中…" : "追加"}
            </button>
          </form>

          <hr style={{ margin: "20px 0", border: 0, borderTop: "1px solid var(--input-border)" }} />

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 8 }}>
            <h3 style={{ margin: 0, fontSize: "0.875rem" }}>一覧</h3>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.75rem", color: "var(--text-muted)" }}>
              <input type="checkbox" checked={showInactiveGoals} onChange={(e) => setShowInactiveGoals(e.target.checked)} />
              達成済み・断念も表示
            </label>
          </div>
          {!goalsLoaded ? (
            <p className={styles.subtitle}>読み込み中…</p>
          ) : visibleGoals.length === 0 ? (
            <p className={styles.subtitle}>まだGoalが登録されていません。</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {visibleGoals.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => beginEdit(g)}
                  style={{
                    textAlign: "left",
                    padding: "10px 12px",
                    border: "1px solid var(--input-border)",
                    borderRadius: 8,
                    background: "var(--panel-bg, transparent)",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontSize: "0.875rem", fontWeight: 600 }}>{treeTitle(g.title)}</div>
                  {g.elaboration ? (
                    <div style={{ marginTop: 4, fontSize: "0.75rem", color: "var(--text-muted)" }}>
                      {treeTitle(g.elaboration)}
                    </div>
                  ) : null}
                  <div style={{ marginTop: 4, fontSize: "0.75rem", color: "var(--text-muted)" }}>
                    {horizonLabel(g.horizon) || "時間軸なし"}
                    {g.status !== "active" ? ` · ${STATUS_OPTIONS.find((o) => o.value === g.status)?.label}` : ""}
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {selectedGoal && (
        <>
          <div className={styles.editorPath}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className={styles.btnOutline} onClick={cancelEdit}>
                一覧に戻る
              </button>
              <button className={styles.primaryBtn} style={{ width: "auto" }} onClick={handleSave} disabled={saving || !editTitle.trim() || !dirty}>
                {saving ? "保存中…" : dirty ? "保存" : "保存済み"}
              </button>
              <button className={styles.btnOutline} onClick={() => handleRemove(selectedGoal.id)}>
                削除
              </button>
              <button
                type="button"
                className={styles.btnOutline}
                disabled={themeGenerating}
                onClick={() => handleGenerateThemeFromGoal(selectedGoal.id)}
              >
                {themeGenerating ? "候補を作成中…" : "このGoalの重点テーマ候補を出す"}
              </button>
            </div>
          </div>
          {editError && (
            <p className={styles.errorText} role="alert">
              {editError}
            </p>
          )}
          {themeGenerateError && (
            <p className={styles.errorText} role="alert">
              {themeGenerateError}
            </p>
          )}
          {themeGenerateResult && <p className={styles.subtitle}>{themeGenerateResult}</p>}
          <div className={styles.field}>
            <label>
              見出し（組織・チームの到達状態）
              <textarea rows={3} value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
            </label>
          </div>
          <div className={styles.field}>
            <label>
              補足（任意 · 解釈を閉じる説明）
              <textarea rows={3} value={editElaboration} onChange={(e) => setEditElaboration(e.target.value)} />
            </label>
          </div>
          <div className={styles.field}>
            <label>
              運用メモ（任意 · 非注入）
              <textarea rows={3} value={editNote} onChange={(e) => setEditNote(e.target.value)} />
            </label>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div className={styles.field} style={{ flex: 1, minWidth: 160 }}>
              <Select
                label="所属チーム（未指定＝組織全体）"
                value={editTeamId}
                onChange={setEditTeamId}
                options={[{ value: "", label: "組織全体" }, ...teamOptions]}
              />
            </div>
            <div className={styles.field} style={{ flex: 1, minWidth: 140 }}>
              <Select label="時間軸（任意）" value={editHorizon} onChange={(v) => setEditHorizon(v as GoalHorizon | "")} options={HORIZON_OPTIONS} />
            </div>
            <div className={styles.field} style={{ flex: 1, minWidth: 160 }}>
              <Select label="状態" value={editStatus} onChange={(v) => setEditStatus(v as GoalStatus)} options={STATUS_OPTIONS} />
            </div>
          </div>
          {goalHistory.length > 0 && (
            <>
              <h3 style={{ marginTop: 20, marginBottom: 6, fontSize: "0.875rem" }}>変更履歴</h3>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: "0.75rem", color: "var(--text-muted)" }}>
                {goalHistory.slice(0, 8).map((ev) => (
                  <li key={ev.id}>{ev.text}</li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </>
  );
}
