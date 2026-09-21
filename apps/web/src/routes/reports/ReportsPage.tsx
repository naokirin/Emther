import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import styles from "../../styles/page.module.css";
import { PaginationControls } from "../../components/Pagination";
import { usePagination } from "../../components/usePagination";
import { Select } from "../../components/Select";
import { JournalSuggestionTrendChart, PeriodNavigator } from "../../components/DailyTrendChart";
import { usePeriodNavigator } from "../../components/usePeriodNavigator";
import { PageTitleRow } from "../../components/HelpLink";
import type { AgentRun } from "../../components/RunDetail";
import { PeriodReviewBlock } from "../../components/run-detail/PeriodReviewBlock";
import { buildJournalSuggestionDailyTrend } from "@emther/core/daily-trends";
import { reportsQueryKey, useJournal, useReports, useRuns, useSuggestions } from "../../lib/queries";
import { REPORT_PERIOD_LABEL, type Report, type ReportPeriodType } from "@emther/core/types";

// web/src/app/reports/page.tsx（Next.js版）からの移植（フェーズ3.5 tier3）。
// stylesのimportパス・`@core/*`のbare specifier化以外はロジックを変更していないが、
// `useReports`の旧`setReports`（楽観的ローカル更新）はフェーズ3.2の方針どおり
// `queryClient.setQueryData`に置き換えた。
const PAGE_SIZE = 5;

