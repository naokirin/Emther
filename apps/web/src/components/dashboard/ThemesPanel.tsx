import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import styles from "../../styles/page.module.css";
import { IdFragmentLink } from "../IdFragmentLink";
import { IdLinkedText } from "../IdLinkedText";
import { GoalLinkSuggestPanel } from "../HierarchyLinkSuggestPanel";
import { ThemeGoalLinkEditor } from "../ThemeGoalLinkEditor";
import { api, rpcInit } from "../../lib/api-client";
import { isThemeGoalUnlinked, type Goal, type GoalLinkSuggestion, type OrgTheme } from "@emther/core/types";

// 採用＝肯定（1段階）。壁打ち前提に入ったテーマを「意識の錨」として今日タブに残す。
const PRIORITY_THEME_LIMIT = 3;

type Props = {
  themes: OrgTheme[];
  themesLoaded: boolean;
  goals: Goal[];
  refreshThemes: () => Promise<void>;
  refreshRuns: () => Promise<void>;
  onNavigate: (path: string) => void;
};

function themeGoalLinks(theme: OrgTheme, goals: Goal[]): { label: string }[] {
  const links: { label: string }[] = [];
  for (const id of theme.goalIds ?? []) {
    const g = goals.find((goal) => goal.id === id);
    if (g) links.push({ label: g.title });
  }
  return links.slice(0, 2);
}

