"use client";

import { useState } from "react";
import styles from "@/app/page.module.css";
import type { ObjectiveWithProgress } from "@/lib/types";

type Props = {
  selectedObjective: ObjectiveWithProgress;
  refreshObjectives: () => Promise<void>;
};

// Key Result管理。追加・保存・削除と、ドラフトの状態を持つ。
export function KeyResultManager({ selectedObjective, refreshObjectives }: Props) {
  const [newKeyResultTitle, setNewKeyResultTitle] = useState("");
  const [krSubmitting, setKrSubmitting] = useState(false);
  const [krDrafts, setKrDrafts] = useState<Record<string, string>>({});
  const [krDraftObjectiveId, setKrDraftObjectiveId] = useState<string | null>(null);
  const [krDraftKrIds, setKrDraftKrIds] = useState<string>("");
  const [krSavingId, setKrSavingId] = useState<string | null>(null);
  const [krEditError, setKrEditError] = useState<string | null>(null);

  // ポーリングや他操作で KR が増減したとき、未編集のドラフトだけ同期する。
  // （effect 内 setState は cascading render になるため、レンダー中に調整する）
  // selectedObjective?.id は null 時に undefined になるため、状態の null と揃えて比較する。
  const selectedObjectiveId = selectedObjective.id;
  const selectedKrIds = selectedObjective.keyResults.map((kr) => kr.id).join("\0");
  if (selectedObjectiveId !== krDraftObjectiveId || selectedKrIds !== krDraftKrIds) {
    setKrDraftObjectiveId(selectedObjectiveId);
    setKrDraftKrIds(selectedKrIds);
    // 選択中のObjective自体が切り替わったとき（＝beginEditObjective相当）は、
    // 新規追加欄・エラーも一緒にリセットする（別Objectiveの入力が残らないように）。
    setNewKeyResultTitle("");
    setKrEditError(null);
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

  async function handleAddKeyResult(e: React.FormEvent) {
    e.preventDefault();
    if (!newKeyResultTitle.trim()) return;
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

  return (
    <>
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
    </>
  );
}
