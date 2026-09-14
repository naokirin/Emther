"use client";

import Link from "next/link";
import styles from "@/app/page.module.css";
import { ThemeOkrLinkEditor } from "@/components/ThemeOkrLinkEditor";
import { type ObjectiveWithProgress, type OrgTheme } from "@/lib/types";

type Props = {
  themes: OrgTheme[];
  themesLoaded: boolean;
  objectives: ObjectiveWithProgress[];
  refreshThemes: () => Promise<void>;
  editingThemeId: string | null;
  onSelectTheme: (theme: OrgTheme) => void;
  onBack: () => void;
};

function themeOkrSummary(theme: OrgTheme, objectives: ObjectiveWithProgress[]): string {
  const parts: string[] = [];
  for (const id of theme.objectiveIds ?? []) {
    const o = objectives.find((obj) => obj.id === id);
    if (o) parts.push(o.title.split("\n")[0] ?? o.title);
  }
  for (const krId of theme.keyResultIds ?? []) {
    for (const o of objectives) {
      const kr = o.keyResults.find((k) => k.id === krId);
      if (kr) {
        parts.push(`${o.title.split("\n")[0]} ＞ ${kr.title.split("\n")[0]}`);
        break;
      }
    }
  }
  return parts.length > 0 ? parts.join(" · ") : "";
}

export function OrgThemesPanel({
  themes,
  themesLoaded,
  objectives,
  refreshThemes,
  editingThemeId,
  onSelectTheme,
  onBack,
}: Props) {
  const adoptedThemes = themes.filter((t) => t.status === "adopted");
  const candidateThemes = themes.filter((t) => t.status === "candidate");
  const selectedTheme = editingThemeId ? themes.find((t) => t.id === editingThemeId) ?? null : null;

  if (!selectedTheme) {
    return (
      <>
        <h3 style={{ marginTop: 4, marginBottom: 8, fontSize: "0.875rem" }}>採用中</h3>
        {!themesLoaded ? (
          <p className={styles.subtitle}>読み込み中…</p>
        ) : adoptedThemes.length === 0 ? (
          <p className={styles.subtitle}>採用中のテーマはまだありません。Objective 詳細から候補生成するか、ダッシュボードで蒸留してください。</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {adoptedThemes.map((t) => {
              const okr = themeOkrSummary(t, objectives);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onSelectTheme(t)}
                  style={{
                    textAlign: "left",
                    padding: "10px 12px",
                    border: "1px solid var(--input-border)",
                    borderRadius: 8,
                    background: "var(--panel-bg, transparent)",
                    cursor: "pointer",
                    font: "inherit",
                    color: "inherit",
                  }}
                >
                  <div style={{ fontSize: "0.875rem", fontWeight: 600 }}>{t.title}</div>
                  <div className={styles.subtitle} style={{ margin: "4px 0 0" }}>
                    {t.summary}
                  </div>
                  <div style={{ marginTop: 4, fontSize: "0.75rem", color: okr ? "var(--text-muted)" : "var(--warning, #b45309)" }}>
                    {okr ? `📈 ${okr}` : "⚠ OKR未リンク"}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {candidateThemes.length > 0 && (
          <>
            <h3 style={{ marginTop: 20, marginBottom: 8, fontSize: "0.875rem" }}>候補</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {candidateThemes.map((t) => {
                const okr = themeOkrSummary(t, objectives);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => onSelectTheme(t)}
                    style={{
                      textAlign: "left",
                      padding: "10px 12px",
                      border: "1px solid var(--input-border)",
                      borderRadius: 8,
                      background: "var(--panel-bg, transparent)",
                      cursor: "pointer",
                      font: "inherit",
                      color: "inherit",
                    }}
                  >
                    <div style={{ fontSize: "0.875rem", fontWeight: 600 }}>{t.title}</div>
                    <div className={styles.subtitle} style={{ margin: "4px 0 0" }}>
                      {t.summary}
                    </div>
                    <div style={{ marginTop: 4, fontSize: "0.75rem", color: "var(--text-muted)" }}>
                      {okr ? `📈 ${okr}` : "OKR未リンク（候補）"}
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </>
    );
  }

  return (
    <>
      <div className={styles.editorPath}>
        <button type="button" className={styles.btnOutline} onClick={onBack}>
          ← 一覧へ
        </button>
        <Link
          href={`/?theme=${encodeURIComponent(selectedTheme.id)}`}
          className={styles.btnOutline}
          style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}
        >
          ダッシュボードで開く
        </Link>
      </div>
      <h3 style={{ marginTop: 8, marginBottom: 4, fontSize: "1rem" }}>{selectedTheme.title}</h3>
      <p className={styles.subtitle} style={{ marginTop: 0 }}>
        {selectedTheme.status === "adopted"
          ? "採用中"
          : selectedTheme.status === "candidate"
            ? "候補"
            : selectedTheme.status}
      </p>
      <p style={{ fontSize: "0.875rem", marginTop: 8 }}>{selectedTheme.summary}</p>
      {selectedTheme.rationale && (
        <p className={styles.subtitle} style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>
          {selectedTheme.rationale}
        </p>
      )}
      <ThemeOkrLinkEditor
        themeId={selectedTheme.id}
        objectiveIds={selectedTheme.objectiveIds ?? []}
        keyResultIds={selectedTheme.keyResultIds ?? []}
        objectives={objectives}
        onSaved={refreshThemes}
      />
    </>
  );
}
