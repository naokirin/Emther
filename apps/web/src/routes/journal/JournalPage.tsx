import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import styles from "../../styles/page.module.css";
import { JournalEntryCard } from "../../components/JournalEntryCard";
import { JournalInputSwitcher } from "../../components/JournalInputSwitcher";
import { PageTitleRow } from "../../components/HelpLink";
import { PaginationControls, paginationMeta } from "../../components/Pagination";
import { Select } from "../../components/Select";
import { useIssues, useJournalSearch, useObjectives } from "../../lib/queries";
import type { JournalEntry } from "@emther/core/types";
import { useJournalEditing } from "../../lib/useJournalEditing";

// web/src/app/journal/page.tsx（Next.js版）からの移植（フェーズ3.5 tier4）。
// react-routerのuseSearchParamsはSuspenseを要求しないため、元実装の<Suspense>ラッパーは
// 不要（削除した）。stylesのimportパス・`@core/*`のbare specifier化・`next/navigation`の
// useRouter/useSearchParams→react-routerのuseNavigate/useSearchParams以外はロジックを
// 変更していない。
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
      if (runId) navigate(`/chat?runId=${runId}`);
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
  const [excludeResolved, setExcludeResolved] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [quarantinedOnly, setQuarantinedOnly] = useState(false);
  const [page, setPage] = useState(1);

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

  if (activeFocusId) {
    const target = entries.find((e) => e.id === activeFocusId);
    if (target) {
      setAppliedFocusId(activeFocusId);
      setPage(resolvedPage);
      editing.startEditing(target);
    }
  }

  const focusedEntryRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (appliedFocusId) focusedEntryRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [appliedFocusId]);

  return (
    <div className={styles.screen}>
      <PageTitleRow title="ジャーナル" helpAnchor="journal" />

      <JournalInputSwitcher
        onSaved={() => {
          if (page === 1) refreshSearch();
          else setPage(1);
        }}
        focusDumpId={focusDumpId}
        prefill={prefill}
      />

      <div className={styles.panel} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <p className={styles.subtitle} style={{ margin: 0, flex: "1 1 auto" }}>
          前回解釈以降のJournalをまとめて解釈します（最大7日。日次バッチとは別に、今すぐ実行できます）。
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
