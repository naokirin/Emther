"use client";

import { useState } from "react";
import styles from "@/app/page.module.css";
import { JournalEntryCard } from "@/components/JournalEntryCard";
import { PaginationControls, usePagination } from "@/components/Pagination";
import { useJournal, useJournalEditing } from "@/lib/hooks";
import type { JournalEntry } from "@/lib/types";

const PAGE_SIZE = 10;

const PERIOD_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "すべての期間" },
  { value: "7", label: "直近7日" },
  { value: "30", label: "直近30日" },
  { value: "90", label: "直近90日" },
];

// docs/memo.md TODO「Quick Journal を人間側が後からリスト確認・検索しにくいUIになっている。
// ダッシュボードトップでは直近５件程度にとどめつつ、Quick Journalをリスト確認・検索できる
// 画面を追加する」対応。Dashboardは直近5件のみを表示し、全件の横断検索・絞り込みは
// この画面に寄せる。検索・絞り込みはIssue一覧と同じくクライアント側フィルタ
// （単一ローカルユーザー規模のため、専用の検索APIは導入しない）。
function matchesQuery(entry: JournalEntry, query: string): boolean {
  if (!query) return true;
  const lower = query.toLowerCase();
  return (
    entry.rawText.toLowerCase().includes(lower) ||
    entry.summary.toLowerCase().includes(lower) ||
    entry.tags.some((t) => t.toLowerCase().includes(lower)) ||
    entry.people.some((p) => p.toLowerCase().includes(lower))
  );
}

export default function JournalListPage() {
  const { journalEntries, setJournalEntries } = useJournal();
  const editing = useJournalEditing(journalEntries, setJournalEntries);

  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [personFilter, setPersonFilter] = useState("");
  const [urgencyFilter, setUrgencyFilter] = useState<JournalEntry["urgency"] | "">("");
  const [sentimentFilter, setSentimentFilter] = useState<JournalEntry["sentiment"] | "">("");
  const [periodDays, setPeriodDays] = useState("all");
  // レンダー中にDate.now()を直接呼ばない（react-hooks/purity）ため、マウント時の1回だけ
  // 遅延初期化で取得する。日単位の期間フィルタなので、この程度の鮮度で十分。
  const [now] = useState(() => Date.now());

  const allTags = Array.from(new Set(journalEntries.flatMap((e) => e.tags))).sort((a, b) => a.localeCompare(b, "ja"));
  const allPeople = Array.from(new Set(journalEntries.flatMap((e) => e.people))).sort((a, b) => a.localeCompare(b, "ja"));

  const filtered = journalEntries.filter((entry) => {
    if (!matchesQuery(entry, query)) return false;
    if (tagFilter && !entry.tags.includes(tagFilter)) return false;
    if (personFilter && !entry.people.includes(personFilter)) return false;
    if (urgencyFilter && entry.urgency !== urgencyFilter) return false;
    if (sentimentFilter && entry.sentiment !== sentimentFilter) return false;
    if (periodDays !== "all" && now - entry.createdAt > Number(periodDays) * 24 * 60 * 60 * 1000) return false;
    return true;
  });

  const pagination = usePagination(filtered, PAGE_SIZE);

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
          <label>キーワード検索（本文・要約・タグ・人物）</label>
          <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="例: リファクタリング" />
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-muted)" }}>
            期間:
            <select value={periodDays} onChange={(e) => setPeriodDays(e.target.value)}>
              {PERIOD_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-muted)" }}>
            人物:
            <select value={personFilter} onChange={(e) => setPersonFilter(e.target.value)}>
              <option value="">すべて</option>
              {allPeople.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-muted)" }}>
            タグ:
            <select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
              <option value="">すべて</option>
              {allTags.map((t) => (
                <option key={t} value={t}>
                  #{t}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-muted)" }}>
            Urgency:
            <select value={urgencyFilter} onChange={(e) => setUrgencyFilter(e.target.value as JournalEntry["urgency"] | "")}>
              <option value="">すべて</option>
              <option value="low">Low</option>
              <option value="mid">Mid</option>
              <option value="high">High</option>
            </select>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-muted)" }}>
            感情:
            <select value={sentimentFilter} onChange={(e) => setSentimentFilter(e.target.value as JournalEntry["sentiment"] | "")}>
              <option value="">すべて</option>
              <option value="positive">ポジティブ</option>
              <option value="neutral">ニュートラル</option>
              <option value="negative">ネガティブ</option>
            </select>
          </label>
        </div>
      </div>

      <div className={styles.panel} style={{ marginTop: 16 }}>
        {filtered.length === 0 ? (
          <p className={styles.subtitle}>条件に一致するJournalはありません。</p>
        ) : (
          pagination.pageItems.map((entry) => (
            <JournalEntryCard
              key={entry.id}
              entry={entry}
              editing={editing.editingEntryId === entry.id}
              editTags={editing.editTags}
              editPeople={editing.editPeople}
              editUrgency={editing.editUrgency}
              editDate={editing.editDate}
              editSubmitting={editing.editSubmitting}
              editError={editing.editError}
              onChangeEditTags={editing.setEditTags}
              onChangeEditPeople={editing.setEditPeople}
              onChangeEditUrgency={editing.setEditUrgency}
              onChangeEditDate={editing.setEditDate}
              onConfirmEdit={() => editing.confirmEdit(entry.id)}
              onCancelEdit={editing.cancelEditing}
              onStartEdit={() => editing.startEditing(entry)}
            />
          ))
        )}
        <PaginationControls
          page={pagination.page}
          totalPages={pagination.totalPages}
          total={pagination.total}
          rangeStart={pagination.rangeStart}
          rangeEnd={pagination.rangeEnd}
          onChange={pagination.setPage}
        />
      </div>
    </div>
  );
}
