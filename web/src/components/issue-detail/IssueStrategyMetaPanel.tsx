"use client";

import { useState } from "react";
import Link from "next/link";
import styles from "@/app/page.module.css";
import { Select } from "@/components/Select";
import { IssueStrategyLinkSuggestPanel } from "@/components/HierarchyLinkSuggestPanel";
import { StrategyTrail } from "@/components/StrategyTrail";
import { buildIssueStrategyTrail } from "@/lib/strategy-trail";
import {
  isIssueStrategyUnlinked,
  type Issue,
  type IssueStrategyLinkSuggestion,
  type ObjectiveWithProgress,
  type OrgTheme,
  type Team,
} from "@/lib/types";

type Props = {
  issue: Issue;
  teams: Team[];
  themes: OrgTheme[];
  objectives: ObjectiveWithProgress[];
  refreshIssue: () => Promise<void>;
  refreshIssues: () => Promise<void>;
};

// docs/em_ui_ux_issue.md 7節対応。関連チーム/テーマ/OKRの表示・編集と、
// 戦略未接続時のAI提案パネルをまとめたセクション。
export function IssueStrategyMetaPanel({ issue, teams, themes, objectives, refreshIssue, refreshIssues }: Props) {
  const [strategyMetaEditing, setStrategyMetaEditing] = useState(false);

  // docs/memo.md「H. 戦略→Issue→結果の一本線」「I. チーム単位の憲法」対応。issueは
  // 非同期取得のため初回レンダー時点ではundefined——データが揃ったタイミングをレンダー中に
  // 検知して同期する（useEffectは使わない。以降のポーリング更新では上書きしないので、
  // 編集中の選択状態を壊さない）。
  const [syncedIssueId, setSyncedIssueId] = useState<string | null>(null);
  const [keyResultIdDraft, setKeyResultIdDraft] = useState<string>("");
  const [keyResultSaving, setKeyResultSaving] = useState(false);
  const [themeIdDraft, setThemeIdDraft] = useState<string>("");
  const [themeLinkSaving, setThemeLinkSaving] = useState(false);
  const [teamIdDraft, setTeamIdDraft] = useState<string>("");
  const [teamLinkSaving, setTeamLinkSaving] = useState(false);
  if (issue.id !== syncedIssueId) {
    setSyncedIssueId(issue.id);
    setKeyResultIdDraft(issue.keyResultId ?? "");
    setThemeIdDraft(issue.themeId ?? "");
    setTeamIdDraft(issue.teamId ?? "");
  }

  const [strategyLinkSuggesting, setStrategyLinkSuggesting] = useState(false);
  const [strategyLinkError, setStrategyLinkError] = useState<string | null>(null);
  const [strategyLinkPreview, setStrategyLinkPreview] = useState<{
    suggestions: IssueStrategyLinkSuggestion[];
    source: "cloud" | "heuristic";
    fallbackReason?: string;
  } | null>(null);
  const [strategyLinkApplyingId, setStrategyLinkApplyingId] = useState<string | null>(null);

  async function handleChangeKeyResult(keyResultId: string) {
    setKeyResultIdDraft(keyResultId);
    setKeyResultSaving(true);
    try {
      const res = await fetch(`/api/issues/${issue.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyResultId: keyResultId || null }),
      });
      if (res.ok) await refreshIssue();
    } finally {
      setKeyResultSaving(false);
    }
  }

  async function handleChangeTheme(themeId: string) {
    setThemeIdDraft(themeId);
    setThemeLinkSaving(true);
    try {
      const res = await fetch(`/api/issues/${issue.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ themeId: themeId || null }),
      });
      if (res.ok) await refreshIssue();
    } finally {
      setThemeLinkSaving(false);
    }
  }

  async function handleChangeTeam(teamId: string) {
    setTeamIdDraft(teamId);
    setTeamLinkSaving(true);
    try {
      const res = await fetch(`/api/issues/${issue.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: teamId || null }),
      });
      if (res.ok) await refreshIssue();
    } finally {
      setTeamLinkSaving(false);
    }
  }

  async function handleSuggestStrategyLink() {
    setStrategyLinkSuggesting(true);
    setStrategyLinkError(null);
    try {
      const res = await fetch("/api/issues/link/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issueIds: [issue.id] }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "戦略リンク提案に失敗しました");
      setStrategyLinkPreview({
        suggestions: Array.isArray(data?.suggestions) ? data.suggestions : [],
        source: data?.source === "cloud" ? "cloud" : "heuristic",
        fallbackReason: typeof data?.fallbackReason === "string" ? data.fallbackReason : undefined,
      });
    } catch (err) {
      setStrategyLinkError((err as Error).message);
    } finally {
      setStrategyLinkSuggesting(false);
    }
  }

  async function handleAdoptStrategyLink(s: IssueStrategyLinkSuggestion) {
    setStrategyLinkApplyingId(s.issueId);
    setStrategyLinkError(null);
    try {
      const res = await fetch(`/api/issues/${s.issueId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          themeId: s.themeId,
          keyResultId: s.keyResultId,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "リンクの採用に失敗しました");
      }
      setThemeIdDraft(s.themeId ?? "");
      setKeyResultIdDraft(s.keyResultId ?? "");
      await Promise.all([refreshIssue(), refreshIssues()]);
      setStrategyLinkPreview(null);
    } catch (err) {
      setStrategyLinkError((err as Error).message);
    } finally {
      setStrategyLinkApplyingId(null);
    }
  }

  // docs/em_ui_ux_issue.md 7節対応。閲覧モードでチーム・Key Resultを文字列表示するための
  // 逆引き（issues/page.tsxのresolveKeyResultと同じ考え方）。
  const teamName = issue.teamId ? teams.find((t) => t.id === issue.teamId)?.name : undefined;
  const themeTitle = issue.themeId ? themes.find((t) => t.id === issue.themeId)?.title : undefined;
  const krRef = issue.keyResultId
    ? objectives
        .flatMap((o) => o.keyResults.map((kr) => ({ objectiveId: o.id, objTitle: o.title, kr })))
        .find((x) => x.kr.id === issue.keyResultId)
    : undefined;
  const strategyUnlinked = isIssueStrategyUnlinked(issue);
  const strategyTrail = buildIssueStrategyTrail(issue, objectives);

  return (
    // 関連チーム・上位目標（テーマ / OKR）はタイトル直後に置き、詳細確認中に文脈を見失わないようにする。
    // Why/What/How と同様、表示部分のクリックで編集モードへ切り替える。
    <div style={{ marginTop: 8, marginBottom: 12 }}>
      {!strategyMetaEditing ? (
        <div
          className={styles.editableTextView}
          onClick={() => setStrategyMetaEditing(true)}
          title="クリックして編集"
        >
          <p className={styles.subtitle} style={{ margin: "0 0 4px" }}>
            👥 関連チーム:{" "}
            {issue.teamId && teamName ? (
              <Link
                href={`/teams?focus=${encodeURIComponent(issue.teamId)}`}
                className={styles.tableRowLink}
                style={{ display: "inline", width: "auto" }}
                onClick={(e) => e.stopPropagation()}
              >
                {teamName}
              </Link>
            ) : (
              "なし（クリックして設定）"
            )}
          </p>
          <p className={styles.subtitle} style={{ margin: "0 0 4px" }}>
            🎯 関連テーマ:{" "}
            {issue.themeId && themeTitle ? (
              <Link
                href={`/?theme=${encodeURIComponent(issue.themeId)}`}
                className={styles.tableRowLink}
                style={{ display: "inline", width: "auto" }}
                onClick={(e) => e.stopPropagation()}
              >
                {themeTitle}
              </Link>
            ) : (
              "なし（クリックして設定）"
            )}
          </p>
          {krRef ? (
            <div onClick={(e) => e.stopPropagation()} style={{ margin: strategyUnlinked ? "0 0 4px" : 0 }}>
              <StrategyTrail nodes={strategyTrail} currentKind="issue" />
            </div>
          ) : (
            <p className={styles.subtitle} style={{ margin: strategyUnlinked ? "0 0 4px" : 0 }}>
              📈 関連OKR: なし（クリックして設定）
            </p>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div className={styles.field} style={{ margin: 0 }}>
            <label>
              関連チーム（任意。そのチームのMission/制約を前提として注入する）
              <Select
                value={teamIdDraft}
                onChange={handleChangeTeam}
                disabled={teamLinkSaving}
                options={[
                  { value: "", label: "なし" },
                  ...teams.filter((t) => !t.archived).map((t) => ({ value: t.id, label: t.name })),
                ]}
                style={{ display: "block", width: "100%" }}
              />
            </label>
          </div>
          <div className={styles.field} style={{ margin: 0 }}>
            <label>
              紐付けるテーマ（任意。今期の焦点に効く介入か）
              <Select
                value={themeIdDraft}
                onChange={handleChangeTheme}
                disabled={themeLinkSaving}
                options={[
                  { value: "", label: "なし" },
                  ...themes
                    .filter((t) => t.status === "adopted")
                    .map((t) => ({ value: t.id, label: t.title })),
                ]}
                style={{ display: "block", width: "100%" }}
              />
            </label>
          </div>
          <div className={styles.field} style={{ margin: 0 }}>
            <label>
              紐付けるKey Result（任意。「今期何を解いているか」の一本線を作る）
              <Select
                value={keyResultIdDraft}
                onChange={handleChangeKeyResult}
                disabled={keyResultSaving}
                options={[
                  { value: "", label: "なし" },
                  ...objectives.flatMap((o) =>
                    o.keyResults.map((kr) => ({ value: kr.id, label: `${o.title} ＞ ${kr.title}` })),
                  ),
                ]}
                style={{ display: "block", width: "100%" }}
              />
            </label>
          </div>
          <button
            type="button"
            className={`${styles.detailToggle} ${styles.detailToggleButton}`}
            onClick={() => setStrategyMetaEditing(false)}
            style={{ alignSelf: "flex-start" }}
          >
            閉じる
          </button>
        </div>
      )}
      {strategyUnlinked && (
        <div style={{ marginTop: 6 }}>
          <p className={styles.subtitle} style={{ margin: "0 0 6px", color: "var(--warning, #b45309)" }}>
            ⚠ 戦略未接続（テーマ / Key Result のどちらかを紐付けると朝の物語に乗りやすくなります）
          </p>
          {!strategyMetaEditing && (
            <>
              <button
                type="button"
                className={styles.btnOutline}
                style={{ fontSize: "0.75rem" }}
                disabled={strategyLinkSuggesting}
                onClick={handleSuggestStrategyLink}
                title="この Issue へテーマ / KR の紐付けをAIが提案します"
              >
                {strategyLinkSuggesting ? "提案中…" : "🔗 戦略リンクをAI提案"}
              </button>
              {strategyLinkError && (
                <p className={styles.errorText} role="alert" style={{ marginTop: 6 }}>
                  {strategyLinkError}
                </p>
              )}
              {strategyLinkPreview && (
                <div style={{ marginTop: 8 }}>
                  <IssueStrategyLinkSuggestPanel
                    suggestions={strategyLinkPreview.suggestions}
                    source={strategyLinkPreview.source}
                    fallbackReason={strategyLinkPreview.fallbackReason}
                    applyingId={strategyLinkApplyingId}
                    onAdopt={handleAdoptStrategyLink}
                    onDismiss={() => setStrategyLinkPreview(null)}
                    onDismissOne={() => setStrategyLinkPreview(null)}
                  />
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
