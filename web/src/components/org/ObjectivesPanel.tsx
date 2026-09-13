"use client";

import { useState } from "react";
import styles from "@/app/page.module.css";
import { Select } from "@/components/Select";
import { useEntityHistory } from "@/lib/hooks";
import { type ObjectiveWithProgress, type OrgTheme, type Team } from "@/lib/types";
import { ObjectiveImportPanel } from "./ObjectiveImportPanel";
import { ObjectiveListCard, ObjectiveTeamListView, buildObjectiveTeamTree } from "./ObjectiveTree";
import { ObjectiveEditForm } from "./objectives/ObjectiveEditForm";
import { KeyResultManager } from "./objectives/KeyResultManager";
import { ObjectiveThemeLinkSection } from "./objectives/ObjectiveThemeLinkSection";

type Props = {
  objectives: ObjectiveWithProgress[];
  objectivesLoaded: boolean;
  refreshObjectives: () => Promise<void>;
  activeTeams: Team[];
  teamOptions: { value: string; label: string }[];
  themes: OrgTheme[];
  refreshThemes: () => Promise<void>;
  focusObjectiveId: string | null;
  onOpenTheme: (theme: OrgTheme) => void;
};

// docs/memo.md「H. 戦略→Issue→結果の一本線」対応。Objective/KeyResultの管理。
// Strategy / Standing Background と同様、左ツリーは入口だけで右パネルで一覧・編集する。
// 選択中Objectiveの編集フォーム・Key Result管理・関連テーマはそれぞれ
// components/org/objectives/以下のコンポーネントへ切り出してある。
export function ObjectivesPanel({
  objectives,
  objectivesLoaded,
  refreshObjectives,
  activeTeams,
  teamOptions,
  themes,
  refreshThemes,
  focusObjectiveId,
  onOpenTheme,
}: Props) {
  const [editingObjectiveId, setEditingObjectiveId] = useState<string | null>(null);
  const selectedObjective =
    editingObjectiveId ? objectives.find((o) => o.id === editingObjectiveId) ?? null : null;
  const { history: objectiveHistory } = useEntityHistory("org", selectedObjective?.id ?? null);

  const orgWideObjectives = objectives.filter((o) => !o.teamId);
  const objectiveTeamTree = buildObjectiveTeamTree(activeTeams, objectives);

  const [newObjectiveTitle, setNewObjectiveTitle] = useState("");
  const [newObjectiveTeamId, setNewObjectiveTeamId] = useState("");
  const [objectiveSubmitting, setObjectiveSubmitting] = useState(false);
  const [objectiveError, setObjectiveError] = useState<string | null>(null);

  const [editObjectiveTitle, setEditObjectiveTitle] = useState("");
  const [editObjectiveNote, setEditObjectiveNote] = useState("");
  const [editObjectiveTeamId, setEditObjectiveTeamId] = useState("");
  const [objectiveSaving, setObjectiveSaving] = useState(false);
  const [objectiveEditError, setObjectiveEditError] = useState<string | null>(null);

  const [importOpen, setImportOpen] = useState(false);

  function beginEditObjective(o: ObjectiveWithProgress) {
    setEditObjectiveTitle(o.title);
    setEditObjectiveNote(o.note ?? "");
    setEditObjectiveTeamId(o.teamId ?? "");
    setObjectiveEditError(null);
    setImportOpen(false);
    setEditingObjectiveId(o.id);
  }

  // 親（?objective=<id>によるURLディープリンク）から通知された focusObjectiveId を
  // objectives ロード後に一度だけ適用する（ポーリングで編集中ドラフトを上書きしない）。
  const [appliedFocusObjectiveId, setAppliedFocusObjectiveId] = useState<string | null>(null);
  if (objectivesLoaded && focusObjectiveId && focusObjectiveId !== appliedFocusObjectiveId) {
    setAppliedFocusObjectiveId(focusObjectiveId);
    const focused = objectives.find((o) => o.id === focusObjectiveId);
    if (focused) beginEditObjective(focused);
  }

  function cancelEditObjective() {
    setEditingObjectiveId(null);
    setObjectiveEditError(null);
  }

  async function handleAddObjective(e: React.FormEvent) {
    e.preventDefault();
    if (!newObjectiveTitle.trim()) return;
    setObjectiveSubmitting(true);
    setObjectiveError(null);
    try {
      const res = await fetch("/api/org/objectives", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newObjectiveTitle, teamId: newObjectiveTeamId || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Objectiveの追加に失敗しました");
      setNewObjectiveTitle("");
      setNewObjectiveTeamId("");
      await refreshObjectives();
      beginEditObjective({ ...data.objective, progress: [] });
    } catch (err) {
      setObjectiveError((err as Error).message);
    } finally {
      setObjectiveSubmitting(false);
    }
  }

  const objectiveDirty =
    !!selectedObjective &&
    (editObjectiveTitle !== selectedObjective.title ||
      editObjectiveNote !== (selectedObjective.note ?? "") ||
      editObjectiveTeamId !== (selectedObjective.teamId ?? ""));

  async function handleSaveObjective() {
    if (!selectedObjective || !editObjectiveTitle.trim() || !objectiveDirty) return;
    setObjectiveSaving(true);
    setObjectiveEditError(null);
    try {
      const res = await fetch(`/api/org/objectives/${selectedObjective.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editObjectiveTitle,
          teamId: editObjectiveTeamId || null,
          note: editObjectiveNote,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "更新に失敗しました");
      await refreshObjectives();
    } catch (err) {
      setObjectiveEditError((err as Error).message);
    } finally {
      setObjectiveSaving(false);
    }
  }

  async function handleRemoveObjective(id: string) {
    try {
      await fetch(`/api/org/objectives/${id}`, { method: "DELETE" });
      if (editingObjectiveId === id) setEditingObjectiveId(null);
      await refreshObjectives();
    } catch {
      // 失敗時は次回のポーリングで状態が揃う
    }
  }

  if (importOpen && !selectedObjective) {
    return (
      <ObjectiveImportPanel
        teamOptions={teamOptions}
        refreshObjectives={refreshObjectives}
        onClose={() => setImportOpen(false)}
        onImported={beginEditObjective}
      />
    );
  }

  if (!selectedObjective) {
    return (
      <>
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          <button
            type="button"
            className={styles.btnOutline}
            onClick={() => {
              setImportOpen(true);
            }}
          >
            テキストから取り込む
          </button>
        </div>

        <h3 style={{ marginTop: 4, marginBottom: 8, fontSize: "0.875rem" }}>新規追加</h3>
        <form onSubmit={handleAddObjective}>
          <div className={styles.field}>
            <label>Objective（目標）
            <textarea
              rows={2}
              value={newObjectiveTitle}
              onChange={(e) => setNewObjectiveTitle(e.target.value)}
              placeholder="新しいObjective（改行可）"
            /></label>
          </div>
          <div className={styles.field}>
            <span className={styles.fieldCaption}>所属チーム（未指定＝組織全体）</span>
            <Select
              value={newObjectiveTeamId}
              onChange={setNewObjectiveTeamId}
              options={[{ value: "", label: "組織全体" }, ...teamOptions]}
              label="所属チーム"
              style={{ width: "100%" }}
            />
          </div>
          {objectiveError && <p className={styles.errorText} role="alert">{objectiveError}</p>}
          <button
            className={styles.primaryBtn}
            type="submit"
            style={{ width: "auto" }}
            disabled={objectiveSubmitting || !newObjectiveTitle.trim()}
          >
            {objectiveSubmitting ? "追加中…" : "追加"}
          </button>
        </form>

        <hr style={{ margin: "20px 0", border: 0, borderTop: "1px solid var(--input-border)" }} />

        <h3 style={{ margin: "0 0 8px", fontSize: "0.875rem" }}>一覧</h3>
        {!objectivesLoaded ? (
          <p className={styles.subtitle}>読み込み中…</p>
        ) : objectives.length === 0 ? (
          <p className={styles.subtitle}>まだObjectiveが登録されていません。</p>
        ) : (
          <>
            <div style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>
              組織全体
            </div>
            {orgWideObjectives.length === 0 ? (
              <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--text-muted)" }}>登録なし</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {orgWideObjectives.map((o) => (
                  <ObjectiveListCard key={o.id} objective={o} onSelect={beginEditObjective} />
                ))}
              </div>
            )}
            <ObjectiveTeamListView
              nodes={objectiveTeamTree}
              depth={0}
              onSelectObjective={beginEditObjective}
            />
          </>
        )}
      </>
    );
  }

  return (
    <>
      <ObjectiveEditForm
        selectedObjective={selectedObjective}
        editObjectiveTitle={editObjectiveTitle}
        editObjectiveNote={editObjectiveNote}
        editObjectiveTeamId={editObjectiveTeamId}
        objectiveSaving={objectiveSaving}
        objectiveEditError={objectiveEditError}
        teamOptions={teamOptions}
        onChangeTitle={setEditObjectiveTitle}
        onChangeNote={setEditObjectiveNote}
        onChangeTeamId={setEditObjectiveTeamId}
        onSave={handleSaveObjective}
        onRemove={handleRemoveObjective}
        onCancel={cancelEditObjective}
      />
      <KeyResultManager selectedObjective={selectedObjective} refreshObjectives={refreshObjectives} />
      <ObjectiveThemeLinkSection
        selectedObjective={selectedObjective}
        objectives={objectives}
        themes={themes}
        refreshThemes={refreshThemes}
        onOpenTheme={onOpenTheme}
      />

      {objectiveHistory.length > 0 && (
        <details style={{ marginTop: 20 }}>
          <summary style={{ cursor: "pointer", fontSize: "0.75rem", color: "var(--text-muted)" }}>
            変更履歴（{objectiveHistory.length}件）
          </summary>
          <ul style={{ listStyle: "none", marginTop: 8 }}>
            {objectiveHistory.map((h) => (
              <li key={h.id} style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: 4 }}>
                {new Date(h.occurredAt).toLocaleString("ja-JP")} — {h.text}
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
