"use client";

import { useState } from "react";
import styles from "@/app/page.module.css";
import { PaginationControls, usePagination } from "@/components/Pagination";
import { useReports } from "@/lib/hooks";
import { REPORT_PERIOD_LABEL, type Report, type ReportPeriodType } from "@/lib/types";

const PAGE_SIZE = 5;

function formatDateTime(ts: number): string {
  return new Date(ts).toLocaleString("ja-JP", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

// docs/memo.md TODO「Quick Journal、Issue進捗、各種イベントを週次・月次でレポーティングする
// 機能を追加する。レポートを一過性とせず、蓄積して過去のものも参照できるようにする」対応。
// 「今すぐ生成」ボタンで直近7日/30日を集計したスナップショットを作り、SQLiteに保存する
// （@/lib/report-store）。一覧はその蓄積された過去のレポートを新しい順に並べるだけ。
function ReportCard({ report, onSaveNote }: { report: Report; onSaveNote: (id: string, note: string) => Promise<void> }) {
  const [expanded, setExpanded] = useState(false);
  const [note, setNote] = useState(report.note);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      await onSaveNote(report.id, note);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  const { journal, issues, events } = report.stats;

  return (
    <div className={styles.journalEntry}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div>
          <span className={styles.badge} style={{ marginRight: 8 }}>
            {REPORT_PERIOD_LABEL[report.periodType]}
          </span>
          <strong>
            {formatDateTime(report.periodStart)} 〜 {formatDateTime(report.periodEnd)}
          </strong>
        </div>
        <button className={styles.detailToggle} onClick={() => setExpanded(!expanded)}>
          {expanded ? "閉じる" : "詳細を見る"}
        </button>
      </div>
      <p className={styles.subtitle} style={{ marginTop: 4 }}>
        Journal {journal.total}件（高緊急度 {journal.byUrgency.high}件 / ネガティブ {journal.bySentiment.negative}件） ・ Issue起票{" "}
        {issues.createdCount}件 / 完了 {issues.archivedCount}件 ・ 組織の変更イベント {events.total}件
      </p>

      {expanded && (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 12, fontSize: 12 }}>
          <div>
            <strong>Quick Journal</strong>
            <div className={styles.subtitle}>
              件数: {journal.total} / Urgency（low {journal.byUrgency.low} · mid {journal.byUrgency.mid} · high {journal.byUrgency.high}） /
              感情（positive {journal.bySentiment.positive} · neutral {journal.bySentiment.neutral} · negative {journal.bySentiment.negative}）
            </div>
            {journal.topTags.length > 0 && (
              <div className={styles.tagRow} style={{ marginTop: 4 }}>
                {journal.topTags.map((t) => (
                  <span key={t.tag} className={`${styles.tag} ${styles.tagTopic}`}>
                    #{t.tag} ×{t.count}
                  </span>
                ))}
              </div>
            )}
            {journal.notableEntries.length > 0 && (
              <ul style={{ listStyle: "none", marginTop: 6, padding: 0 }}>
                {journal.notableEntries.map((e) => (
                  <li key={e.id} style={{ marginBottom: 4 }}>
                    ・{e.summary}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <strong>Issue進捗</strong>
            <div className={styles.subtitle}>
              期間中に起票: {issues.createdCount}件 / 完了（アーカイブ）: {issues.archivedCount}件 / 現在Why・What・How未整理のIssue:{" "}
              {issues.openIncompleteCount}件
            </div>
            {issues.createdTitles.length > 0 && (
              <div style={{ marginTop: 4 }}>
                起票: {issues.createdTitles.map((i) => i.title).join(" / ")}
              </div>
            )}
            {issues.archivedTitles.length > 0 && (
              <div style={{ marginTop: 4 }}>
                完了: {issues.archivedTitles.map((i) => i.title).join(" / ")}
              </div>
            )}
          </div>

          <div>
            <strong>各種イベント（組織の状態変化）</strong>
            <div className={styles.subtitle}>
              合計{events.total}件
              {Object.entries(events.byEntityType).length > 0 && (
                <> （{Object.entries(events.byEntityType).map(([k, v]) => `${k}: ${v}件`).join(" / ")}）</>
              )}
            </div>
          </div>

          <div className={styles.field}>
            <label>EMの所感・コメント</label>
            <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="このレポートを見て感じたこと・次にやることなど" />
            <button className={styles.btnOutline} style={{ marginTop: 6 }} disabled={saving} onClick={handleSave}>
              {saving ? "保存中…" : "コメントを保存"}
            </button>
            {saved && <span className={styles.subtitle} style={{ marginLeft: 8 }}>✅ 保存しました</span>}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ReportsPage() {
  const [periodFilter, setPeriodFilter] = useState<ReportPeriodType | "">("");
  const { reports, setReports, refreshReports } = useReports(periodFilter);
  const [generating, setGenerating] = useState<ReportPeriodType | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);

  async function handleGenerate(periodType: ReportPeriodType) {
    setGenerating(periodType);
    setGenerateError(null);
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "レポートの生成に失敗しました");
      await refreshReports();
    } catch (err) {
      setGenerateError((err as Error).message);
    } finally {
      setGenerating(null);
    }
  }

  async function handleSaveNote(id: string, note: string) {
    const res = await fetch(`/api/reports/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note }),
    });
    const data = await res.json();
    if (res.ok) {
      setReports(reports.map((r) => (r.id === id ? data.report : r)));
    }
  }

  const pagination = usePagination(reports, PAGE_SIZE);

  return (
    <div className={styles.screen}>
      <div className={styles.panel} style={{ marginBottom: 16 }}>
        <h2>Reports</h2>
        <p className={styles.subtitle} style={{ marginBottom: 4 }}>
          Quick Journal・Issue進捗・組織の変更イベントを週次/月次で集計したスナップショットです。生成済みのレポートは消えず、いつでも振り返れます。
        </p>
        <p className={styles.subtitle} style={{ marginBottom: 12 }}>
          🗓 週次・月次の儀式でOK。毎日見る必要はありません。
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <button className={styles.primaryBtn} style={{ width: "auto" }} disabled={generating !== null} onClick={() => handleGenerate("week")}>
            {generating === "week" ? "生成中…" : "今週のレポートを作成"}
          </button>
          <button className={styles.primaryBtn} style={{ width: "auto" }} disabled={generating !== null} onClick={() => handleGenerate("month")}>
            {generating === "month" ? "生成中…" : "今月のレポートを作成"}
          </button>
        </div>
        {generateError && <p className={styles.errorText}>{generateError}</p>}
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
        種別で絞り込み:
        <select value={periodFilter} onChange={(e) => setPeriodFilter(e.target.value as ReportPeriodType | "")}>
          <option value="">すべて</option>
          <option value="week">週次</option>
          <option value="month">月次</option>
        </select>
      </label>

      {reports.length === 0 ? (
        <p className={styles.subtitle}>まだレポートがありません。上のボタンから作成してください。</p>
      ) : (
        pagination.pageItems.map((report) => <ReportCard key={report.id} report={report} onSaveNote={handleSaveNote} />)
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
  );
}
