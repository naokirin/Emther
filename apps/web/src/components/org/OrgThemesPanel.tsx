import { useState } from "react";
import { Link } from "react-router";
import styles from "../../styles/page.module.css";
import { ThemeGoalLinkEditor } from "../../components/ThemeGoalLinkEditor";
import { api } from "../../lib/api-client";
import { type Goal, type OrgTheme } from "@emther/core/types";
import type { ThemeMutationResponse } from "@emther/api-contract";

type Props = {
  themes: OrgTheme[];
  themesLoaded: boolean;
  goals: Goal[];
  refreshThemes: () => Promise<void>;
  editingThemeId: string | null;
  onSelectTheme: (theme: OrgTheme) => void;
  onBack: () => void;
};

function themeGoalSummary(theme: OrgTheme, goals: Goal[]): string {
  const parts: string[] = [];
  for (const id of theme.goalIds ?? []) {
    const g = goals.find((goal) => goal.id === id);
    if (g) parts.push(g.title.split("\n")[0] ?? g.title);
  }
  return parts.length > 0 ? parts.join(" · ") : "";
}

export function OrgThemesPanel({
  themes,
  themesLoaded,
  goals,
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
    if (!newTitle.trim()) return;
    setSubmitting(true);
    setCreateError(null);
    try {
      const res = await api.api.themes.$post({
        json: {
          title: newTitle.trim(),
          summary: newSummary.trim(),
          rationale: newRationale.trim() || newSummary.trim() || newTitle.trim(),
          status: "adopted",
        },
      });
      const data = (await res.json().catch(() => null)) as (ThemeMutationResponse & { error?: string }) | null;
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
          <h3 style={{ margin: 0, fontSize: "1rem" }}>Themes（組織テーマ）</h3>
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
                to="/chat?prefill=EMとしての注力テーマを壁打ち・言語化したい"
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
                見出し（必須）
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
                補足（任意 · 解釈を閉じる説明）
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
                背景・理由（任意 · 補足とは別）
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
                disabled={submitting || !newTitle.trim()}
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
              const goalSummary = themeGoalSummary(t, goals);
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
                  <div style={{ marginTop: 4, fontSize: "0.75rem", color: goalSummary ? "var(--text-muted)" : "var(--warning, #b45309)" }}>
                    {goalSummary ? `🎯 ${goalSummary}` : "⚠ Goal未リンク"}
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
                const goalSummary = themeGoalSummary(t, goals);
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
                      {goalSummary ? `🎯 ${goalSummary}` : "Goal未リンク（候補）"}
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
          to={`/?theme=${encodeURIComponent(selectedTheme.id)}`}
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
      <ThemeGoalLinkEditor
        themeId={selectedTheme.id}
        goalIds={selectedTheme.goalIds ?? []}
        goals={goals}
        onSaved={refreshThemes}
      />
    </>
  );
}