function formatDateTime(ts: number): string {
  return new Date(ts).toLocaleString("ja-JP", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ユーザー指摘「『週次レビューをする』を実行しても結果が表示されず、レポート一覧を見ても
// AIの分析結果やそこへのリンクが出ない」対応。実行直後にスクロール不要で見える場所
// （ボタン列のすぐ下）に直近のレビューを表示し（後述のReviewSpotlight）、かつ一覧の各行にも
// レビューの有無・状態を常時見えるバッジとして出す（後述のReviewStatusBadge）。
function reviewStatusLabel(run: AgentRun): { icon: string; label: string } {
  if (run.status === "idle" && run.periodReview) return { icon: "🤖", label: "AIレビュー完了" };
  if (run.status === "error") return { icon: "⚠️", label: "AIレビュー エラー" };
  return { icon: "🤖", label: "AIレビュー 検討中…" };
}

function ReviewStatusBadge({ reviewRun }: { reviewRun: AgentRun | undefined }) {
  if (!reviewRun) return null;
  const { icon, label } = reviewStatusLabel(reviewRun);
  return (
    <span className={styles.badge} style={{ marginLeft: 6 }}>
      {icon} {label}
    </span>
  );
}

// docs/new_reporting.md。週次・月次「レビュー」機能。統計スナップショット（Report）に紐づく
// Lead Agent run（AgentRun.sourceReportId）があれば、AIの概観・解釈・Before/After・見落としの
// 問い・学び・次期間への問いをこのカード内に表示する。起動は上部の「AIとレビューする」ボタン
// （新しい暦週/暦月のReportを生成しつつ起動する）でのみ行い、ここは表示専用。会話継続・
// テーマ採用/却下は自前実装せず、同じrunを開ける/chatへリンクする
// （ConsultReviewPanelが既に持つ機能をそのまま使う）。
function ReportReviewSection({ reviewRun }: { reviewRun: AgentRun | undefined }) {
  if (!reviewRun) return null;

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed var(--border)" }}>
      <strong style={{ fontSize: "0.9rem" }}>AIレビュー</strong>
      {reviewRun.status === "idle" && reviewRun.periodReview ? (
        <div className={styles.reportReviewBody} style={{ marginTop: 6 }}>
          <PeriodReviewBlock review={reviewRun.periodReview} />
        </div>
      ) : reviewRun.status === "error" ? (
        <p className={styles.errorText} style={{ marginTop: 6 }}>
          エラーで終了しました。
        </p>
      ) : (
        <p className={styles.subtitle} style={{ marginTop: 6 }}>
          AIが検討中です…
        </p>
      )}
      <Link to={`/chat?runId=${encodeURIComponent(reviewRun.id)}`} className={styles.btnOutline} style={{ marginTop: 8, display: "inline-block" }}>
        この提案について会話する →
      </Link>
    </div>
  );
}

// ユーザー要望「今週・先週…と個別に並ぶと野暮ったい。ボタンを押すとプルダウンで
// 今週/先週などの選択が表示されるようにまとめたい」対応。レポート作成・AIレビューの
// 週次/月次それぞれで「今週or先週」のどちらを対象にするかだけが違う4アクションを、
// 1つのボタン（Selectを流用したドロップダウン。押すまで選択肢は隠れている）にまとめる。
// valueを持たせず常にplaceholder表示のままにすることで、Selectを「値を保持する入力欄」
// ではなく「押すたびに選ぶ使い捨てのアクションメニュー」として使う。
function PeriodActionMenu({
  periodType,
  idleLabel,
  busyLabel,
  busy,
  disabled,
  onPick,
}: {
  periodType: ReportPeriodType;
  idleLabel: string;
  busyLabel: string;
  busy: boolean;
  disabled: boolean;
  onPick: (offset: number) => void;
}) {
  const options =
    periodType === "week"
      ? [{ value: "0", label: "今週" }, { value: "1", label: "先週" }]
      : [{ value: "0", label: "今月" }, { value: "1", label: "先月" }];
  return (
    <Select
      value=""
      onChange={(v) => onPick(Number(v))}
      options={options}
      placeholder={busy ? busyLabel : idleLabel}
      // role="combobox"は「内容からの名前付け」の対象外のため、Selectのlabel（aria-label）で
      // 明示する。表示テキスト（placeholder）は起動中の状態表示も兼ねて変わるが、
      // アクセシブルネームはアクション自体を指す固定文言にする。
      label={idleLabel}
      disabled={disabled}
      style={{ width: "auto", minWidth: 220 }}
    />
  );
}

function ReportCard({
  report,
  reviewRun,
  onSaveNote,
}: {
  report: Report;
  reviewRun: AgentRun | undefined;
  onSaveNote: (id: string, note: string) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [note, setNote] = useState(report.note);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
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

  const { journal, suggestions, events } = report.stats;

  return (
    <>
      <tr>
        <td>
          <span className={styles.badge}>{REPORT_PERIOD_LABEL[report.periodType]}</span>
          <ReviewStatusBadge reviewRun={reviewRun} />
        </td>
        <td>
          <strong>
            {formatDateTime(report.periodStart)} 〜 {formatDateTime(report.periodEnd)}
          </strong>
          <div className={styles.tableMuted} style={{ marginTop: 4 }}>
            Journal {journal.total}件（高緊急度 {journal.byUrgency.high}件 / ネガティブ {journal.bySentiment.negative}件） ・ 提案の作成{" "}
            {suggestions.createdCount}件 / 確認済み {suggestions.archivedCount}件 ・ 組織の変更イベント {events.total}件
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
                  期間中に作成: {suggestions.createdCount}件 / 確認済み（もう追わない）: {suggestions.archivedCount}件
                </div>
                {suggestions.createdTitles.length > 0 && (
                  <div style={{ marginTop: 4 }}>作成: {suggestions.createdTitles.map((s) => s.title).join(" / ")}</div>
                )}
                {suggestions.archivedTitles.length > 0 && (
                  <div style={{ marginTop: 4 }}>確認済み: {suggestions.archivedTitles.map((s) => s.title).join(" / ")}</div>
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

              <ReportReviewSection reviewRun={reviewRun} />

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

export function ReportsPage() {
  const [periodFilter, setPeriodFilter] = useState<ReportPeriodType | "">("");
  const { reports, reportsLoaded, refreshReports } = useReports(periodFilter);
  const { runs, refreshRuns } = useRuns();
  const queryClient = useQueryClient();
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  // ユーザー指摘「『週次レビューをする』を実行しても結果が表示されず、一覧を見てもAIの
  // 分析結果やリンクが出ない」対応。POSTのレスポンスで返ってきたReportをそのまま直近レビューの
  // 対象として保持する（種別フィルタで一覧から外れていても見失わない）。runの方はuseRuns()の
  // ポーリングで常に最新状態を取るため、こちらはIDから毎回引き直す。
  const [triggeredSpotlightReport, setTriggeredSpotlightReport] = useState<Report | null>(null);
  const spotlightSectionRef = useRef<HTMLDivElement | null>(null);

  // 改修依頼「日毎の変化をグラフで見たい」対応。生成済みレポート（週次/月次スナップショット）
  // とは別に、生きたJournal/提案の全件から日次の推移を都度集計して見せる。
  const { journalEntries } = useJournal();
  const { suggestions } = useSuggestions();
  const trendNav = usePeriodNavigator("month");
  const trendPoints = buildJournalSuggestionDailyTrend(journalEntries, suggestions, trendNav.window);

  // トリガー直後のReportが無ければ、一覧の中でAIレビューが紐づく最新のものを既定表示にする
  // （ページを開き直したときも「前回のレビューはどうなったか」がすぐ見える）。
  const latestReviewedFromList = [...reports]
    .map((r) => ({ report: r, run: runs.find((run) => run.sourceReportId === r.id) }))
    .filter((x): x is { report: Report; run: AgentRun } => !!x.run)
    .sort((a, b) => b.run.createdAt - a.run.createdAt)[0];
  const spotlightReport = triggeredSpotlightReport ?? latestReviewedFromList?.report ?? null;
  const spotlightRun = spotlightReport ? runs.find((r) => r.sourceReportId === spotlightReport.id) : undefined;

  useEffect(() => {
    if (!triggeredSpotlightReport) return;
    // jsdom（テスト環境）にはscrollIntoViewが実装されていないため存在チェックする（Select.tsxと同じ対応）。
    spotlightSectionRef.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggeredSpotlightReport?.id]);

  // ユーザー指摘「『レポートを作成する』と『レビューをする』の違いが分かりにくい」対応。
  // 機械集計のみの生成ボタンは廃止し、暦週/暦月の統計スナップショット生成とLead Agentに
  // よる対話型レビューの起動を1つの入口（レビューをする）に一本化する。統計スナップショット
  // 自体はstartPeriodReviewAnalysis内部で生成されるため、レポート一覧・履歴は従来どおり残る。
  async function handleStartReview(periodType: ReportPeriodType, offset = 0) {
    setReviewing(`${periodType}-${offset}`);
    setReviewError(null);
    try {
      const res = await fetch("/api/reports/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodType, offset }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "レビューの起動に失敗しました");
      setTriggeredSpotlightReport(data.report);
      await Promise.all([refreshReports(), refreshRuns()]);
    } catch (err) {
      setReviewError((err as Error).message);
    } finally {
      setReviewing(null);
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
      queryClient.setQueryData<{ reports: Report[] }>(reportsQueryKey(periodFilter), (prev) => ({
        reports: (prev?.reports ?? reports).map((r) => (r.id === id ? data.report : r)),
      }));
    }
  }

  const pagination = usePagination(reports, PAGE_SIZE);

  return (
    <div className={styles.screen}>
      <div>
        <PageTitleRow title="レポート" helpAnchor="reflection">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <PeriodActionMenu
              periodType="week"
              idleLabel="🤖 週次レビューをする"
              busyLabel="起動中…"
              busy={reviewing?.startsWith("week-") ?? false}
              disabled={reviewing !== null}
              onPick={(offset) => handleStartReview("week", offset)}
            />
            <PeriodActionMenu
              periodType="month"
              idleLabel="🤖 月次レビューをする"
              busyLabel="起動中…"
              busy={reviewing?.startsWith("month-") ?? false}
              disabled={reviewing !== null}
              onPick={(offset) => handleStartReview("month", offset)}
            />
          </div>
        </PageTitleRow>
        {reviewError && <p className={styles.errorText} role="alert" style={{ marginTop: 4 }}>{reviewError}</p>}
      </div>

      {spotlightReport && (
        <div className={`${styles.panel} ${styles.reportReviewHero}`} ref={spotlightSectionRef}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <h2 style={{ margin: 0, fontSize: "1.25rem" }}>直近のAIレビュー</h2>
            <div>
              <span className={styles.badge}>{REPORT_PERIOD_LABEL[spotlightReport.periodType]}</span>
              <ReviewStatusBadge reviewRun={spotlightRun} />
            </div>
          </div>
          <p className={styles.subtitle} style={{ marginTop: 4 }}>
            {formatDateTime(spotlightReport.periodStart)} 〜 {formatDateTime(spotlightReport.periodEnd)}
          </p>
          <ReportReviewSection reviewRun={spotlightRun} />
        </div>
      )}

      <div className={styles.panel}>
        <h2>日次の推移</h2>
        <div style={{ marginBottom: 10 }}>
          <PeriodNavigator state={trendNav} />
        </div>
        <JournalSuggestionTrendChart points={trendPoints} />
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
                <ReportCard
                  key={report.id}
                  report={report}
                  reviewRun={runs.find((r) => r.sourceReportId === report.id)}
                  onSaveNote={handleSaveNote}
                />
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
