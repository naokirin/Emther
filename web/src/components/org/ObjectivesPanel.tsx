"use client";

import { useState } from "react";
import styles from "@/app/page.module.css";
import { Select } from "@/components/Select";
import { ThemeOkrLinkEditor } from "@/components/ThemeOkrLinkEditor";
import { useEntityHistory } from "@/lib/hooks";
import { isThemeOkrUnlinked, type ObjectiveWithProgress, type OrgTheme, type Team } from "@/lib/types";
import { ObjectiveImportPanel } from "./ObjectiveImportPanel";
import { ObjectiveListCard, ObjectiveTeamListView, buildObjectiveTeamTree } from "./ObjectiveTree";

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
  const [newKeyResultTitle, setNewKeyResultTitle] = useState("");
  const [krSubmitting, setKrSubmitting] = useState(false);
  const [krDrafts, setKrDrafts] = useState<Record<string, string>>({});
  const [krDraftObjectiveId, setKrDraftObjectiveId] = useState<string | null>(null);
  const [krDraftKrIds, setKrDraftKrIds] = useState<string>("");
  const [krSavingId, setKrSavingId] = useState<string | null>(null);
  const [krEditError, setKrEditError] = useState<string | null>(null);
  const [fromOkrBusy, setFromOkrBusy] = useState(false);
  const [fromOkrError, setFromOkrError] = useState<string | null>(null);
  const [fromOkrMessage, setFromOkrMessage] = useState<string | null>(null);

  const [importOpen, setImportOpen] = useState(false);

  const [themeLinkExpandId, setThemeLinkExpandId] = useState<string | null>(null);
  const [attachThemeId, setAttachThemeId] = useState("");
  const [attachThemeBusy, setAttachThemeBusy] = useState(false);
  const [attachThemeError, setAttachThemeError] = useState<string | null>(null);

  function beginEditObjective(o: ObjectiveWithProgress) {
    setEditObjectiveTitle(o.title);
    setEditObjectiveNote(o.note ?? "");
    setEditObjectiveTeamId(o.teamId ?? "");
    setObjectiveEditError(null);
    setKrEditError(null);
    setNewKeyResultTitle("");
    setKrDrafts(Object.fromEntries(o.keyResults.map((kr) => [kr.id, kr.title])));
    setImportOpen(false);
    setThemeLinkExpandId(null);
    setAttachThemeId("");
    setAttachThemeError(null);
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
    setKrEditError(null);
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

  async function handleAddKeyResult(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedObjective || !newKeyResultTitle.trim()) return;
    setKrSubmitting(true);
    setKrEditError(null);
    try {
      const res = await fetch(`/api/org/objectives/${selectedObjective.id}/key-results`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newKeyResultTitle }),
      });
      if (res.ok) {
        setNewKeyResultTitle("");
        await refreshObjectives();
        // 追加後の一覧をドラフトに反映するため、次の選択時に揃う。ここでも最新を取りに行く。
        const data = await res.json();
        const objective = data.objective as ObjectiveWithProgress | undefined;
        if (objective?.keyResults) {
          setKrDrafts(Object.fromEntries(objective.keyResults.map((kr) => [kr.id, kr.title])));
        }
      }
    } finally {
      setKrSubmitting(false);
    }
  }

  async function handleSaveKeyResult(keyResultId: string) {
    if (!selectedObjective) return;
    const title = (krDrafts[keyResultId] ?? "").trim();
    if (!title) return;
    setKrSavingId(keyResultId);
    setKrEditError(null);
    try {
      const res = await fetch(`/api/org/objectives/${selectedObjective.id}/key-results/${keyResultId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Key Resultの更新に失敗しました");
      await refreshObjectives();
    } catch (err) {
      setKrEditError((err as Error).message);
    } finally {
      setKrSavingId(null);
    }
  }

  async function handleRemoveKeyResult(keyResultId: string) {
    if (!selectedObjective) return;
    try {
      await fetch(`/api/org/objectives/${selectedObjective.id}/key-results/${keyResultId}`, { method: "DELETE" });
      setKrDrafts((prev) => {
        const next = { ...prev };
        delete next[keyResultId];
        return next;
      });
      await refreshObjectives();
    } catch {
      // 失敗時は次回のポーリングで状態が揃う
    }
  }

  async function handleGenerateThemesFromOkr(objectiveId?: string) {
    setFromOkrBusy(true);
    setFromOkrError(null);
    setFromOkrMessage(null);
    try {
      const res = await fetch("/api/themes/from-okr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(objectiveId ? { objectiveIds: [objectiveId] } : {}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "テーマ候補の生成に失敗しました");
      const count = Array.isArray(data.themes) ? data.themes.length : 0;
      setFromOkrMessage(`${count}件のテーマ候補を作成しました（採用は Dashboard / 蒸留候補から）`);
      await refreshThemes();
    } catch (err) {
      setFromOkrError((err as Error).message);
    } finally {
      setFromOkrBusy(false);
    }
  }

  async function handleAttachThemeToObjective(objectiveId: string) {
    if (!attachThemeId) return;
    const theme = themes.find((t) => t.id === attachThemeId);
    if (!theme) return;
    setAttachThemeBusy(true);
    setAttachThemeError(null);
    try {
      const nextObjIds = Array.from(new Set([...(theme.objectiveIds ?? []), objectiveId]));
      const res = await fetch(`/api/themes/${theme.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "link",
          objectiveIds: nextObjIds,
          keyResultIds: theme.keyResultIds ?? [],
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "テーマの紐づけに失敗しました");
      setAttachThemeId("");
      await refreshThemes();
    } catch (err) {
      setAttachThemeError((err as Error).message);
    } finally {
      setAttachThemeBusy(false);
    }
  }

  // ポーリングや他操作で KR が増減したとき、未編集のドラフトだけ同期する。
  // （effect 内 setState は cascading render になるため、レンダー中に調整する）
  // selectedObjective?.id は null 時に undefined になるため、状態の null と揃えて比較する。
  const selectedObjectiveId = selectedObjective?.id ?? null;
  const selectedKrIds = selectedObjective
    ? selectedObjective.keyResults.map((kr) => kr.id).join("\0")
    : "";
  if (selectedObjectiveId !== krDraftObjectiveId || selectedKrIds !== krDraftKrIds) {
    setKrDraftObjectiveId(selectedObjectiveId);
    setKrDraftKrIds(selectedKrIds);
    if (selectedObjective) {
      setKrDrafts((prev) => {
        const next = { ...prev };
        let changed = false;
        const ids = new Set(selectedObjective.keyResults.map((kr) => kr.id));
        for (const kr of selectedObjective.keyResults) {
          if (next[kr.id] === undefined) {
            next[kr.id] = kr.title;
            changed = true;
          }
        }
        for (const id of Object.keys(next)) {
          if (!ids.has(id)) {
            delete next[id];
            changed = true;
          }
        }
        return changed ? next : prev;
      });
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

  const linked = themes.filter(
    (t) =>
      t.status !== "dismissed" &&
      (t.objectiveIds?.includes(selectedObjective.id) ||
        selectedObjective.keyResults.some((kr) => t.keyResultIds?.includes(kr.id))),
  );
  const unlinkedAdopted = themes.filter(
    (t) => t.status === "adopted" && !(t.objectiveIds?.length || t.keyResultIds?.length),
  );
  const attachable = themes.filter(
    (t) =>
      t.status !== "dismissed" &&
      !t.objectiveIds?.includes(selectedObjective.id) &&
      !selectedObjective.keyResults.some((kr) => t.keyResultIds?.includes(kr.id)),
  );

  return (
    <>
      <div className={styles.editorPath}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className={styles.btnOutline} onClick={cancelEditObjective}>
            一覧に戻る
          </button>
          <button
            className={styles.primaryBtn}
            style={{ width: "auto" }}
            onClick={handleSaveObjective}
            disabled={objectiveSaving || !editObjectiveTitle.trim() || !objectiveDirty}
          >
            {objectiveSaving ? "保存中…" : objectiveDirty ? "保存" : "保存済み"}
          </button>
          <button className={styles.btnOutline} onClick={() => handleRemoveObjective(selectedObjective.id)}>
            このObjectiveを削除
          </button>
        </div>
      </div>
      <p className={styles.subtitle}>
        KeyResultへ紐付けたIssueのうち、追っていない（アーカイブ）ものを除き、ステータス完了（解決）件数から進捗を自動算出します（手動での進捗入力はありません）。
      </p>
      <div className={styles.field}>
        <label>Objective（目標）
        <textarea
          rows={3}
          value={editObjectiveTitle}
          onChange={(e) => setEditObjectiveTitle(e.target.value)}
        /></label>
      </div>
      <div className={styles.field}>
        <label>メモ（判断の理由などの補足）
        <textarea
          rows={3}
          value={editObjectiveNote}
          onChange={(e) => setEditObjectiveNote(e.target.value)}
          placeholder="この目標にした理由・前提・例外など"
        /></label>
      </div>
      <div className={styles.field}>
        <span className={styles.fieldCaption}>所属チーム（未指定＝組織全体の目標）</span>
        <Select
          value={editObjectiveTeamId}
          onChange={setEditObjectiveTeamId}
          options={[{ value: "", label: "組織全体" }, ...teamOptions]}
          label="所属チーム"
          style={{ width: "100%" }}
        />
      </div>
      {objectiveEditError && <p className={styles.errorText} role="alert">{objectiveEditError}</p>}

      <h3 style={{ marginTop: 16, marginBottom: 4, fontSize: "0.8125rem" }}>Key Results</h3>
      {selectedObjective.keyResults.length === 0 ? (
        <p className={styles.subtitle}>まだKey Resultがありません。</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 10 }}>
          {selectedObjective.keyResults.map((kr) => {
            const progress = selectedObjective.progress.find((p) => p.keyResultId === kr.id);
            const draft = krDrafts[kr.id] ?? kr.title;
            const dirty = draft.trim() !== kr.title;
            return (
              <div
                key={kr.id}
                className={styles.field}
                style={{ marginBottom: 0, border: "1px solid var(--input-border)", borderRadius: 8, padding: 10 }}
              >
                <textarea
                  rows={2}
                  value={draft}
                  onChange={(e) => setKrDrafts((prev) => ({ ...prev, [kr.id]: e.target.value }))}
                />
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 8, alignItems: "center" }}>
                  <span className={styles.tableMuted} style={{ fontSize: "0.75rem" }}>
                    {progress ? `Issue ${progress.done}/${progress.total}件 完了` : "紐付くIssueなし"}
                  </span>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      type="button"
                      className={styles.primaryBtn}
                      style={{ width: "auto" }}
                      disabled={krSavingId === kr.id || !draft.trim() || !dirty}
                      onClick={() => handleSaveKeyResult(kr.id)}
                    >
                      {krSavingId === kr.id ? "保存中…" : "保存"}
                    </button>
                    <button type="button" className={styles.btnOutline} onClick={() => handleRemoveKeyResult(kr.id)}>
                      削除
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {krEditError && <p className={styles.errorText} role="alert">{krEditError}</p>}
      <form onSubmit={handleAddKeyResult} className={styles.field} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <textarea
          rows={2}
          value={newKeyResultTitle}
          onChange={(e) => setNewKeyResultTitle(e.target.value)}
          placeholder="新しいKey Result（改行可）"
        />
        <button
          className={styles.btnOutline}
          type="submit"
          disabled={krSubmitting || !newKeyResultTitle.trim()}
          style={{ alignSelf: "flex-start" }}
        >
          追加
        </button>
      </form>

      <h3 style={{ marginTop: 20, marginBottom: 4, fontSize: "0.8125rem" }}>関連テーマ（EM介入の焦点）</h3>
      {linked.length === 0 ? (
        <p className={styles.subtitle}>この Objective に紐付くテーマはまだありません。</p>
      ) : (
        <ul style={{ margin: "0 0 8px 16px", fontSize: "0.8125rem", listStyle: "none", padding: 0 }}>
          {linked.map((t) => (
            <li key={t.id} style={{ marginBottom: 8 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "baseline" }}>
                <button
                  type="button"
                  className={styles.tableRowLink}
                  style={{ display: "inline", width: "auto", background: "none", border: "none", padding: 0, cursor: "pointer", font: "inherit" }}
                  onClick={() => onOpenTheme(t)}
                >
                  {t.title}
                </button>
                <span className={styles.tableMuted}>
                  · {t.status === "adopted" ? "採用中" : t.status === "candidate" ? "候補" : t.status}
                </span>
                {isThemeOkrUnlinked(t) && (
                  <span style={{ color: "var(--warning, #b45309)" }}> · ⚠ OKR未リンク</span>
                )}
                <button
                  type="button"
                  className={`${styles.detailToggle} ${styles.detailToggleButton}`}
                  onClick={() => setThemeLinkExpandId(themeLinkExpandId === t.id ? null : t.id)}
                >
                  {themeLinkExpandId === t.id ? "紐づけを閉じる" : "OKR紐づけを編集"}
                </button>
              </div>
              {themeLinkExpandId === t.id && (
                <ThemeOkrLinkEditor
                  themeId={t.id}
                  objectiveIds={t.objectiveIds ?? []}
                  keyResultIds={t.keyResultIds ?? []}
                  objectives={objectives}
                  onSaved={refreshThemes}
                  compact
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {attachable.length > 0 && (
        <div className={styles.field} style={{ marginTop: 8 }}>
          <span className={styles.fieldCaption}>既存テーマをこの Objective に紐付ける</span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <Select
              value={attachThemeId}
              onChange={setAttachThemeId}
              options={[
                { value: "", label: "テーマを選択…" },
                ...attachable.map((t) => ({
                  value: t.id,
                  label: `${t.title}${t.status === "adopted" ? "" : `（${t.status}）`}`,
                })),
              ]}
              style={{ minWidth: 220, flex: 1 }}
            />
            <button
              type="button"
              className={styles.btnOutline}
              disabled={!attachThemeId || attachThemeBusy}
              onClick={() => void handleAttachThemeToObjective(selectedObjective.id)}
            >
              {attachThemeBusy ? "紐づけ中…" : "紐付ける"}
            </button>
          </div>
          {attachThemeError && (
            <p className={styles.errorText} role="alert" style={{ marginTop: 6 }}>
              {attachThemeError}
            </p>
          )}
        </div>
      )}
      {unlinkedAdopted.length > 0 && (
        <p className={styles.subtitle} style={{ color: "var(--warning, #b45309)" }}>
          ⚠ OKR未リンクの採用テーマが {unlinkedAdopted.length} 件あります（全体）
        </p>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
        <button
          type="button"
          className={styles.primaryBtn}
          style={{ width: "auto" }}
          disabled={fromOkrBusy}
          onClick={() => handleGenerateThemesFromOkr(selectedObjective.id)}
        >
          {fromOkrBusy ? "生成中…" : "この Objective からテーマ候補を生成"}
        </button>
      </div>
      {fromOkrError && <p className={styles.errorText} role="alert">{fromOkrError}</p>}
      {fromOkrMessage && <p className={styles.subtitle}>{fromOkrMessage}</p>}

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
