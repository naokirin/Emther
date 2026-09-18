"use client";

import { useState } from "react";
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

  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newSummary, setNewSummary] = useState("");
  const [newRationale, setNewRationale] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  async function handleCreateTheme() {
    if (!newTitle.trim() || !newSummary.trim()) return;
    setSubmitting(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/themes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTitle.trim(),
          summary: newSummary.trim(),
          rationale: newRationale.trim() || newSummary.trim(),
          status: "adopted",
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "テーマの作成に失敗しました");
      await refreshThemes();
      setNewTitle("");
      setNewSummary("");
      setNewRationale("");
      setCreating(false);
      if (data?.theme) {
        onSelectTheme(data.theme);
      }
    } catch (err) {
      setCreateError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!selectedTheme) {
    return (
      <>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: "1rem" }}>組織テーマ</h3>
          {!creating && (
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className={styles.primaryBtn}
                style={{ width: "auto", fontSize: "0.8rem" }}
                onClick={() => setCreating(true)}
              >
                ＋ テーマを直接設定
              </button>
              <Link
                href="/chat?prefill=EMとしての注力テーマを壁打ち・言語化したい"
                className={styles.btnOutline}
                style={{ textDecoration: "none", fontSize: "0.8rem", display: "inline-flex", alignItems: "center" }}
              >
                💬 AIと壁打ち
              </Link>
            </div>
          )}
        </div>

        {creating && (
          <div
            style={{
              padding: 14,
              backgroundColor: "var(--surface)",
              borderRadius: 8,
              border: "1px solid var(--border)",
              borderLeft: "4px solid var(--accent)",
              marginBottom: 16,
            }}
          >
            <strong style={{ fontSize: "0.9rem" }}>🎯 EMとしての注力テーマを直接登録</strong>
            <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", margin: "4px 0 10px" }}>
              AIに推測させるのではなく、EMとして「今期・今月向き合うテーマ」を自ら定義して採用します。
            </p>

            <div className={styles.field} style={{ marginBottom: 8 }}>
              <label style={{ fontSize: "0.75rem", color: "var(--text-muted)", display: "block", marginBottom: 2 }}>
                テーマ名（必須）
              </label>
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="例: テックリードの自立支援と権限委譲"
                disabled={submitting}
                style={{ width: "100%", fontSize: "0.85rem" }}
              />
            </div>

            <div className={styles.field} style={{ marginBottom: 8 }}>
              <label style={{ fontSize: "0.75rem", color: "var(--text-muted)", display: "block", marginBottom: 2 }}>
                狙い・要約（必須）
              </label>
              <textarea
                value={newSummary}
                onChange={(e) => setNewSummary(e.target.value)}
                placeholder="例: ボトルネック解消のため、設計レビューやタスク割り振りをテックリード主導に移行する"
                rows={2}
                disabled={submitting}
                style={{ width: "100%", fontSize: "0.85rem" }}
              />
            </div>

            <div className={styles.field} style={{ marginBottom: 10 }}>
              <label style={{ fontSize: "0.75rem", color: "var(--text-muted)", display: "block", marginBottom: 2 }}>
                なぜ今このテーマか（理由・背景）
              </label>
              <textarea
                value={newRationale}
                onChange={(e) => setNewRationale(e.target.value)}
                placeholder="例: 直近チーム規模が拡大し、EMが全意思決定に関与する体制に限界が来ているため"
                rows={2}
                disabled={submitting}
                style={{ width: "100%", fontSize: "0.85rem" }}
              />
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className={styles.primaryBtn}
                style={{ width: "auto" }}
                disabled={submitting || !newTitle.trim() || !newSummary.trim()}
                onClick={() => void handleCreateTheme()}
              >
                {submitting ? "保存中…" : "テーマを作成して採用"}
              </button>
              <button
                type="button"
                className={styles.btnOutline}
                style={{ width: "auto" }}
                disabled={submitting}
                onClick={() => {
                  setCreating(false);
                  setCreateError(null);
                }}
              >
                キャンセル
              </button>
            </div>

            {createError && (
              <p className={styles.errorText} role="alert" style={{ marginTop: 8 }}>
                {createError}
              </p>
            )}
          </div>
        )}

        <h3 style={{ marginTop: 4, marginBottom: 8, fontSize: "0.875rem" }}>採用中</h3>
        {!themesLoaded ? (
          <p className={styles.subtitle}>読み込み中…</p>
        ) : adoptedThemes.length === 0 ? (
          <p className={styles.subtitle}>採用中のテーマはまだありません。上の「＋ テーマを直接設定」から作成するか、AIと壁打ちして作成してください。</p>
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
