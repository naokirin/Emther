"use client";

import { useState } from "react";
import styles from "@/app/page.module.css";
import { Select } from "@/components/Select";
import { ThemeOkrLinkEditor } from "@/components/ThemeOkrLinkEditor";
import { isThemeOkrUnlinked, type ObjectiveWithProgress, type OrgTheme } from "@core/types";

type Props = {
  selectedObjective: ObjectiveWithProgress;
  objectives: ObjectiveWithProgress[];
  themes: OrgTheme[];
  refreshThemes: () => Promise<void>;
  onOpenTheme: (theme: OrgTheme) => void;
};

// 関連テーマ（EM介入の焦点）。紐付け済みテーマの一覧・OKR紐づけ編集・既存テーマの
// 紐付け・OKRからのテーマ候補生成をまとめる。
export function ObjectiveThemeLinkSection({
  selectedObjective,
  objectives,
  themes,
  refreshThemes,
  onOpenTheme,
}: Props) {
  const [themeLinkExpandId, setThemeLinkExpandId] = useState<string | null>(null);
  const [attachThemeId, setAttachThemeId] = useState("");
  const [attachThemeBusy, setAttachThemeBusy] = useState(false);
  const [attachThemeError, setAttachThemeError] = useState<string | null>(null);
  const [fromOkrBusy, setFromOkrBusy] = useState(false);
  const [fromOkrError, setFromOkrError] = useState<string | null>(null);
  const [fromOkrMessage, setFromOkrMessage] = useState<string | null>(null);

  // 選択中のObjective自体が切り替わったとき（＝beginEditObjective相当）は、
  // テーマ紐づけの展開・紐付けフォームの入力をリセットする（別Objectiveの状態が残らないように）。
  const [syncedObjectiveId, setSyncedObjectiveId] = useState(selectedObjective.id);
  if (selectedObjective.id !== syncedObjectiveId) {
    setSyncedObjectiveId(selectedObjective.id);
    setThemeLinkExpandId(null);
    setAttachThemeId("");
    setAttachThemeError(null);
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

  return (
    <>
      <h3 style={{ marginTop: 20, marginBottom: 4, fontSize: "0.875rem" }}>関連テーマ（EM介入の焦点）</h3>
      {linked.length === 0 ? (
        <p className={styles.subtitle}>この Objective に紐付くテーマはまだありません。</p>
      ) : (
        <ul style={{ margin: "0 0 8px 16px", fontSize: "0.875rem", listStyle: "none", padding: 0 }}>
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
    </>
  );
}
