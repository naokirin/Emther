"use client";

import { useState } from "react";
import styles from "@/app/page.module.css";
import { PaginationControls, usePagination } from "@/components/Pagination";
import { Select } from "@/components/Select";
import { JournalIssueTrendChart, PeriodNavigator, usePeriodNavigator } from "@/components/DailyTrendChart";
import { PageTitleRow } from "@/components/HelpLink";
import { buildJournalIssueDailyTrend } from "@/lib/daily-trends";
import { useIssues, useJournal, useReports } from "@/lib/hooks";
import { REPORT_PERIOD_LABEL, type Report, type ReportPeriodType } from "@core/types";

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
  // SettingsのisDirtyと同じ。未変更のまま保存できて「保存されたかわからない」状態に
  // ならないよう、サーバー最新値とドラフトを比較する。
  const noteDirty = note !== report.note;

  async function handleSave() {
    if (!noteDirty) return;
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
    <>
      <tr>
        <td>
          <span className={styles.badge}>{REPORT_PERIOD_LABEL[report.periodType]}</span>
        </td>
        <td>
          <strong>
            {formatDateTime(report.periodStart)} 〜 {formatDateTime(report.periodEnd)}
          </strong>
          <div className={styles.tableMuted} style={{ marginTop: 4 }}>
            Journal {journal.total}件（高緊急度 {journal.byUrgency.high}件 / ネガティブ {journal.bySentiment.negative}件） ・ 提案の作成{" "}
            {issues.createdCount}件 / 確認済み {issues.archivedCount}件 ・ 組織の変更イベント {events.total}件
          </div>
        </td>
        <td>
          <button className={`${styles.detailToggle} ${styles.detailToggleButton}`} onClick={() => setExpanded(!expanded)}>
            {expanded ? "閉じる" : "詳細を見る"}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={3}>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: "0.75rem" }}>
              <div>
                <strong>Quick Journal</strong>
                <div className={styles.subtitle}>
                  件数: {journal.total} / Urgency（low {journal.byUrgency.low} · mid {journal.byUrgency.mid} · high{" "}
                  {journal.byUrgency.high}） / 感情（positive {journal.bySentiment.positive} · neutral {journal.bySentiment.neutral} ·
                  negative {journal.bySentiment.negative}）
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
                <strong>提案（作成・確認済み）</strong>
                <div className={styles.subtitle}>
                  期間中に作成: {issues.createdCount}件 / 確認済み（もう追わない）: {issues.archivedCount}件
                </div>
                {issues.createdTitles.length > 0 && <div style={{ marginTop: 4 }}>作成: {issues.createdTitles.map((i) => i.title).join(" / ")}</div>}
                {issues.archivedTitles.length > 0 && (
                  <div style={{ marginTop: 4 }}>確認済み: {issues.archivedTitles.map((i) => i.title).join(" / ")}</div>
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
                <label>
                  EMの所感・コメント
                  <textarea
                    rows={2}
                    value={note}
                    onChange={(e) => {
                      setNote(e.target.value);
                      setSaved(false);
                    }}
                    placeholder="このレポートを見て感じたこと・次にやることなど"
                  />
                </label>
                <button
                  className={styles.btnOutline}
                  style={{ marginTop: 6 }}
                  disabled={saving || !noteDirty}
                  onClick={handleSave}
                >
                  {saving ? "保存中…" : noteDirty ? "コメントを保存" : "保存済み"}
                </button>
                {!noteDirty && saved && (
                  <span className={styles.subtitle} style={{ marginLeft: 8 }} role="status">
                    ✅ 保存しました
                  </span>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function ReportsPage() {
  const [periodFilter, setPeriodFilter] = useState<ReportPeriodType | "">("");
  const { reports, setReports, reportsLoaded, refreshReports } = useReports(periodFilter);
  const [generating, setGenerating] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);

  // 改修依頼「日毎の変化をグラフで見たい」対応。生成済みレポート（週次/月次スナップショット）
  // とは別に、生きたJournal/Issueの全件から日次の推移を都度集計して見せる。
  const { journalEntries } = useJournal();
  const { issues } = useIssues();
  const trendNav = usePeriodNavigator("month");
  const trendPoints = buildJournalIssueDailyTrend(journalEntries, issues, trendNav.window);

  // 改修依頼「自動で先週分・先月分のレポートを作ってほしい」対応。自動化はせず、
  // 既存の「今すぐ生成」と同じ手動ボタンで、対象期間を1つ前（先週・先月）にずらせるようにする。
  async function handleGenerate(periodType: ReportPeriodType, periodsAgo = 0) {
    setGenerating(`${periodType}-${periodsAgo}`);
    setGenerateError(null);
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodType, periodsAgo }),
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
      <div>
        <PageTitleRow title="レポート" helpAnchor="reflection">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className={styles.primaryBtn} style={{ width: "auto" }} disabled={generating !== null} onClick={() => handleGenerate("week")}>
              {generating === "week-0" ? "生成中…" : "今週のレポートを作成"}
            </button>
            <button className={styles.btnOutline} disabled={generating !== null} onClick={() => handleGenerate("week", 1)}>
              {generating === "week-1" ? "生成中…" : "先週のレポートを作成"}
            </button>
            <button className={styles.primaryBtn} style={{ width: "auto" }} disabled={generating !== null} onClick={() => handleGenerate("month")}>
              {generating === "month-0" ? "生成中…" : "今月のレポートを作成"}
            </button>
            <button className={styles.btnOutline} disabled={generating !== null} onClick={() => handleGenerate("month", 1)}>
              {generating === "month-1" ? "生成中…" : "先月のレポートを作成"}
            </button>
          </div>
        </PageTitleRow>
        {generateError && <p className={styles.errorText} role="alert" style={{ marginTop: 4 }}>{generateError}</p>}
      </div>

      <div className={styles.panel}>
        <h2>日次の推移</h2>
        <div style={{ marginBottom: 10 }}>
          <PeriodNavigator state={trendNav} />
        </div>
        <JournalIssueTrendChart points={trendPoints} />
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.875rem", color: "var(--text-muted)", marginBottom: 10 }}>
        種別で絞り込み:
        <Select
          value={periodFilter}
          onChange={(v) => setPeriodFilter(v as ReportPeriodType | "")}
          options={[
            { value: "", label: "すべて" },
            { value: "week", label: "週次" },
            { value: "month", label: "月次" },
          ]}
          style={{ minWidth: 120 }}
        />
      </label>

      {reports.length === 0 ? (
        <p className={styles.subtitle}>
          {!reportsLoaded ? "読み込み中…" : "まだレポートがありません。上のボタンから作成してください。"}
        </p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>種別</th>
                <th>期間 / サマリー</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pagination.pageItems.map((report) => (
                <ReportCard key={report.id} report={report} onSaveNote={handleSaveNote} />
              ))}
            </tbody>
          </table>
        </div>
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
