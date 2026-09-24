import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import styles from "../../styles/page.module.css";
import { JournalEntryCard } from "../../components/JournalEntryCard";
import { JournalFilterBar, type JournalFilterState } from "../../components/JournalFilterBar";
import {
  decodeJournalListSearch,
  EMPTY_JOURNAL_LIST_FILTERS,
  encodeJournalListSearch,
  journalListSearchSchema,
} from "../../components/journalListSearch";
import { JournalInputSwitcher } from "../../components/JournalInputSwitcher";
import { PageTitleRow } from "../../components/HelpLink";
import { PaginationControls } from "../../components/Pagination";
import { paginationMeta } from "../../components/usePagination";
import { api } from "../../lib/api-client";
import { useSuggestions, useJournalSearch, useJournalBatchStatus } from "../../lib/queries";
import { useTypedSearchParams } from "../../lib/useTypedSearchParams";
import type { AgentRunMutationResponse } from "@emther/api-contract";
import { useJournalEditing } from "../../lib/useJournalEditing";

// 書く／見返すの二層構成・集約解釈ストリップ・絞り込みポップオーバーへ再編
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

export function JournalPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const focusId = searchParams.get("focus");
  const focusDumpId = searchParams.get("dump");
  const prefill = searchParams.get("prefill");

  const [listSearchParams, setListSearchParams] = useTypedSearchParams(journalListSearchSchema);
  const filterState = decodeJournalListSearch(listSearchParams);

  const [batchSubmitting, setBatchSubmitting] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  async function handleRunJournalBatch() {
    setBatchSubmitting(true);
    setBatchError(null);
    try {
      const res = await api.api.journal.batch.$post();
      const data = (await res.json().catch(() => null)) as (AgentRunMutationResponse & { error?: string }) | null;
      if (res.status === 202) return;
      if (!res.ok) throw new Error(data?.error ?? "Journal集約解釈の起動に失敗しました");
      const runId = data?.run?.id;
      if (runId) navigate(`/chat?runId=${runId}`);
    } catch (err) {
      setBatchError((err as Error).message);
    } finally {
      setBatchSubmitting(false);
    }
  }

  const [page, setPage] = useState(1);

  function handleFilterChange(patch: Partial<JournalFilterState>) {
    setPage(1);
    setListSearchParams(encodeJournalListSearch({ ...filterState, ...patch }));
  }

  function clearFilters() {
    setPage(1);
    setListSearchParams(
      encodeJournalListSearch({
        query: filterState.query,
        ...EMPTY_JOURNAL_LIST_FILTERS,
      }),
    );
  }

  const [appliedFocusId, setAppliedFocusId] = useState<string | null>(null);
  const activeFocusId = focusId && focusId !== appliedFocusId ? focusId : null;

  const { entries, total, resolvedPage, facets, setEntries, searchLoaded, refreshSearch } = useJournalSearch(
    {
      query: filterState.query,
      tag: filterState.tagFilter,
      person: filterState.personFilter,
      urgency: filterState.urgencyFilter,
      sentiment: filterState.sentimentFilter,
      periodDays: filterState.periodDays,
      excludeResolved: filterState.excludeResolved,
      includeArchived: filterState.includeArchived,
      quarantinedOnly: filterState.quarantinedOnly,
      includeSensitive: filterState.includeSensitive,
    },
    page,
    PAGE_SIZE,
    activeFocusId,
  );
  const editing = useJournalEditing(entries, setEntries);
  const { suggestions } = useSuggestions();
  const { pendingCount, batchStatusLoaded, refreshBatchStatus } = useJournalBatchStatus();
  const pagination = paginationMeta(total, activeFocusId ? resolvedPage : page, PAGE_SIZE);

  if (activeFocusId) {
    const target = entries.find((e) => e.id === activeFocusId);
    if (target) {
      setAppliedFocusId(activeFocusId);
      setPage(resolvedPage);
      editing.startEditing(target);
    }
  }

  const focusedEntryRef = useRef<HTMLDivElement | null>(null);
  // focus適用後は queryKey から focusId が外れるため、一瞬 entries が空になり ref が
  // 取れないことがある。また <ScrollRestoration /> は親の effect でトップへ戻すため、
  // 子の同期的 scrollIntoView は遷移直後に上書きされうる。entries に対象が載ったあと、
  // 親 effect より後の macrotask で一度だけスクロールする。
  const scrolledFocusIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!appliedFocusId || scrolledFocusIdRef.current === appliedFocusId) return;
    if (!entries.some((e) => e.id === appliedFocusId)) return;

    const timer = window.setTimeout(() => {
      const el =
        focusedEntryRef.current ??
        document.querySelector<HTMLElement>(`[data-journal-id="${CSS.escape(appliedFocusId)}"]`);
      if (!el) return;
      // jsdom には scrollIntoView が無いため optional（Select.tsx 等と同じ）。
      el.scrollIntoView?.({ behavior: "smooth", block: "center" });
      scrolledFocusIdRef.current = appliedFocusId;
    }, 0);
    return () => window.clearTimeout(timer);
  }, [appliedFocusId, entries]);

  // 集約解釈は「見返す」冒頭の文脈ストリップ。未解釈があるときだけ出す。
  const showBatchStrip = batchStatusLoaded && pendingCount > 0;

  return (
    <div className={styles.screen}>
      <div style={{ marginBottom: 12 }}>
        <PageTitleRow title="ジャーナル" helpAnchor="journal" />
        <p className={styles.journalTitleHint}>感知のメモを残し、あとから見返す</p>
      </div>

      <JournalInputSwitcher
        onSaved={() => {
          void refreshBatchStatus();
          if (page === 1) refreshSearch();
          else setPage(1);
        }}
        focusDumpId={focusDumpId}
        prefill={prefill}
      />

      <div className={styles.panel}>
        <div className={styles.journalReviewHeader}>
          <h3 className={styles.journalSectionLabel}>見返す</h3>
          <span className={styles.journalReviewCount}>{total}件</span>
        </div>

        {showBatchStrip && (
          <div className={styles.journalBatchStrip}>
            <div className={styles.journalBatchCopy}>
              <p className={styles.journalBatchTitle}>前回解釈から {pendingCount}件の未解釈があります</p>
              <p className={styles.journalBatchHint}>まとめて Lead Agent に渡します（最大7日）</p>
            </div>
            <button className={styles.primaryBtn} style={{ width: "auto" }} disabled={batchSubmitting} onClick={handleRunJournalBatch}>
              {batchSubmitting ? "解釈中…" : "集約解釈する"}
            </button>
          </div>
        )}
        {batchError && (
          <p className={styles.errorText} role="alert">
            {batchError}
          </p>
        )}

        <JournalFilterBar
          value={filterState}
          onChange={handleFilterChange}
          onClear={clearFilters}
          periodOptions={PERIOD_OPTIONS}
          urgencyOptions={URGENCY_FILTER_OPTIONS}
          sentimentOptions={SENTIMENT_FILTER_OPTIONS}
          people={facets.people}
          tags={facets.tags}
        />

        <div className={styles.journalEntryList}>
          {entries.length === 0 ? (
            <p className={styles.subtitle}>{!searchLoaded ? "読み込み中…" : "条件に一致するJournalはありません。"}</p>
          ) : (
            entries.map((entry) => (
              <div key={entry.id} data-journal-id={entry.id} ref={entry.id === focusId ? focusedEntryRef : undefined}>
                <JournalEntryCard
                  entry={entry}
                  suggestions={suggestions}
                  editing={editing.editingEntryId === entry.id}
                  editRawText={editing.editRawText}
                  editTags={editing.editTags}
                  editPeople={editing.editPeople}
                  editTeams={editing.editTeams}
                  editUrgency={editing.editUrgency}
                  editSentiment={editing.editSentiment}
                  editDate={editing.editDate}
                  editSensitive={editing.editSensitive}
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
                  onChangeEditSensitive={editing.setEditSensitive}
                  onChangeResolutionNoteDraft={editing.setResolutionNoteDraft}
                  onConfirmEdit={() => editing.confirmEdit(entry.id)}
                  onConfirmAsIs={() => editing.confirmAsIs(entry)}
                  onStartAnalysis={() => editing.startAnalysis(entry)}
                  onCancelEdit={editing.cancelEditing}
                  onStartEdit={() => editing.startEditing(entry)}
                  onResolveWithNote={() => editing.resolveWithNote(entry.id)}
                  onResolveWithNewSuggestion={() => editing.resolveWithNewSuggestion(entry)}
                  onClearResolution={() => editing.clearResolution(entry.id)}
                  onAcknowledgeSentiment={() => editing.acknowledgeSentiment(entry.id)}
                  onClearSentimentAck={() => editing.clearSentimentAck(entry.id)}
                  onArchive={() => editing.archiveEntry(entry.id)}
                  onUnarchive={() => editing.unarchiveEntry(entry.id)}
                  onMarkSensitive={() => editing.markSensitive(entry.id)}
                  onUnmarkSensitive={() => editing.unmarkSensitive(entry.id)}
                  onTagClick={(tag) => handleFilterChange({ tagFilter: tag })}
                />
              </div>
            ))
          )}
        </div>
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
