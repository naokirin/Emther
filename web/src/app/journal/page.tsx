"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import styles from "@/app/page.module.css";
import { JournalEntryCard } from "@/components/JournalEntryCard";
import { JournalInputSwitcher } from "@/components/JournalInputSwitcher";
import { PageTitleRow } from "@/components/HelpLink";
import { PaginationControls, paginationMeta } from "@/components/Pagination";
import { Select } from "@/components/Select";
import { useIssues, useJournalSearch, useObjectives } from "@/lib/hooks";
import type { JournalEntry } from "@/lib/types";
import { useJournalEditing } from "@/lib/useJournalEditing";

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
  const router = useRouter();
  const searchParams = useSearchParams();
  const focusId = searchParams.get("focus");
  const focusDumpId = searchParams.get("dump");

  // ユーザー要望「Journal単独だけでなく、集約解釈を手動実行できるボタンを現場メモの
  // ページに置きたい」対応。日次バッチ（auto-journal-batch）を待たずに、EMが見たい
  // タイミングで直近のJournalをまとめてLead Agentに解釈させる（/api/themes/distillの
  // 状況蒸留ボタンと同型）。
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  async function handleRunJournalBatch() {
    setBatchSubmitting(true);
    setBatchError(null);
    try {
      const res = await fetch("/api/journal/batch", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (res.status === 202) return;
      if (!res.ok) throw new Error(data?.error ?? "Journal集約解釈の起動に失敗しました");
      const runId = data?.run?.id as string | undefined;
      if (runId) router.push(`/chat?runId=${runId}`);
    } catch (err) {
      setBatchError((err as Error).message);
    } finally {
      setBatchSubmitting(false);
    }
  }

  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [personFilter, setPersonFilter] = useState("");
  const [urgencyFilter, setUrgencyFilter] = useState<JournalEntry["urgency"] | "">("");
  const [sentimentFilter, setSentimentFilter] = useState<JournalEntry["sentiment"] | "">("");
  const [periodDays, setPeriodDays] = useState("all");
  // ユーザー指摘「対応済みを除外するフィルタを追加してほしい」対応。対応済みの定義は
  // JournalEntryCard.tsxの「✅ 対応済み」表示と同じ（isJournalEntryResolved）。
  const [excludeResolved, setExcludeResolved] = useState(false);
  // docs/memo.md「相談、Journal、提案を削除（アーカイブ）したい」対応。既定ではアーカイブ済み
  // （重複記録・誤入力等）を一覧から除外し、必要なときだけ表示できるようにする。
  const [includeArchived, setIncludeArchived] = useState(false);
  // docs/memo.md「実名を含んでしまっていた場合に自動で隔離されたJournalをユーザーが
  // 確認できるようにしたい」対応。アーカイブ済みの中でも実名リークによる自動隔離だけに
  // 絞り込む（quarantinedOnly=trueのときはincludeArchivedの値によらずサーバー側で
  // アーカイブ済み扱いにする——lib/journal-store.tsのtoEventFilter参照）。
  const [quarantinedOnly, setQuarantinedOnly] = useState(false);
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

  const { entries, total, resolvedPage, facets, setEntries, searchLoaded, refreshSearch } = useJournalSearch(
    {
      query,
      tag: tagFilter,
      person: personFilter,
      urgency: urgencyFilter,
      sentiment: sentimentFilter,
      periodDays,
      excludeResolved,
      includeArchived,
      quarantinedOnly,
    },
    page,
    PAGE_SIZE,
    activeFocusId,
  );
  const editing = useJournalEditing(entries, setEntries);
  const { issues } = useIssues();
  const { objectives } = useObjectives();
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
      <PageTitleRow title="ジャーナル" helpAnchor="journal" />

      {/* docs/memo.md「Journalが書き込み順にならず、書き込み直後に見失ってしまう」対応。
          新しいJournalは常に一覧の先頭（ページ1）に来るが、他のページを見ている最中に
          記録するとrefreshSearchだけでは今見ているページのままなので、記録直後は
          ページ1へ戻して見失わないようにする（ページ1のときは従来通り即時再取得だけ行う）。 */}
      <JournalInputSwitcher
        onSaved={() => {
          if (page === 1) refreshSearch();
          else setPage(1);
        }}
        focusDumpId={focusDumpId}
      />

      <div className={styles.panel} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <p className={styles.subtitle} style={{ margin: 0, flex: "1 1 auto" }}>
          直近24時間のJournalをまとめて解釈します（日次バッチとは別に、今すぐ実行できます）。
        </p>
        <button className={styles.btnOutline} disabled={batchSubmitting} onClick={handleRunJournalBatch}>
          {batchSubmitting ? "解釈中…" : "🧭 Journalを集約解釈する"}
        </button>
      </div>
      {batchError && (
        <p className={styles.errorText} role="alert">
          {batchError}
        </p>
      )}

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
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.875rem", color: "var(--text-muted)" }}>
            期間:
            <Select value={periodDays} onChange={updateFilter(setPeriodDays)} options={PERIOD_OPTIONS} style={{ minWidth: 140 }} />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.875rem", color: "var(--text-muted)" }}>
            人物:
            <Select
              value={personFilter}
              onChange={updateFilter(setPersonFilter)}
              options={[{ value: "", label: "すべて" }, ...facets.people.map((p) => ({ value: p, label: p }))]}
              style={{ minWidth: 140 }}
            />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.875rem", color: "var(--text-muted)" }}>
            タグ:
            <Select
              value={tagFilter}
              onChange={updateFilter(setTagFilter)}
              options={[{ value: "", label: "すべて" }, ...facets.tags.map((t) => ({ value: t, label: `#${t}` }))]}
              style={{ minWidth: 140 }}
            />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.875rem", color: "var(--text-muted)" }}>
            Urgency:
            <Select
              value={urgencyFilter}
              onChange={updateFilter((v: string) => setUrgencyFilter(v as JournalEntry["urgency"] | ""))}
              options={URGENCY_FILTER_OPTIONS}
              style={{ minWidth: 120 }}
            />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.875rem", color: "var(--text-muted)" }}>
            感情:
            <Select
              value={sentimentFilter}
              onChange={updateFilter((v: string) => setSentimentFilter(v as JournalEntry["sentiment"] | ""))}
              options={SENTIMENT_FILTER_OPTIONS}
              style={{ minWidth: 140 }}
            />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.875rem", color: "var(--text-muted)" }}>
            <input
              type="checkbox"
              checked={excludeResolved}
              onChange={(e) => updateFilter(setExcludeResolved)(e.target.checked)}
            />
            ✅ 対応済み/提案化済みを除外
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.875rem", color: "var(--text-muted)" }}>
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(e) => updateFilter(setIncludeArchived)(e.target.checked)}
            />
            🗄 アーカイブ済みも表示する
          </label>
          <label
            className={styles.axisTooltip}
            style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.875rem", color: "var(--text-muted)" }}
            data-tooltip="実名を含んでいたため自動で隔離（アーカイブ）されたJournalだけに絞り込みます"
          >
            <input
              type="checkbox"
              checked={quarantinedOnly}
              onChange={(e) => updateFilter(setQuarantinedOnly)(e.target.checked)}
            />
            🔒 実名隔離のみ表示する
          </label>
        </div>
      </div>

      <div className={styles.panel} style={{ marginTop: 16 }}>
        {entries.length === 0 ? (
          <p className={styles.subtitle}>{!searchLoaded ? "読み込み中…" : "条件に一致するJournalはありません。"}</p>
        ) : (
          entries.map((entry) => (
            <div key={entry.id} ref={entry.id === focusId ? focusedEntryRef : undefined}>
              <JournalEntryCard
                entry={entry}
                issues={issues}
                objectives={objectives}
                editing={editing.editingEntryId === entry.id}
                editRawText={editing.editRawText}
                editTags={editing.editTags}
                editPeople={editing.editPeople}
                editTeams={editing.editTeams}
                editUrgency={editing.editUrgency}
                editSentiment={editing.editSentiment}
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
                onChangeEditTeams={editing.setEditTeams}
                onChangeEditUrgency={editing.setEditUrgency}
                onChangeEditSentiment={editing.setEditSentiment}
                onChangeEditDate={editing.setEditDate}
                onChangeResolutionNoteDraft={editing.setResolutionNoteDraft}
                onConfirmEdit={() => editing.confirmEdit(entry.id)}
                onConfirmAsIs={() => editing.confirmAsIs(entry)}
                onStartAnalysis={() => editing.startAnalysis(entry)}
                onCancelEdit={editing.cancelEditing}
                onStartEdit={() => editing.startEditing(entry)}
                onResolveWithNote={() => editing.resolveWithNote(entry.id)}
                onResolveWithNewIssue={() => editing.resolveWithNewIssue(entry)}
                onClearResolution={() => editing.clearResolution(entry.id)}
                onAcknowledgeSentiment={() => editing.acknowledgeSentiment(entry.id)}
                onClearSentimentAck={() => editing.clearSentimentAck(entry.id)}
                onArchive={() => editing.archiveEntry(entry.id)}
                onUnarchive={() => editing.unarchiveEntry(entry.id)}
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
      {editing.nameCandidateDialog}
    </div>
  );
}