// UI/UX見直し（今日タブ）対応。「状態/テーマ/Issue/人が混在」への対処として、
// テーマは判断待ちの一覧とは別の「いまの見立て（状態）」に位置付け、既定では
// 要約1行だけを見せる。詳細（Why/What/How・Goalリンク・編集）はクリックしてから。
export function ThemesPanel({ themes, themesLoaded, goals, refreshThemes, refreshRuns, onNavigate }: Props) {
  const [searchParams] = useSearchParams();
  const themeFocusId = searchParams.get("theme");

  // 優先テーマは常時全開ではなく既定で畳んでおく（状態はまず要約、詳細はクリックで）。
  const [themePanelOpen, setThemePanelOpen] = useState(false);
  const [priorityThemeExpandedId, setPriorityThemeExpandedId] = useState<string | null>(null);
  const [priorityThemesShowAll, setPriorityThemesShowAll] = useState(false);
  const [themeEditId, setThemeEditId] = useState<string | null>(null);
  const [themeEditDraft, setThemeEditDraft] = useState({ title: "", summary: "", rationale: "" });
  const [themeEditBusy, setThemeEditBusy] = useState(false);
  const [appliedThemeFocusId, setAppliedThemeFocusId] = useState<string | null>(null);
  const [distillSubmitting, setDistillSubmitting] = useState(false);
  const [distillError, setDistillError] = useState<string | null>(null);
  const [themeLinkSuggesting, setThemeLinkSuggesting] = useState(false);
  const [themeLinkError, setThemeLinkError] = useState<string | null>(null);
  const [themeLinkPreview, setThemeLinkPreview] = useState<{
    suggestions: GoalLinkSuggestion[];
    source: "cloud" | "heuristic";
    fallbackReason?: string;
  } | null>(null);
  const [themeLinkApplyingId, setThemeLinkApplyingId] = useState<string | null>(null);

  const adoptedThemes = themes
    .filter((t) => t.status === "adopted")
    .sort((a, b) => (b.adoptedAt ?? b.updatedAt) - (a.adoptedAt ?? a.updatedAt));
  const visiblePriorityThemes = priorityThemesShowAll ? adoptedThemes : adoptedThemes.slice(0, PRIORITY_THEME_LIMIT);
  const hiddenPriorityThemeCount = Math.max(0, adoptedThemes.length - PRIORITY_THEME_LIMIT);
  const unlinkedThemeCount = adoptedThemes.filter((t) => isThemeGoalUnlinked(t)).length;

  // Issue詳細などから `/?theme=<id>` で飛んできたとき、該当テーマを展開して見せる。
  if (themesLoaded && themeFocusId && themeFocusId !== appliedThemeFocusId) {
    setAppliedThemeFocusId(themeFocusId);
    const focusIndex = adoptedThemes.findIndex((t) => t.id === themeFocusId);
    if (focusIndex >= 0) {
      if (focusIndex >= PRIORITY_THEME_LIMIT) setPriorityThemesShowAll(true);
      setPriorityThemeExpandedId(themeFocusId);
      setThemePanelOpen(true);
    }
  }

  useEffect(() => {
    // URL 経由の deep-link 時だけスクロール（朝ヒーローの同一ページ操作は onClick 側で行う）。
    if (!themeFocusId || themeFocusId !== appliedThemeFocusId || !themesLoaded) return;
    const el = document.querySelector(`[data-theme-id="${CSS.escape(themeFocusId)}"]`);
    el?.scrollIntoView?.({ behavior: "smooth", block: "center" });
  }, [themeFocusId, appliedThemeFocusId, themesLoaded, priorityThemesShowAll]);

  async function handleDistillThemes() {
    setDistillSubmitting(true);
    setDistillError(null);
    try {
      const res = await api.api.themes.distill.$post();
      const data = (await res.json().catch(() => null)) as {
        error?: string;
        run?: { id?: string };
      } | null;
      if (res.status === 202) {
        await refreshRuns();
        return;
      }
      if (!res.ok) throw new Error(data?.error ?? "状況蒸留の起動に失敗しました");
      const runId = data?.run?.id as string | undefined;
      await refreshRuns();
      if (runId) onNavigate(`/chat?runId=${runId}`);
    } catch (err) {
      setDistillError((err as Error).message);
    } finally {
      setDistillSubmitting(false);
    }
  }

  async function handleSuggestThemeGoalLinks() {
    setThemeLinkSuggesting(true);
    setThemeLinkError(null);
    try {
      const res = await api.api.themes.link["suggest-goal"].$post({ json: {} });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
        suggestions?: GoalLinkSuggestion[];
        source?: string;
        fallbackReason?: string;
      } | null;
      if (!res.ok) throw new Error(data?.error ?? "Goalリンク提案に失敗しました");
      setThemeLinkPreview({
        suggestions: Array.isArray(data?.suggestions) ? data.suggestions : [],
        source: data?.source === "cloud" ? "cloud" : "heuristic",
        fallbackReason: typeof data?.fallbackReason === "string" ? data.fallbackReason : undefined,
      });
    } catch (err) {
      setThemeLinkError((err as Error).message);
    } finally {
      setThemeLinkSuggesting(false);
    }
  }

  async function handleAdoptThemeGoalLink(s: GoalLinkSuggestion) {
    setThemeLinkApplyingId(s.sourceId);
    setThemeLinkError(null);
    try {
      const res = await api.api.themes[":id"].$patch(rpcInit({
        param: { id: s.sourceId },
        json: {
          action: "link",
          goalIds: s.goalIds,
        },
      }));
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "リンクの採用に失敗しました");
      }
      await refreshThemes();
      setThemeLinkPreview((prev) =>
        prev ? { ...prev, suggestions: prev.suggestions.filter((x) => x.sourceId !== s.sourceId) } : null,
      );
    } catch (err) {
      setThemeLinkError((err as Error).message);
    } finally {
      setThemeLinkApplyingId(null);
    }
  }

  if (adoptedThemes.length === 0) {
    return (
      <div className={styles.panel} style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: "1rem" }}>テーマの見直し</h2>
        <p className={styles.subtitle} style={{ marginTop: 4 }}>
          採用中の優先テーマはまだありません。観測差分から候補を出すか、方針・目標から Goal 起点の候補を作れます。
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10, alignItems: "center" }}>
          <button className={styles.btnOutline} disabled={distillSubmitting} onClick={handleDistillThemes}>
            {distillSubmitting ? "修正候補を生成中…" : "🧭 テーマを見直す（観測差分）"}
          </button>
          <button className={styles.btnOutline} onClick={() => onNavigate("/org")}>
            方針・目標（Goal起点）へ
          </button>
        </div>
        {distillError && (
          <p className={styles.errorText} role="alert">
            {distillError}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className={styles.panel} style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: "1rem" }}>🎯 優先テーマ（{adoptedThemes.length}）</h2>
          <p className={styles.subtitle} style={{ marginTop: 4 }}>
            今期の焦点: {adoptedThemes.slice(0, 3).map((t) => t.title).join(" / ")}
            {adoptedThemes.length > 3 ? ` 他${adoptedThemes.length - 3}` : ""}
            {unlinkedThemeCount > 0 && (
              <span style={{ color: "var(--yellow-fg)", marginLeft: 8 }}>⚠ Goal未リンク {unlinkedThemeCount}件</span>
            )}
          </p>
        </div>
        <button
          type="button"
          className={`${styles.detailToggle} ${styles.detailToggleButton}`}
          onClick={() => setThemePanelOpen(!themePanelOpen)}
        >
          {themePanelOpen ? "閉じる" : "詳細を見る"}
        </button>
      </div>
      {themePanelOpen && (
        <>
          {visiblePriorityThemes.map((t) => {
            const expanded = priorityThemeExpandedId === t.id || themeEditId === t.id;
            return (
              <div
                key={t.id}
                data-theme-id={t.id}
                style={{
                  marginTop: 10,
                  paddingTop: 10,
                  borderTop: "1px solid var(--border)",
                  fontSize: "0.875rem",
                }}
              >
                {themeEditId === t.id ? (
                  <div className={styles.field}>
                    <label>
                      タイトル
                      <input
                        value={themeEditDraft.title}
                        onChange={(e) => setThemeEditDraft({ ...themeEditDraft, title: e.target.value })}
                      />
                    </label>
                    <label>
                      根本課題の見立て
                      <textarea
                        rows={2}
                        value={themeEditDraft.summary}
                        onChange={(e) => setThemeEditDraft({ ...themeEditDraft, summary: e.target.value })}
                      />
                    </label>
                    <label>
                      なぜこの結果に至ったか
                      <textarea
                        rows={3}
                        value={themeEditDraft.rationale}
                        onChange={(e) => setThemeEditDraft({ ...themeEditDraft, rationale: e.target.value })}
                      />
                    </label>
                    <div className={styles.yieldActions}>
                      <button
                        className={styles.primaryBtn}
                        style={{ width: "auto" }}
                        disabled={
                          themeEditBusy ||
                          (themeEditDraft.title === t.title &&
                            themeEditDraft.summary === t.summary &&
                            themeEditDraft.rationale === t.rationale)
                        }
                        onClick={async () => {
                          setThemeEditBusy(true);
                          try {
                            const res = await api.api.themes[":id"].$patch(rpcInit({
                              param: { id: t.id },
                              json: { action: "revise", ...themeEditDraft },
                            }));
                            if (!res.ok) throw new Error("更新に失敗しました");
                            setThemeEditId(null);
                            await refreshThemes();
                          } finally {
                            setThemeEditBusy(false);
                          }
                        }}
                      >
                        保存
                      </button>
                      <button className={styles.btnOutline} onClick={() => setThemeEditId(null)}>
                        キャンセル
                      </button>
                    </div>
                    <ThemeGoalLinkEditor
                      themeId={t.id}
                      goalIds={t.goalIds ?? []}
                      goals={goals}
                      onSaved={refreshThemes}
                      disabled={themeEditBusy}
                      compact
                    />
                  </div>
                ) : (
                  <>
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <strong>{t.title}</strong>
                        <p style={{ margin: "2px 0 0", color: "var(--text-muted)" }}>{t.summary}</p>
                        {(() => {
                          const goalLinks = themeGoalLinks(t, goals);
                          if (goalLinks.length > 0) {
                            return (
                              <p style={{ margin: "4px 0 0", fontSize: "0.75rem", color: "var(--text-muted)" }}>
                                🎯{" "}
                                {goalLinks.map((link, i) => (
                                  <span key={link.label}>
                                    {i > 0 ? " · " : ""}
                                    {link.label}
                                  </span>
                                ))}
                              </p>
                            );
                          }
                          return (
                            <p style={{ margin: "4px 0 0", fontSize: "0.75rem", color: "var(--warning, #b45309)" }}>
                              ⚠ Goal未リンク
                            </p>
                          );
                        })()}
                      </div>
                      <button
                        className={`${styles.detailToggle} ${styles.detailToggleButton}`}
                        type="button"
                        onClick={() => setPriorityThemeExpandedId(expanded ? null : t.id)}
                      >
                        {expanded ? "閉じる" : "詳細"}
                      </button>
                    </div>
                    {expanded && (
                      <div style={{ marginTop: 8 }}>
                        <p style={{ margin: "0 0 6px", color: "var(--text-muted)", fontSize: "0.75rem" }}>
                          <IdLinkedText text={t.rationale} />
                        </p>
                        {t.facts.length > 0 && (
                          <ul style={{ margin: "0 0 6px 16px", fontSize: "0.75rem", color: "var(--text-muted)" }}>
                            {t.facts.map((f, i) => (
                              <li key={i}>
                                <IdLinkedText text={f} />
                              </li>
                            ))}
                          </ul>
                        )}
                        {t.rootCause && (
                          <p style={{ margin: "0 0 4px", fontSize: "0.75rem" }}>
                            根本原因: <IdLinkedText text={t.rootCause} />
                          </p>
                        )}
                        {t.suggestedDirection && (
                          <p style={{ margin: "0 0 4px", fontSize: "0.75rem" }}>
                            解決の方向性: <IdLinkedText text={t.suggestedDirection} />
                          </p>
                        )}
                        {(t.evidenceSuggestionIds.length > 0 || t.evidenceJournalIds.length > 0) && (
                          <div style={{ marginTop: 6, fontSize: "0.75rem" }}>
                            {t.evidenceSuggestionIds.length > 0 && (
                              <p style={{ margin: "2px 0" }}>
                                <strong>根拠 提案: </strong>
                                {t.evidenceSuggestionIds.map((id, ii) => (
                                  <span key={id}>
                                    {ii > 0 ? "、" : ""}
                                    <IdFragmentLink fragment={id} className={styles.idFragmentLink}>
                                      {id.slice(0, 8)}
                                    </IdFragmentLink>
                                  </span>
                                ))}
                              </p>
                            )}
                            {t.evidenceJournalIds.length > 0 && (
                              <p style={{ margin: "2px 0" }}>
                                <strong>根拠 Journal: </strong>
                                {t.evidenceJournalIds.map((id, ii) => (
                                  <span key={id}>
                                    {ii > 0 ? "、" : ""}
                                    <IdFragmentLink fragment={id} className={styles.idFragmentLink}>
                                      {id.slice(0, 8)}
                                    </IdFragmentLink>
                                  </span>
                                ))}
                              </p>
                            )}
                          </div>
                        )}
                        <div className={styles.yieldActions} style={{ marginTop: 8 }}>
                          <button
                            className={styles.btnOutline}
                            type="button"
                            onClick={() => {
                              setThemeEditId(t.id);
                              setThemeEditDraft({ title: t.title, summary: t.summary, rationale: t.rationale });
                            }}
                          >
                            編集して訂正
                          </button>
                          {t.sourceRunId && (
                            <button
                              className={styles.btnOutline}
                              type="button"
                              onClick={() => onNavigate(`/chat?runId=${t.sourceRunId}`)}
                            >
                              壁打ちで見直す
                            </button>
                          )}
                          <button
                            className={styles.btnOutline}
                            type="button"
                            onClick={async () => {
                              await api.api.themes[":id"].$patch(rpcInit({
                                param: { id: t.id },
                                json: { action: "dismiss" },
                              }));
                              if (priorityThemeExpandedId === t.id) setPriorityThemeExpandedId(null);
                              await refreshThemes();
                            }}
                          >
                            採用を取り消す
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
          {hiddenPriorityThemeCount > 0 && (
            <button
              type="button"
              className={`${styles.detailToggle} ${styles.detailToggleButton}`}
              style={{ marginTop: 10 }}
              onClick={() => setPriorityThemesShowAll(!priorityThemesShowAll)}
            >
              {priorityThemesShowAll ? "件数を減らす" : `他 ${hiddenPriorityThemeCount} 件の採用テーマを見る`}
            </button>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12, alignItems: "center" }}>
            <button className={styles.btnOutline} disabled={distillSubmitting} onClick={handleDistillThemes}>
              {distillSubmitting ? "修正候補を生成中…" : "🧭 テーマを見直す（観測差分）"}
            </button>
            {unlinkedThemeCount > 0 && (
              <button
                className={`${styles.btnOutline} ${styles.axisTooltip}`}
                disabled={themeLinkSuggesting || goals.length === 0}
                onClick={handleSuggestThemeGoalLinks}
                data-tooltip="Goal未リンクの採用テーマへ、Goalの紐付けをAIが提案します（採用まで反映しません）"
              >
                {themeLinkSuggesting ? "Goalリンクを提案中…" : `🔗 Goal未リンクを見直す（${unlinkedThemeCount}）`}
              </button>
            )}
            <span className={styles.subtitle} style={{ margin: 0 }}>
              主題の新規作成ではなく、観測との差分でテーマを修正・再優先します
            </span>
          </div>
          {themeLinkError && (
            <p className={styles.errorText} role="alert">
              {themeLinkError}
            </p>
          )}
          {themeLinkPreview && (
            <GoalLinkSuggestPanel
              suggestions={themeLinkPreview.suggestions}
              title="テーマへのGoalリンク提案"
              emptyText="提案できるリンクがありませんでした。Goalが登録されているか確認してください。"
              source={themeLinkPreview.source}
              fallbackReason={themeLinkPreview.fallbackReason}
              applyingId={themeLinkApplyingId}
              onAdopt={handleAdoptThemeGoalLink}
              onDismiss={() => setThemeLinkPreview(null)}
              onDismissOne={(sourceId) =>
                setThemeLinkPreview((prev) =>
                  prev ? { ...prev, suggestions: prev.suggestions.filter((x) => x.sourceId !== sourceId) } : null,
                )
              }
            />
          )}
          {distillError && (
            <p className={styles.errorText} role="alert">
              {distillError}
            </p>
          )}
        </>
      )}
    </div>
  );
}
