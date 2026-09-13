"use client";

import { useRef, useState } from "react";
import styles from "@/app/page.module.css";
import { HelpLink } from "@/components/HelpLink";
import { MarkdownView } from "@/components/MarkdownView";
import { INTERVENTION_TYPES, charterFilledCount, type Issue, type IssueCharter, type KnowledgeEvent } from "@/lib/types";
import type { FetchWithNameConfirm, RetryableError } from "./types";

// docs/em_ui_ux_issue.md 7節対応。閲覧モードのWhy/What/Howのラベル（編集モードのlabel文言と揃える）。
const CHARTER_VIEW_FIELDS: { key: keyof IssueCharter; label: string }[] = [
  { key: "why", label: "Why（生む価値・誰のため・なぜ今か）" },
  { key: "what", label: "What（何を・どこまで・どのくらい・完了の定義）" },
  { key: "how", label: "How（どのように実現するか・前提や制約）" },
];

type Props = {
  issue: Issue;
  history: KnowledgeEvent[];
  refreshIssue: () => Promise<void>;
  refreshRuns: () => Promise<void>;
  fetchWithNameConfirm: FetchWithNameConfirm;
};

// docs/em_ui_ux_issue.md 7節「閲覧ビューと編集ビューの分離」対応。Why/What/How・
// 介入の型・タグの表示・編集と、変更履歴の一覧をまとめたセクション。
export function IssueCharterSection({ issue, history, refreshIssue, refreshRuns, fetchWithNameConfirm }: Props) {
  // titleEditingと同じパターン。textarea群は非制御（defaultValue）で、charterEditingが
  // falseの間はアンマウントされているため、キャンセル時に個別のdraft巻き戻しは不要
  // （再度開けば必ずissue.charterの現在値から始まる）。
  const [charterEditing, setCharterEditing] = useState(false);
  const [charterError, setCharterError] = useState<string | null>(null);
  const [charterPending, setCharterPending] = useState(false);
  const [charterPendingError, setCharterPendingError] = useState<RetryableError | null>(null);
  // SettingsのisDirtyと同じ。非制御のWhy/What/How・タグでも、変更がないときは保存を
  // 非アクティブにするため、入力のたびにサーバー最新値と突き合わせる。
  const [charterDirty, setCharterDirty] = useState(false);
  const whyRef = useRef<HTMLTextAreaElement | null>(null);
  const whatRef = useRef<HTMLTextAreaElement | null>(null);
  const howRef = useRef<HTMLTextAreaElement | null>(null);
  const tagsRef = useRef<HTMLInputElement | null>(null);
  // docs/memo.md「G. Issueに『介入の型』を足す」対応。tagsRefは非制御入力なので、
  // チップのハイライト表示だけをこのstateで追従させる（保存時はtagsRef.current.valueを読む）。
  // issueは非同期取得のため初回レンダー時点ではundefined——データが揃ったタイミングを
  // レンダー中に検知して同期する（useEffectは使わない。以降のポーリング更新では
  // 上書きしないので、編集中の選択状態を壊さない）。
  const [tagsSnapshot, setTagsSnapshot] = useState<string[]>([]);
  const [syncedIssueId, setSyncedIssueId] = useState<string | null>(null);
  if (issue.id !== syncedIssueId) {
    setSyncedIssueId(issue.id);
    setTagsSnapshot(issue.tags);
  }

  function toggleInterventionType(label: string) {
    if (!tagsRef.current) return;
    const current = tagsRef.current.value.split(",").map((t) => t.trim()).filter(Boolean);
    const next = current.includes(label) ? current.filter((t) => t !== label) : [...current, label];
    tagsRef.current.value = next.join(", ");
    setTagsSnapshot(next);
    recomputeCharterDirty();
  }

  function recomputeCharterDirty() {
    const why = whyRef.current?.value ?? "";
    const what = whatRef.current?.value ?? "";
    const how = howRef.current?.value ?? "";
    const tags = (tagsRef.current?.value ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    setCharterDirty(
      why !== issue.charter.why ||
        what !== issue.charter.what ||
        how !== issue.charter.how ||
        JSON.stringify(tags) !== JSON.stringify(issue.tags),
    );
  }

  async function sendCharterPatch(body: Record<string, unknown>, retry: () => void) {
    setCharterPending(true);
    setCharterPendingError(null);
    try {
      const { res, data } = await fetchWithNameConfirm(
        `/api/issues/${issue.id}`,
        { method: "PATCH", body },
        "保存する",
      );
      if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? "保存に失敗しました");
      await Promise.all([refreshIssue(), refreshRuns()]);
    } catch (err) {
      if ((err as Error).message !== "人名候補の確認をキャンセルしました") {
        setCharterPendingError({ message: (err as Error).message, retry });
      }
    } finally {
      setCharterPending(false);
    }
  }

  function handleSaveCharter() {
    if (!charterDirty) return;
    const body = {
      why: whyRef.current?.value ?? "",
      what: whatRef.current?.value ?? "",
      how: howRef.current?.value ?? "",
      tags: (tagsRef.current?.value ?? "").split(",").map((t) => t.trim()).filter(Boolean),
    };
    setCharterError(null);
    setCharterEditing(false);
    setCharterDirty(false);
    const retry = () => {
      void sendCharterPatch(body, retry);
    };
    void sendCharterPatch(body, retry);
  }

  function startEditingCharter() {
    if (charterPending) return;
    setCharterError(null);
    setCharterPendingError(null);
    setCharterDirty(false);
    setCharterEditing(true);
  }

  function handleCancelCharter() {
    setCharterError(null);
    setCharterDirty(false);
    setCharterEditing(false);
  }

  return (
    <div className={`${styles.panel} ${styles.charterSection}`} key={issue.id}>
      <div className={styles.pageTitleWithHelp} style={{ marginBottom: 10 }}>
        <h2 style={{ margin: 0 }}>Why / What / How</h2>
        <HelpLink anchor="issues" />
      </div>

      {charterFilledCount(issue.charter) < 3 && (
        <div className={styles.charterWarnBanner}>
          ⚠️ {charterFilledCount(issue.charter)}/3 未整理{charterEditing ? "（点線＝未記入）" : ""}
        </div>
      )}

      {/* docs/em_ui_ux_issue.md 7節「閲覧ビューと編集ビューの分離」対応。デフォルトは
          入力フォームを持たない閲覧モード。テキストクリックまたは「編集」ボタンで
          編集モードへ切り替える（titleEditingと同じ思想）。
          保存はJournalと同様にフォームを閉じて裏で処理し、対象パネルにスピナーを出す。 */}
      {charterPending && (
        <p className={styles.subtitle} style={{ marginBottom: 10 }} role="status">
          <span className={styles.spinner} aria-hidden="true" />
          Why/What/How・タグを保存中…
        </p>
      )}
      {charterPendingError && (
        <div className={styles.tagRow} style={{ marginBottom: 10 }}>
          <span className={styles.errorText} role="alert">
            ⚠️ 保存に失敗しました: {charterPendingError.message}
          </span>
          <button className={styles.btnOutline} onClick={charterPendingError.retry}>
            再試行
          </button>
          <button className={styles.btnOutline} onClick={() => setCharterPendingError(null)}>
            閉じる
          </button>
        </div>
      )}
      {!charterEditing ? (
        <>
          {CHARTER_VIEW_FIELDS.map(({ key, label }) => (
            <div key={key} className={styles.charterField}>
              <span className={styles.fieldCaption}>{label}</span>
              {issue.charter[key] ? (
                <div
                  className={styles.editableTextView}
                  onClick={charterPending ? undefined : startEditingCharter}
                >
                  <MarkdownView text={issue.charter[key]} />
                </div>
              ) : (
                <div
                  className={styles.charterEmptyView}
                  onClick={charterPending ? undefined : startEditingCharter}
                >
                  未整理（クリックして記入）
                </div>
              )}
            </div>
          ))}

          {issue.tags.length > 0 && (
            <div className={styles.tagRow} style={{ marginBottom: 10 }}>
              {issue.tags.map((tag) => (
                <span key={tag} className={`${styles.tag} ${styles.tagTopic}`}>
                  #{tag}
                </span>
              ))}
            </div>
          )}

          {!charterPending && (
            <button className={`${styles.detailToggle} ${styles.detailToggleButton}`} onClick={startEditingCharter}>
              編集
            </button>
          )}
        </>
      ) : (
        <>
          <div className={styles.charterField}>
            <label>Why（生む価値・誰のため・なぜ今か）
            <textarea
              ref={whyRef}
              rows={2}
              defaultValue={issue.charter.why}
              className={issue.charter.why ? "" : styles.charterEmpty}
              placeholder="未整理（クリックして記入）"
              onChange={recomputeCharterDirty}
            /></label>
          </div>
          <div className={styles.charterField}>
            <label>What（何を・どこまで・どのくらい・完了の定義）
            <textarea
              ref={whatRef}
              rows={2}
              defaultValue={issue.charter.what}
              className={issue.charter.what ? "" : styles.charterEmpty}
              placeholder="未整理（クリックして記入）"
              onChange={recomputeCharterDirty}
            /></label>
          </div>
          <div className={styles.charterField}>
            <label>How（どのように実現するか・前提や制約）
            <textarea
              ref={howRef}
              rows={2}
              defaultValue={issue.charter.how}
              className={issue.charter.how ? "" : styles.charterEmpty}
              placeholder="未整理（クリックして記入）"
              onChange={recomputeCharterDirty}
            /></label>
          </div>
          <div className={styles.field}>
            <span className={styles.fieldCaption}>介入の型（実装タスクではなく仕組み・人・組織への介入の切り口）</span>
            <div role="group" aria-label="介入の型（複数選択可）" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {INTERVENTION_TYPES.map((t) => (
                <button
                  key={t.label}
                  type="button"
                  className={`${styles.typeChip} ${tagsSnapshot.includes(t.label) ? styles.typeChipSelected : ""}`}
                  onClick={() => toggleInterventionType(t.label)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.field}>
            <label>タグ（カンマ区切り）
            <input
              type="text"
              ref={tagsRef}
              defaultValue={issue.tags.join(", ")}
              onChange={(e) => {
                setTagsSnapshot(e.target.value.split(",").map((t) => t.trim()).filter(Boolean));
                recomputeCharterDirty();
              }}
              placeholder="例: バグ, リファクタリング, オンボーディング"
            /></label>
          </div>
          {issue.tags.length > 0 && (
            <div className={styles.tagRow} style={{ marginBottom: 10 }}>
              {issue.tags.map((tag) => (
                <span key={tag} className={`${styles.tag} ${styles.tagTopic}`}>
                  #{tag}
                </span>
              ))}
            </div>
          )}
          {charterError && <p className={styles.errorText} role="alert">{charterError}</p>}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className={styles.primaryBtn}
              style={{ width: "auto" }}
              disabled={!charterDirty}
              onClick={handleSaveCharter}
            >
              {charterDirty ? "Why/What/How・タグを保存" : "保存済み"}
            </button>
            <button className={styles.btnOutline} onClick={handleCancelCharter}>
              キャンセル
            </button>
          </div>
        </>
      )}

      {history.length > 0 && (
        <details style={{ marginTop: 14 }}>
          <summary style={{ cursor: "pointer", fontSize: "0.75rem", color: "var(--text-muted)" }}>
            変更履歴（{history.length}件）
          </summary>
          <ul style={{ listStyle: "none", marginTop: 8 }}>
            {history.map((h) => (
              <li key={h.id} style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: 4 }}>
                {new Date(h.occurredAt).toLocaleString("ja-JP")} — {h.text}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
