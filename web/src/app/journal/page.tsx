"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import styles from "@/app/page.module.css";
import { JournalEntryCard } from "@/components/JournalEntryCard";
import { PaginationControls, paginationMeta } from "@/components/Pagination";
import { Select } from "@/components/Select";
import { useJournalEditing, useJournalSearch } from "@/lib/hooks";
import type { JournalEntry } from "@/lib/types";

const PAGE_SIZE = 10;

const PERIOD_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "すべての期間" },
  { value: "7", label: "直近7日" },
  { value: "30", label: "直近30日" },
  { value: "90", label: "直近90日" },
];

const URGENCY_FILTER_OPTIONS = [
  { value: "", label: "すべて" },
  { value: "low", label: "Low" },
  { value: "mid", label: "Mid" },
  { value: "high", label: "High" },
];

const SENTIMENT_FILTER_OPTIONS = [
  { value: "", label: "すべて" },
  { value: "positive", label: "ポジティブ" },
  { value: "neutral", label: "ニュートラル" },
  { value: "negative", label: "ネガティブ" },
];

export default function JournalListPage() {
  return (
    <Suspense fallback={null}>
      <JournalListPageInner />
    </Suspense>
  );
}

// docs/em_human_story_and_ux.md 改修依頼「Dashboardの『Journal未確認』が/journalへ
// 放り込むだけで、その先どのエントリに何をすればいいか分からない」対応。
// `?focus=<journalEntryId>`が付いている場合、そのエントリが載っているページへ自動的に
// 移動し、編集モードまで自動的に開く（EMは中身を確認して「この内容で確定」を押すだけで
// 完結する）。
//
// ユーザー要望「一覧の全件取得をページネーション化したい」対応。検索・絞り込み・ページ送りは
// すべてサーバー側（/api/journal/search）で行う。focusIdが指すエントリの「何ページ目か」も
// サーバー側で解決し（findJournalEntryOffset）、クライアントでの全件走査は行わない。
function JournalListPageInner() {
  const searchParams = useSearchParams();
  const focusId = searchParams.get("focus");

  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [personFilter, setPersonFilter] = useState("");
  const [urgencyFilter, setUrgencyFilter] = useState<JournalEntry["urgency"] | "">("");
  const [sentimentFilter, setSentimentFilter] = useState<JournalEntry["sentiment"] | "">("");
  const [periodDays, setPeriodDays] = useState("all");
  // ユーザー指摘「対応済みを除外するフィルタを追加してほしい」対応。対応済みの定義は
  // JournalEntryCard.tsxの「✅ 対応済み」表示と同じ（isJournalEntryResolved）。
  const [excludeResolved, setExcludeResolved] = useState(false);
  const [page, setPage] = useState(1);

  // フィルタが変わったら1ページ目に戻す（サーバー側の総件数が変わり、保持していた
  // ページ番号が範囲外になりうるため）。
  function updateFilter<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setPage(1);
    };
  }

  const [appliedFocusId, setAppliedFocusId] = useState<string | null>(null);
  const activeFocusId = focusId && focusId !== appliedFocusId ? focusId : null;

  const { entries, total, resolvedPage, facets, setEntries } = useJournalSearch(
    {
      query,
      tag: tagFilter,
      person: personFilter,
      urgency: urgencyFilter,
      sentiment: sentimentFilter,
      periodDays,
      excludeResolved,
    },
    page,
    PAGE_SIZE,
    activeFocusId,
  );
  const editing = useJournalEditing(entries, setEntries);
  const pagination = paginationMeta(total, activeFocusId ? resolvedPage : page, PAGE_SIZE);

  // focusIdが指すエントリがサーバーから返ってきたら、ページ番号をそちらへ同期し、
  // 編集モードを開く。journalEntriesはポーリングでの非同期取得のため、初回レンダー時点では
  // まだ対象エントリが無いことがある（issue詳細画面のsyncedIssueIdと同じ理由でuseEffectは
  // 使わず、レンダー中に前回のfocusIdと比較して同期する）。
  if (activeFocusId) {
    const target = entries.find((e) => e.id === activeFocusId);
    if (target) {
      setAppliedFocusId(activeFocusId);
      setPage(resolvedPage);
      editing.startEditing(target);
    }
  }

  // ページ・編集モードの切り替え（DOMの再構成）が終わったあとでないと対象のカードへ
  // スクロールできないため、ここだけは実際のDOM操作を伴う副作用としてuseEffectを使う
  // （state派生の同期ではないため、上記の「レンダー中に同期する」規約の対象外）。
  const focusedEntryRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (appliedFocusId) focusedEntryRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [appliedFocusId]);

  return (
    <div className={styles.screen}>
      <div className={styles.detailHeader}>
        <h2 style={{ margin: 0 }}>Quick Journal 一覧・検索</h2>
      </div>
      <p className={styles.subtitle} style={{ marginBottom: 12 }}>
        Dashboardには直近5件のみを表示しています。ここでは全件を横断してキーワード検索・絞り込みができます。
      </p>

      <div className={styles.panel}>
        <div className={styles.field}>
          <label>キーワード検索（本文・要約・タグ・人物）
          <input
            type="text"
            value={query}
            onChange={(e) => updateFilter(setQuery)(e.target.value)}
            placeholder="例: リファクタリング"
          /></label>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8125rem", color: "var(--text-muted)" }}>
            期間:
            <Select value={periodDays} onChange={updateFilter(setPeriodDays)} options={PERIOD_OPTIONS} style={{ minWidth: 140 }} />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8125rem", color: "var(--text-muted)" }}>
            人物:
            <Select
              value={personFilter}
              onChange={updateFilter(setPersonFilter)}
              options={[{ value: "", label: "すべて" }, ...facets.people.map((p) => ({ value: p, label: p }))]}
              style={{ minWidth: 140 }}
            />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8125rem", color: "var(--text-muted)" }}>
            タグ:
            <Select
              value={tagFilter}
              onChange={updateFilter(setTagFilter)}
              options={[{ value: "", label: "すべて" }, ...facets.tags.map((t) => ({ value: t, label: `#${t}` }))]}
              style={{ minWidth: 140 }}
            />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8125rem", color: "var(--text-muted)" }}>
            Urgency:
            <Select
              value={urgencyFilter}
              onChange={updateFilter((v: string) => setUrgencyFilter(v as JournalEntry["urgency"] | ""))}
              options={URGENCY_FILTER_OPTIONS}
              style={{ minWidth: 120 }}
            />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8125rem", color: "var(--text-muted)" }}>
            感情:
            <Select
              value={sentimentFilter}
              onChange={updateFilter((v: string) => setSentimentFilter(v as JournalEntry["sentiment"] | ""))}
              options={SENTIMENT_FILTER_OPTIONS}
              style={{ minWidth: 140 }}
            />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8125rem", color: "var(--text-muted)" }}>
            <input
              type="checkbox"
              checked={excludeResolved}
              onChange={(e) => updateFilter(setExcludeResolved)(e.target.checked)}
            />
            ✅ 対応済みを除外
          </label>
        </div>
      </div>

      <div className={styles.panel} style={{ marginTop: 16 }}>
        {entries.length === 0 ? (
          <p className={styles.subtitle}>条件に一致するJournalはありません。</p>
        ) : (
          entries.map((entry) => (
            <div key={entry.id} ref={entry.id === focusId ? focusedEntryRef : undefined}>
              <JournalEntryCard
                entry={entry}
                editing={editing.editingEntryId === entry.id}
                editRawText={editing.editRawText}
                editTags={editing.editTags}
                editPeople={editing.editPeople}
                editUrgency={editing.editUrgency}
                editDate={editing.editDate}
                editSubmitting={editing.editSubmitting}
                editError={editing.editError}
                resolutionNoteDraft={editing.resolutionNoteDraft}
                pending={editing.isEntryPending(entry.id)}
                pendingError={editing.pendingEntryErrors[entry.id]}
                onDismissPendingError={() => editing.dismissPendingError(entry.id)}
                onChangeEditRawText={editing.setEditRawText}
                onChangeEditTags={editing.setEditTags}
                onChangeEditPeople={editing.setEditPeople}
                onChangeEditUrgency={editing.setEditUrgency}
                onChangeEditDate={editing.setEditDate}
                onChangeResolutionNoteDraft={editing.setResolutionNoteDraft}
                onConfirmEdit={() => editing.confirmEdit(entry.id)}
                onCancelEdit={editing.cancelEditing}
                onStartEdit={() => editing.startEditing(entry)}
                onResolveWithNote={() => editing.resolveWithNote(entry.id)}
                onResolveWithNewIssue={() => editing.resolveWithNewIssue(entry)}
                onClearResolution={() => editing.clearResolution(entry.id)}
              />
            </div>
          ))
        )}
        <PaginationControls
          page={pagination.page}
          totalPages={pagination.totalPages}
          total={pagination.total}
          rangeStart={pagination.rangeStart}
          rangeEnd={pagination.rangeEnd}
          onChange={setPage}
        />
      </div>
    </div>
  );
}
