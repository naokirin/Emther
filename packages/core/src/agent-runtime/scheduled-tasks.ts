import { getDb } from "../db";
import { periodWindow } from "../daily-trends";
import { getDataDir, loadJSON, saveJSON } from "../persistence";
import { getSuggestion } from "../suggestion-store";
import { isUnconfirmedNameCandidatesError, type MaskOptions } from "../name-candidate-confirmation";
import { unmaskNames } from "../people-directory";
import { generateReportForWindow, type Report } from "../report-store";
import { getRulesAndConstraints, normalizeHourList, normalizeWeekdayList } from "../settings-store";
import {
  loadJournalBatchPersisted,
  saveJournalBatchPersisted,
} from "./journal-batch-window";
import { decideRun, parkPendingUnmaskedSend, startRun } from "./run-actions";
import { checkStaleRuns, persistRunMeta, runs, WATCHDOG_INTERVAL_MS } from "./store";
import type { AgentRun, PendingAgentStart } from "./types";

// docs/first_implession 3.6「トリガー（起動条件）: バッチ駆動（朝のサマリー）」対応。
// 専用のジョブスケジューラは導入せず、既存のwatchdog間隔に相乗りする軽量な実装。
//
// 二重起動ガードは次の4層（朝サマリー・週次蒸留・週次Grow・Journal集約の全4種で共通の考え方）:
// 1) globalThis 上のクレーム（同一プロセス内の HMR でも共有）
// 2) auto-morning-summary.json 等の永続化（プロセス再起動後）
// 3) 当日/当該週の origin run が DB/メモリに既にあれば起動しない
// 4) auto_batch_claims テーブルへの原子的 INSERT（起動直前の最終防波堤）
//
// (1) だけだと next dev の HMR でモジュール変数がリセットされ、かつ setInterval が
// クリアされずに積み上がると、指定時刻直後に複数 tick がほぼ同時に走りレースする
// （実機: 2026-09-11 07:00 に約3秒で9件）。ファイル永続化だけでは「全員が未クレームを
// 読んでから書く」レースを止められないため、globalThis 単一化 + 既存 run の有無確認が必要。
// さらに、docs/2nd_architecture/plan.md フェーズ2（Hono並走）でNext↔Honoの2プロセスが
// 同じデータディレクトリを見る構成になると、(1)〜(3)は全て「読み取り→（別プロセスの
// 書き込みを跨がず）書き込み」という同一プロセス内の同期実行を前提にしており、
// 複数OSプロセス間のTOCTOUは防げない（2026-09-19、2プロセスを実機起動して実際に
// 重複起動を再現・確認済み）。(4)のSQLite UNIQUE制約INSERTはOSのファイルロックで
// プロセスをまたいで直列化されるため、これが唯一プロセス境界をまたいで安全な層。
function loadLastAutoMorningSummaryDate(): string | null {
  return loadJSON<{ date: string | null }>("auto-morning-summary.json", { date: null }).date;
}

function saveLastAutoMorningSummaryDate(date: string): void {
  saveJSON("auto-morning-summary.json", { date });
}

/**
 * 自動バッチ起動の直前に呼ぶ、プロセス境界をまたいで安全な最終クレーム。
 * SQLiteのPRIMARY KEY制約により、同じclaimKeyへのINSERTは（他プロセスからの
 * ものも含めて）最初の1件しか成功しない。trueを返した呼び出し元だけが実際に
 * start*()を呼んでよい。
 */
function tryClaimAutoBatchSlot(claimKey: string): boolean {
  try {
    getDb().prepare("INSERT INTO auto_batch_claims (claim_key, claimed_at) VALUES (?, ?)").run(claimKey, Date.now());
    return true;
  } catch {
    return false;
  }
}

export function todayDateString(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** ローカル暦日 YYYY-MM-DD の [start, end) ミリ秒（サーバーローカル TZ）。 */
export function localDayBoundsMs(date: string): { start: number; end: number } {
  const [y, m, d] = date.split("-").map(Number);
  const start = new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
  return { start, end: start + 24 * 60 * 60 * 1000 };
}

function hasOriginRunOnLocalDate(origin: AgentRun["origin"], date: string): boolean {
  const { start, end } = localDayBoundsMs(date);
  for (const run of runs.values()) {
    if (run.origin === origin && run.createdAt >= start && run.createdAt < end) return true;
  }
  const row = getDb()
    .prepare("SELECT 1 AS ok FROM agent_runs WHERE origin = ? AND created_at >= ? AND created_at < ? LIMIT 1")
    .get(origin, start, end) as { ok: number } | undefined;
  return !!row;
}

/** 指定ローカル日における origin run の最古 createdAt の「時」（0〜23）。無ければ null。 */
function earliestOriginRunLocalHour(origin: AgentRun["origin"], date: string): number | null {
  const { start, end } = localDayBoundsMs(date);
  let earliest: number | null = null;
  for (const run of runs.values()) {
    if (run.origin !== origin || run.createdAt < start || run.createdAt >= end) continue;
    if (earliest == null || run.createdAt < earliest) earliest = run.createdAt;
  }
  const row = getDb()
    .prepare(
      "SELECT MIN(created_at) AS t FROM agent_runs WHERE origin = ? AND created_at >= ? AND created_at < ?",
    )
    .get(origin, start, end) as { t: number | null } | undefined;
  if (typeof row?.t === "number" && Number.isFinite(row.t)) {
    if (earliest == null || row.t < earliest) earliest = row.t;
  }
  if (earliest == null) return null;
  return new Date(earliest).getHours();
}

function hasOriginRunInIsoWeek(origin: AgentRun["origin"], week: string): boolean {
  for (const run of runs.values()) {
    if (run.origin === origin && isoWeekKey(new Date(run.createdAt)) === week) return true;
  }
  // 週境界の厳密スキャンは重いので、直近14日の DB 行だけ見て判定する。
  const since = Date.now() - 14 * 24 * 60 * 60 * 1000;
  const rows = getDb()
    .prepare("SELECT created_at FROM agent_runs WHERE origin = ? AND created_at >= ?")
    .all(origin, since) as Array<{ created_at: number }>;
  return rows.some((r) => isoWeekKey(new Date(r.created_at)) === week);
}

export function checkMorningSummary(): void {
  const { autoMorningSummaryEnabled, autoMorningSummaryHour } = getRulesAndConstraints();
  if (!autoMorningSummaryEnabled) return;
  const now = new Date();
  if (now.getHours() < autoMorningSummaryHour) return;
  const today = todayDateString(now);
  const guard = getAutoBatchGuardState();
  if (guard.lastAutoMorningSummaryDate === today) return;
  // ディスク／既存 run を再同期（HMR 前インスタンスや他経路が既にクレーム済みの場合）。
  if (loadLastAutoMorningSummaryDate() === today || hasOriginRunOnLocalDate("auto-summary", today)) {
    guard.lastAutoMorningSummaryDate = today;
    saveLastAutoMorningSummaryDate(today);
    return;
  }
  // 先にクレームしてから startRun（並行 tick が同じ窓に入っても2件目は上のガードで弾く）。
  guard.lastAutoMorningSummaryDate = today;
  saveLastAutoMorningSummaryDate(today);
  // 複数プロセス（Next↔Hono並走等）が同時にここへ到達した場合の最終防波堤。
  if (!tryClaimAutoBatchSlot(`auto-summary:${today}`)) return;
  void startRun("Lead Agent", MORNING_SUMMARY_TASK, "auto-summary").catch(() => {
    // 自動サマリーの起動失敗は無視する（次のwatchdog tickで日付が変わらない限り再試行はしない）。
  });
}

/** 相談履歴・Inboxに載せる短いタスク文。材料の本体は buildMorningSummaryContextBlock（context-blocks.ts）へ。 */
export const MORNING_SUMMARY_TASK =
  "朝のサマリーを作成してください。Team Vitals・1on1 Coverage・判断待ち(Yield)やエラーのAgent Run・未確認・確認保留の提案など、今日EMがまず確認すべきことを簡潔に整理してください。";

// ユーザー要望「提案はJournal1回ごとに毎回検討するのではなく、Journalが一定溜まったり
// 朝のサマリーのタイミングなど、ある程度の期間における複数のJournalをまとめて観測・
// 解釈した結果から行うのが良い」対応。以前あったJournal校正のたびの即時個別分析
// （イベント駆動）は廃止し、朝のサマリーと同様のバッチ駆動へ一本化した。
// EMが能動的に「相談」したときの個別分析（POST /api/journal/[id]/analyze・
// requestJournalAnalysis）は、これとは別の経路としてそのまま残す。
// 起動スロットは1日複数時刻可。材料の漏れ防止は lastCoveredAt ウォーターマーク
// （journal-batch-window.ts）。

export function checkJournalBatchReview(): void {
  const { autoJournalBatchEnabled, autoJournalBatchHours } = getRulesAndConstraints();
  if (!autoJournalBatchEnabled) return;
  const hours = normalizeHourList(autoJournalBatchHours);
  const now = new Date();
  const currentHour = now.getHours();
  const dueHours = hours.filter((h) => h <= currentHour);
  if (dueHours.length === 0) return;

  const today = todayDateString(now);
  const guard = getAutoBatchGuardState();
  const persisted = loadJournalBatchPersisted();
  let claimed = [
    ...new Set([
      ...(guard.lastAutoJournalBatchDate === today ? guard.lastAutoJournalBatchClaimedHours : []),
      ...(persisted.date === today ? persisted.claimedHours : []),
    ]),
  ];

  // 旧形式 { date } のみ、または過去バグで全日クレームされた状態から復元する。
  // 当日の既存 auto-journal-batch の最古時刻以前の設定スロットだけを消化済みにし、
  // 後続スロット（例: 7時実行後の 12・17時）は開けたままにする。
  const legacyFullClaim = claimed.length >= 24;
  if ((persisted.legacyDateOnly && persisted.date === today) || legacyFullClaim) {
    const runHour = earliestOriginRunLocalHour("auto-journal-batch", today);
    claimed = runHour != null ? hours.filter((h) => h <= runHour) : [];
    guard.lastAutoJournalBatchDate = today;
    guard.lastAutoJournalBatchClaimedHours = claimed;
    saveJournalBatchPersisted({
      date: today,
      claimedHours: claimed,
      lastCoveredAt: persisted.lastCoveredAt,
      activeSinceExclusive: persisted.activeSinceExclusive,
      activeUntil: persisted.activeUntil,
    });
  }

  const unclaimedDue = dueHours.filter((h) => !claimed.includes(h));
  if (unclaimedDue.length === 0) {
    // メモリとディスクを揃える（HMR 後など）。
    if (persisted.date === today && claimed.length > 0) {
      guard.lastAutoJournalBatchDate = today;
      guard.lastAutoJournalBatchClaimedHours = claimed;
    }
    return;
  }

  // 本日の「既に過ぎた設定時刻」をまとめてクレームし、遅れ復帰で連続多重起動しない。
  const newClaimed = [...new Set([...claimed, ...dueHours])].sort((a, b) => a - b);
  guard.lastAutoJournalBatchDate = today;
  guard.lastAutoJournalBatchClaimedHours = newClaimed;
  saveJournalBatchPersisted({
    date: today,
    claimedHours: newClaimed,
    lastCoveredAt: persisted.lastCoveredAt,
    activeSinceExclusive: persisted.activeSinceExclusive,
    activeUntil: persisted.activeUntil,
  });

  // 複数プロセス（Next↔Hono並走等）が同時にここへ到達した場合の最終防波堤。
  // 「今回新たに消化する時刻の集合」単位でクレームする（同日内でも後続スロットは
  // 別キーになるため、複数回の正当な起動は妨げない）。
  if (!tryClaimAutoBatchSlot(`auto-journal-batch:${today}:${unclaimedDue.join(",")}`)) return;
  void startJournalBatchAnalysis().catch(() => {
    // 自動起動失敗は無視する（クレーム済みのため同スロットでは再試行しない）。
  });
}

/** 相談履歴・Inboxに載せる短いタスク文。材料の本体は buildJournalBatchContextBlock（batch-context-blocks.ts）へ。 */
export const JOURNAL_BATCH_TASK =
  "直近のJournalをまとめて解釈してください。ExpandとChallengeを経たうえで、繰り返しや横断の問題があれば提案形式で提案化を検討し、未確定なら watch＋advice にしてください。追跡不要なものは無理に提案化しないでください。";

// ユーザー要望「現場メモ（Journal）ページから、集約解釈を手動実行できるボタンを置きたい」
// 対応。startDistillationAnalysis/startGrowAnalysisと同型のオンデマンド起動ラッパー。
// manual時はEMが明示起動したものとしてreviewed=trueにする。
export async function startJournalBatchAnalysis(
  opts: MaskOptions & { manual?: boolean } = {},
): Promise<AgentRun | undefined> {
  const { manual, ...maskOpts } = opts;
  const task = JOURNAL_BATCH_TASK;
  try {
    const run = await startRun("Lead Agent", task, "auto-journal-batch", undefined, maskOpts);
    if (manual) {
      run.reviewed = true;
      persistRunMeta(run);
    }
    return run;
  } catch (err) {
    if (isUnconfirmedNameCandidatesError(err)) {
      parkPendingUnmaskedSend({
        id: `unmasked-journal-batch:${Date.now()}`,
        kind: "start-run",
        candidates: err.candidates,
        label: "Journal集約解釈の送信確認",
        agentName: "Lead Agent",
        task,
        origin: "auto-journal-batch",
      });
      return undefined;
    }
    throw err;
  }
}

// docs/knowledge_distillation.md。状況蒸留。watchdog へ相乗りし、ISO 週＋曜日スロットで
// 二重起動を防ぐ（複数曜日を選べる）。
type DistillationPersisted = {
  week: string | null;
  claimedWeekdays: number[];
  /**
   * 旧形式 `{ week }` のみから読んだとき true。
   * 単一曜日時代の「今週は1回実行済み」を、全曜日クレームにせず呼び出し側で復元するため。
   */
  legacyWeekOnly?: boolean;
};

function normalizeClaimedWeekdays(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((d): d is number => typeof d === "number" && Number.isFinite(d))
        .map((d) => Math.min(6, Math.max(0, Math.round(d)))),
    ),
  ].sort((a, b) => a - b);
}

function loadDistillationPersisted(): DistillationPersisted {
  const raw = loadJSON<{ week?: string | null; claimedWeekdays?: unknown }>("auto-distillation.json", {});
  const week = typeof raw.week === "string" ? raw.week : null;
  // 旧形式は { week } のみ = 単一曜日時代の「今週は1回実行済み」。
  // 以前は全曜日クレームしていたが、複数曜日移行後に後続スロット（例: 月曜実行後の水曜）が
  // 永久に起動しなくなるため、claimedWeekdays は空のまま返し legacyWeekOnly で合図する。
  const legacyWeekOnly = Boolean(week) && !Array.isArray(raw.claimedWeekdays);
  const claimedWeekdays = Array.isArray(raw.claimedWeekdays) ? normalizeClaimedWeekdays(raw.claimedWeekdays) : [];
  return { week, claimedWeekdays, legacyWeekOnly };
}

function saveDistillationPersisted(state: DistillationPersisted): void {
  saveJSON("auto-distillation.json", {
    week: state.week,
    claimedWeekdays: normalizeClaimedWeekdays(state.claimedWeekdays),
  });
}

/** 指定 ISO 週における origin run が作られたローカル曜日（0=日〜6=土）の集合。 */
function originRunWeekdaysInIsoWeek(origin: AgentRun["origin"], week: string): number[] {
  const days = new Set<number>();
  for (const run of runs.values()) {
    if (run.origin !== origin) continue;
    if (isoWeekKey(new Date(run.createdAt)) !== week) continue;
    days.add(new Date(run.createdAt).getDay());
  }
  // 週境界の厳密スキャンは重いので、直近14日の DB 行だけ見て補完する（hasOriginRunInIsoWeek と同方針）。
  const since = Date.now() - 14 * 24 * 60 * 60 * 1000;
  const rows = getDb()
    .prepare("SELECT created_at FROM agent_runs WHERE origin = ? AND created_at >= ?")
    .all(origin, since) as Array<{ created_at: number }>;
  for (const r of rows) {
    const created = new Date(r.created_at);
    if (isoWeekKey(created) === week) days.add(created.getDay());
  }
  return [...days].sort((a, b) => a - b);
}

/** ローカル日付の ISO 週キー（例: 2026-W37）。週次バッチの二重起動ガードに使う。 */
export function isoWeekKey(now: Date): string {
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

/** 相談履歴・Inboxに載せる短いタスク文。材料の本体は buildDistillationContextBlock（context-blocks.ts）へ。 */
export const DISTILLATION_TASK =
  "直近の組織状況（Journal・未完了の提案・採用済みテーマ）を統括し、より根本の課題のテーマ解釈を蒸留してください。proposalとthemesブロックを出力してください。";

/** @deprecated 互換用。短いタスク文を返す。材料は buildDistillationContextBlock。 */
export function buildDistillationTask(): string {
  return DISTILLATION_TASK;
}

export async function startDistillationAnalysis(
  opts: MaskOptions & { manual?: boolean } = {},
): Promise<AgentRun | undefined> {
  const { manual, ...maskOpts } = opts;
  const task = DISTILLATION_TASK;
  try {
    // 手動も origin は auto-distill（Inboxラベルを揃える）。manual 時は reviewed=true 相当に
    // したいが startRun は origin!==manual で reviewed=false。手動起動は EM が明示起動した
    // ので reviewed=true にする。
    const run = await startRun("Lead Agent", task, "auto-distill", undefined, maskOpts);
    if (manual) {
      run.reviewed = true;
      persistRunMeta(run);
    }
    return run;
  } catch (err) {
    if (isUnconfirmedNameCandidatesError(err)) {
      parkPendingUnmaskedSend({
        id: `unmasked-distill:${Date.now()}`,
        kind: "start-run",
        candidates: err.candidates,
        label: "状況蒸留の送信確認",
        agentName: "Lead Agent",
        task,
        origin: "auto-distill",
      });
      return undefined;
    }
    throw err;
  }
}

// docs/2nd_pivot_version.md Phase 8。pivot_policy.mdの5番目のAI役割「Grow」（EM自身の
// 学びの提示）。週次蒸留と同様に watchdog へ相乗りし、ISO 週キーを永続化して二重起動を防ぐ。
function loadLastAutoGrowWeek(): string | null {
  return loadJSON<{ week: string | null }>("auto-grow.json", { week: null }).week;
}

function saveLastAutoGrowWeek(week: string): void {
  saveJSON("auto-grow.json", { week });
}

/** 相談履歴・Inboxに載せる短いタスク文。材料の本体は buildGrowContextBlock（batch-context-blocks.ts）へ。 */
export const GROWTH_TASK =
  "EM自身の学びの提案を作成してください。組織の観測・解釈とEM自身の振り返り（チェックイン・KPTメモ）を横断し、grow_suggestionsブロックを出力してください。";

export async function startGrowAnalysis(opts: MaskOptions & { manual?: boolean } = {}): Promise<AgentRun | undefined> {
  const { manual, ...maskOpts } = opts;
  const task = GROWTH_TASK;
  try {
    // 手動も origin は auto-grow（Inboxラベルを揃える）。手動起動はEMが明示起動したので
    // reviewed=true にする（状況蒸留のstartDistillationAnalysisと同型）。
    const run = await startRun("Lead Agent", task, "auto-grow", undefined, maskOpts);
    if (manual) {
      run.reviewed = true;
      persistRunMeta(run);
    }
    return run;
  } catch (err) {
    if (isUnconfirmedNameCandidatesError(err)) {
      parkPendingUnmaskedSend({
        id: `unmasked-grow:${Date.now()}`,
        kind: "start-run",
        candidates: err.candidates,
        label: "学びの提案の送信確認",
        agentName: "Lead Agent",
        task,
        origin: "auto-grow",
      });
      return undefined;
    }
    throw err;
  }
}

export function checkWeeklyGrow(): void {
  const { autoGrowEnabled, autoGrowWeekday, autoGrowHour } = getRulesAndConstraints();
  if (!autoGrowEnabled) return;
  const now = new Date();
  if (now.getDay() !== autoGrowWeekday) return;
  if (now.getHours() < autoGrowHour) return;
  const week = isoWeekKey(now);
  const guard = getAutoBatchGuardState();
  if (guard.lastAutoGrowWeek === week) return;
  if (loadLastAutoGrowWeek() === week || hasOriginRunInIsoWeek("auto-grow", week)) {
    guard.lastAutoGrowWeek = week;
    saveLastAutoGrowWeek(week);
    return;
  }
  guard.lastAutoGrowWeek = week;
  saveLastAutoGrowWeek(week);
  // 複数プロセス（Next↔Hono並走等）が同時にここへ到達した場合の最終防波堤。
  if (!tryClaimAutoBatchSlot(`auto-grow:${week}`)) return;
  void startGrowAnalysis().catch(() => {
    // 学びの提案の起動失敗は無視（次週まで再試行しない）。
  });
}

export function checkWeeklyDistillation(): void {
  const { autoDistillationEnabled, autoDistillationWeekdays, autoDistillationHour } = getRulesAndConstraints();
  if (!autoDistillationEnabled) return;
  const weekdays = normalizeWeekdayList(autoDistillationWeekdays);
  const now = new Date();
  const day = now.getDay();
  if (!weekdays.includes(day)) return;
  if (now.getHours() < autoDistillationHour) return;

  const week = isoWeekKey(now);
  const today = todayDateString(now);
  const guard = getAutoBatchGuardState();
  const persisted = loadDistillationPersisted();
  let claimed = [
    ...new Set([
      ...(guard.lastAutoDistillationWeek === week ? guard.lastAutoDistillationClaimedWeekdays : []),
      ...(persisted.week === week ? persisted.claimedWeekdays : []),
    ]),
  ];

  // 旧形式 { week } のみ、または過去バグで全曜日クレームされた状態から復元する。
  // 当該週の既存 auto-distill が作られた曜日だけを消化済みにし、後続曜日は開けたままにする。
  const legacyFullClaim = claimed.length >= 7;
  if ((persisted.legacyWeekOnly && persisted.week === week) || legacyFullClaim) {
    claimed = originRunWeekdaysInIsoWeek("auto-distill", week);
    guard.lastAutoDistillationWeek = week;
    guard.lastAutoDistillationClaimedWeekdays = claimed;
    saveDistillationPersisted({ week, claimedWeekdays: claimed });
  }

  if (claimed.includes(day) || hasOriginRunOnLocalDate("auto-distill", today)) {
    const synced = [...new Set([...claimed, day])].sort((a, b) => a - b);
    guard.lastAutoDistillationWeek = week;
    guard.lastAutoDistillationClaimedWeekdays = synced;
    saveDistillationPersisted({ week, claimedWeekdays: synced });
    return;
  }

  const newClaimed = [...new Set([...claimed, day])].sort((a, b) => a - b);
  guard.lastAutoDistillationWeek = week;
  guard.lastAutoDistillationClaimedWeekdays = newClaimed;
  saveDistillationPersisted({ week, claimedWeekdays: newClaimed });
  // 複数プロセス（Next↔Hono並走等）が同時にここへ到達した場合の最終防波堤。
  if (!tryClaimAutoBatchSlot(`auto-distill:${week}:${day}`)) return;
  void startDistillationAnalysis().catch(() => {
    // 起動失敗は無視（同曜日スロットでは再試行しない）。
  });
}

// docs/new_reporting.md。週次・月次レビュー。状況蒸留・学びの提案と同じくwatchdogへ相乗りし、
// 材料（reports行の統計スナップショット）を先に生成してからLead Agent runを起動する。
// 相談履歴・Inboxに載せる短いタスク文。材料の本体はbuildPeriodReviewContextBlock（batch-context-blocks.ts）へ。
export const WEEKLY_REPORT_TASK =
  "今週のレビューを作成してください。今週のJournal・提案・組織イベントの材料と前週の統計を踏まえ、period_reviewブロックで概観・事実の整理・横断的な解釈・前週比較(Before/After)・見落としていそうな点への問い・学び・来週考えたい問いを出力してください。複数の出来事に共通する繰り返しテーマがあればthemesブロックも添えてください。";

export const MONTHLY_REPORT_TASK =
  "今月のレビューを作成してください。今月のJournal・提案・組織イベント・EM自身の行動（チェックイン・KPTメモ）の材料と先月の統計を踏まえ、period_reviewブロックで概観・事実の整理・横断的な解釈・先月比較(Before/After)・見落としていそうな点への問い・学び・来月考えたい問いを出力してください。複数の出来事に共通する繰り返しテーマがあればthemesブロックも添えてください。";

/**
 * 対象期間（暦週/暦月。offset=0が今期間、1が前期間）の統計スナップショット（reports行）を
 * 生成してから、それを材料とするLead Agent runを起動する。manual時（EMのボタン起動）は
 * 他のバッチ分析と同様reviewed=trueにする。
 */
export async function startPeriodReviewAnalysis(
  unit: "week" | "month",
  offset: number,
  opts: MaskOptions & { manual?: boolean } = {},
): Promise<{ report: Report; run: AgentRun } | undefined> {
  const { manual, ...maskOpts } = opts;
  const origin = unit === "month" ? "auto-monthly-report" : "auto-weekly-report";
  const task = unit === "month" ? MONTHLY_REPORT_TASK : WEEKLY_REPORT_TASK;
  const window = periodWindow(unit, -offset);
  const report = generateReportForWindow(unit, window.start, window.end);
  try {
    const run = await startRun("Lead Agent", task, origin, undefined, maskOpts);
    run.sourceReportId = report.id;
    if (manual) run.reviewed = true;
    persistRunMeta(run);
    return { report, run };
  } catch (err) {
    if (isUnconfirmedNameCandidatesError(err)) {
      parkPendingUnmaskedSend({
        id: `unmasked-period-review:${Date.now()}`,
        kind: "start-run",
        candidates: err.candidates,
        label: unit === "month" ? "月次レビューの送信確認" : "週次レビューの送信確認",
        agentName: "Lead Agent",
        task,
        origin,
      });
      return undefined;
    }
    throw err;
  }
}

function loadLastAutoWeeklyReportWeek(): string | null {
  return loadJSON<{ week: string | null }>("auto-weekly-report.json", { week: null }).week;
}

function saveLastAutoWeeklyReportWeek(week: string): void {
  saveJSON("auto-weekly-report.json", { week });
}

/** ローカル日付の年月キー（例: 2026-09）。月次バッチの二重起動ガードに使う（isoWeekKeyの月版）。 */
export function monthKey(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function loadLastAutoMonthlyReportMonth(): string | null {
  return loadJSON<{ month: string | null }>("auto-monthly-report.json", { month: null }).month;
}

function saveLastAutoMonthlyReportMonth(month: string): void {
  saveJSON("auto-monthly-report.json", { month });
}

function hasOriginRunInMonth(origin: AgentRun["origin"], month: string): boolean {
  for (const run of runs.values()) {
    if (run.origin === origin && monthKey(new Date(run.createdAt)) === month) return true;
  }
  // 月境界の厳密スキャンは重いので、直近40日のDB行だけ見て判定する（hasOriginRunInIsoWeekと同方針）。
  const since = Date.now() - 40 * 24 * 60 * 60 * 1000;
  const rows = getDb()
    .prepare("SELECT created_at FROM agent_runs WHERE origin = ? AND created_at >= ?")
    .all(origin, since) as Array<{ created_at: number }>;
  return rows.some((r) => monthKey(new Date(r.created_at)) === month);
}

export function checkWeeklyReport(): void {
  const { autoWeeklyReportEnabled, autoWeeklyReportWeekday, autoWeeklyReportHour } = getRulesAndConstraints();
  if (!autoWeeklyReportEnabled) return;
  const now = new Date();
  if (now.getDay() !== autoWeeklyReportWeekday) return;
  if (now.getHours() < autoWeeklyReportHour) return;
  const week = isoWeekKey(now);
  const guard = getAutoBatchGuardState();
  if (guard.lastAutoWeeklyReportWeek === week) return;
  if (loadLastAutoWeeklyReportWeek() === week || hasOriginRunInIsoWeek("auto-weekly-report", week)) {
    guard.lastAutoWeeklyReportWeek = week;
    saveLastAutoWeeklyReportWeek(week);
    return;
  }
  guard.lastAutoWeeklyReportWeek = week;
  saveLastAutoWeeklyReportWeek(week);
  // 複数プロセス（Next↔Hono並走等）が同時にここへ到達した場合の最終防波堤。
  if (!tryClaimAutoBatchSlot(`auto-weekly-report:${week}`)) return;
  void startPeriodReviewAnalysis("week", 0).catch(() => {
    // 学びの提案・状況蒸留と同様、起動失敗は無視（次週まで再試行しない）。
  });
}

export function checkMonthlyReport(): void {
  const { autoMonthlyReportEnabled, autoMonthlyReportDay, autoMonthlyReportHour } = getRulesAndConstraints();
  if (!autoMonthlyReportEnabled) return;
  const now = new Date();
  if (now.getDate() !== autoMonthlyReportDay) return;
  if (now.getHours() < autoMonthlyReportHour) return;
  const month = monthKey(now);
  const guard = getAutoBatchGuardState();
  if (guard.lastAutoMonthlyReportMonth === month) return;
  if (loadLastAutoMonthlyReportMonth() === month || hasOriginRunInMonth("auto-monthly-report", month)) {
    guard.lastAutoMonthlyReportMonth = month;
    saveLastAutoMonthlyReportMonth(month);
    return;
  }
  guard.lastAutoMonthlyReportMonth = month;
  saveLastAutoMonthlyReportMonth(month);
  // 複数プロセス（Next↔Hono並走等）が同時にここへ到達した場合の最終防波堤。
  if (!tryClaimAutoBatchSlot(`auto-monthly-report:${month}`)) return;
  void startPeriodReviewAnalysis("month", 0).catch(() => {
    // 起動失敗は無視（翌月の同スロットまで再試行しない）。
  });
}

// 提案のタイトル・整理内容・経過メモの連打保存でコストが爆発しないよう、同一提案は
// デバウンスしてから1回だけ分析する（朝サマリーと同系の軽量実装）。
// デバウンス中は listPendingAgentStarts() でUIへ「あとN秒で起動」を公開する。
export const SUGGESTION_UPDATE_DEBOUNCE_MS = 45_000;

type PendingSuggestionUpdateJob = {
  timer: ReturnType<typeof setTimeout>;
  pending: PendingAgentStart;
};

const pendingSuggestionUpdateJobs = new Map<string, PendingSuggestionUpdateJob>();

// テストからデバウンスを bypass するためのフック（本番は常にデバウンスする）。
let suggestionUpdateDebounceMs = SUGGESTION_UPDATE_DEBOUNCE_MS;
export function setSuggestionUpdateDebounceMsForTest(ms: number): void {
  suggestionUpdateDebounceMs = ms;
}

export function listPendingAgentStarts(): PendingAgentStart[] {
  return [...pendingSuggestionUpdateJobs.values()]
    .map((j) => j.pending)
    .sort((a, b) => a.firesAt - b.firesAt);
}

function scheduleDebouncedSuggestionUpdate(
  suggestionId: string,
  meta: { label: string; suggestionTitle: string; detail: string },
  run: () => void,
): void {
  const existing = pendingSuggestionUpdateJobs.get(suggestionId);
  if (existing) clearTimeout(existing.timer);

  if (suggestionUpdateDebounceMs <= 0) {
    pendingSuggestionUpdateJobs.delete(suggestionId);
    run();
    return;
  }

  const firesAt = Date.now() + suggestionUpdateDebounceMs;
  const pending: PendingAgentStart = {
    id: `suggestion-update:${suggestionId}`,
    kind: "suggestion-update",
    label: meta.label,
    firesAt,
    suggestionId,
    suggestionTitle: meta.suggestionTitle,
    detail: meta.detail,
  };
  const timer = setTimeout(() => {
    pendingSuggestionUpdateJobs.delete(suggestionId);
    run();
  }, suggestionUpdateDebounceMs);
  pendingSuggestionUpdateJobs.set(suggestionId, { timer, pending });
}

function buildSuggestionUpdateTask(
  trigger: "charter" | "log",
  detail: string,
  suggestion: { title: string; memos: { text: string }[] },
): string {
  const recentMemos = suggestion.memos.slice(-5).map((m) => `- ${m.text}`).join("\n");
  const memoBlock = recentMemos ? `最近のメモ:\n${recentMemos}` : "最近のメモ: （なし）";
  if (trigger === "charter") {
    return [
      "提案のタイトル／整理内容が更新されました。最新の内容を踏まえ、チームとして再分析してください。",
      `タイトル: ${suggestion.title}`,
      memoBlock,
      `今回の更新: ${detail}`,
      "不足している観点・リスク・次に確認すべき点があれば提案してください。",
      "判断や介入の実行が必要ならYieldしてください。提案本体の直接変更は提案に留め、EMの確認を待ってください。",
    ].join("\n");
  }
  return [
    "提案にメモが追加されました。進捗・ピボット要否・次に確認すべき点をチームとして判断してください。",
    `タイトル: ${suggestion.title}`,
    memoBlock,
    `追加されたメモ: ${detail}`,
    "判断が必要ならYieldしてください。",
  ].join("\n");
}

async function executeSuggestionUpdateAnalysis(
  suggestionId: string,
  trigger: "charter" | "log",
  detail: string,
): Promise<void> {
  if (!getRulesAndConstraints().autoSuggestionUpdateAnalysisEnabled) return;
  const suggestion = getSuggestion(suggestionId);
  if (!suggestion || suggestion.archivedAt || suggestion.reviewStatus === "done") return;

  const task = buildSuggestionUpdateTask(trigger, detail, suggestion);
  const linkedRun = suggestion.agentRunId ? runs.get(suggestion.agentRunId) : undefined;
  const suggestionTitle = unmaskNames(suggestion.title);

  if (linkedRun) {
    if (linkedRun.status === "active" || linkedRun.status === "queued") {
      // 実行中なら完了後に再試行するよう再度デバウンスする（カウントダウン表示も続く）。
      reactToSuggestionUpdate(suggestionId, trigger, detail);
      return;
    }
    try {
      await decideRun(linkedRun.id, task, {
        teamParallelKickoff: getRulesAndConstraints().teamParallelKickoffEnabled,
      });
    } catch (err) {
      if (isUnconfirmedNameCandidatesError(err)) {
        parkPendingUnmaskedSend({
          id: `unmasked-decide:${linkedRun.id}:${Date.now()}`,
          kind: "decide-run",
          candidates: err.candidates,
          label: "提案の更新分析の送信確認",
          suggestionId,
          suggestionTitle,
          runId: linkedRun.id,
          message: task,
          teamParallelKickoff: getRulesAndConstraints().teamParallelKickoffEnabled,
        });
      }
    }
    return;
  }

  try {
    await startRun("Lead Agent", task, "auto-suggestion-update", suggestionId);
  } catch (err) {
    if (isUnconfirmedNameCandidatesError(err)) {
      parkPendingUnmaskedSend({
        id: `unmasked-start:${suggestionId}:${Date.now()}`,
        kind: "start-run",
        candidates: err.candidates,
        label: "提案の更新分析の送信確認",
        suggestionId,
        suggestionTitle,
        agentName: "Lead Agent",
        task,
        origin: "auto-suggestion-update",
        linkedSuggestionId: suggestionId,
      });
    }
  }
}

// 提案の重要更新（タイトル・メモ）をきっかけにAgentチームを起こす。
// 既定OFF。呼び出し側は失敗しても本体の保存を失敗させない。
export function reactToSuggestionUpdate(
  suggestionId: string,
  trigger: "charter" | "log",
  detail: string,
): void {
  if (!getRulesAndConstraints().autoSuggestionUpdateAnalysisEnabled) return;
  const suggestion = getSuggestion(suggestionId);
  if (!suggestion || suggestion.archivedAt || suggestion.reviewStatus === "done") return;

  const label = trigger === "charter" ? "提案の更新分析（タイトル／整理）" : "提案の更新分析（メモ）";
  scheduleDebouncedSuggestionUpdate(
    suggestionId,
    {
      label,
      suggestionTitle: unmaskNames(suggestion.title),
      detail: trigger === "charter" ? detail : unmaskNames(detail),
    },
    () => {
      void executeSuggestionUpdateAnalysis(suggestionId, trigger, detail).catch(() => {
        // 自動分析の起動失敗で提案更新自体は失敗させない。
      });
    },
  );
}

/** EM明示の手動分析タスク文。本文マーカーは origin-trace と揃える。 */
export function buildJournalAnalysisTask(rawText: string): string {
  return [
    "EMがこのJournalエントリの分析を依頼しました（内容は確認済みです）。内容を確認し、提案として追跡すべき実質的な問題かどうかを判断してください。",
    "ただし、この提案化判定はあくまで一覧に残すかどうかの分類に過ぎません。判定結果がsuggestionでもwatchでもdismissでも、それだけで終わらせず、EMがこの状況にどう向き合うとよいかという実務的な気づき・助言を回答本文に必ず書いてください（判定を言い渡すだけの素っ気ない回答にしないこと）。",
    // docs/3rd_pivot_version/pivot.md, docs/ai_ philosophy.md。EMの問題設定をなぞるだけの提案を避ける。
    "Suggestの前に、システムプロンプト末尾の哲学レンズからLens Selectionし、それを使って Expand（別の解釈・仮説・不足情報・別問題設定）と Challenge（前提・事実と解釈の混同・本当に解くべき問題か）を必ず経てください。入力の要約や言い換えだけで終わらせないこと。",
    "問題だと判断した場合は、通常の提案形式（結論・参照ファクト・expansions・challenges・判断ロジック・棄却した代替案）で示し、結論の中で提案化を検討する旨を明記してください。あわせて proposal の suggestionTitle（単一）または suggestionCandidates（複数・親なしの独立提案）に一覧向きの短い課題名（各40文字以内・「〜と判断します」等は入れない）を付けてください。",
    "内容が別責任・別チーム・別KRになりうる複数の介入を含む場合は、無理に1件へまとめず suggestionCandidates に分けてください（親提案は作らない）。同じ介入の具体作業への分解はここではしないこと。",
    "提案として追跡するほどではないが、様子を見続けたい・追加で確認したい・問題設定をまだ確定できないと判断した場合は、recommendation を \"watch\" にしてください。次に観測・確認すべき点は advice に書いてください（解決策を無理に出さなくてよい）。",
    "単なる一時的な感情の吐露などで追跡も監視も不要と判断した場合は、proposalの recommendation を \"dismiss\" にしてください（無理に提案化を勧めないこと）。この場合も、EMが一声かけるとよいか・様子見でよいかなど、状況への向き合い方には触れてください。提案化すべきなら recommendation は \"suggestion\" です。",
    "",
    `対象のJournalエントリ: "${rawText}"`,
  ].join("\n");
}

// EM明示の手動分析（POST /api/journal/[id]/analyze）。人名未確認はthrowして確認UIへ渡す。
export async function startJournalAnalysis(
  rawText: string,
  journalId?: string,
  opts: MaskOptions & {
    onUnconfirmedNames?: "park" | "throw";
  } = {},
): Promise<AgentRun | undefined> {
  const { onUnconfirmedNames = "park", ...maskOpts } = opts;
  const task = buildJournalAnalysisTask(rawText);
  try {
    return await startRun("Lead Agent", task, "auto-anomaly", undefined, {
      ...maskOpts,
      sourceJournalId: journalId,
    });
  } catch (err) {
    if (isUnconfirmedNameCandidatesError(err) && onUnconfirmedNames === "park") {
      parkPendingUnmaskedSend({
        id: `unmasked-journal:${Date.now()}`,
        kind: "start-run",
        candidates: err.candidates,
        label: "Journal分析の送信確認",
        agentName: "Lead Agent",
        task,
        origin: "auto-anomaly",
        sourceJournalId: journalId,
      });
      return undefined;
    }
    throw err;
  }
}

// watchdog とバッチクレームは globalThis に置き、next dev の HMR でモジュールが
// 再評価されても interval が増殖しない・クレームがリセットされないようにする。
// テストは EM_DATA_DIR を差し替えるので、dataDir が変わったら interval を張り直し、
// クレームもそのディレクトリの JSON から読み直す。
type AutoBatchGuardState = {
  dataDir: string;
  interval: ReturnType<typeof setInterval> | null;
  tick: () => void;
  lastAutoMorningSummaryDate: string | null;
  lastAutoDistillationWeek: string | null;
  lastAutoDistillationClaimedWeekdays: number[];
  lastAutoGrowWeek: string | null;
  lastAutoJournalBatchDate: string | null;
  lastAutoJournalBatchClaimedHours: number[];
  lastAutoWeeklyReportWeek: string | null;
  lastAutoMonthlyReportMonth: string | null;
};

const AUTO_BATCH_GUARD_KEY = Symbol.for("emther.agentRuntime.autoBatchGuard");

function getAutoBatchGuardState(): AutoBatchGuardState {
  const g = globalThis as typeof globalThis & { [AUTO_BATCH_GUARD_KEY]?: AutoBatchGuardState };
  if (!g[AUTO_BATCH_GUARD_KEY]) {
    g[AUTO_BATCH_GUARD_KEY] = {
      dataDir: "",
      interval: null,
      tick: () => {},
      lastAutoMorningSummaryDate: null,
      lastAutoDistillationWeek: null,
      lastAutoDistillationClaimedWeekdays: [],
      lastAutoGrowWeek: null,
      lastAutoJournalBatchDate: null,
      lastAutoJournalBatchClaimedHours: [],
      lastAutoWeeklyReportWeek: null,
      lastAutoMonthlyReportMonth: null,
    };
  }
  return g[AUTO_BATCH_GUARD_KEY];
}

/** テスト用: クレームだけ忘れた状態を再現する（既存 run / ファイルは触らない）。 */
export function clearAutoBatchClaimsForTest(): void {
  const guard = getAutoBatchGuardState();
  guard.lastAutoMorningSummaryDate = null;
  guard.lastAutoDistillationWeek = null;
  guard.lastAutoDistillationClaimedWeekdays = [];
  guard.lastAutoGrowWeek = null;
  guard.lastAutoJournalBatchDate = null;
  guard.lastAutoJournalBatchClaimedHours = [];
  guard.lastAutoWeeklyReportWeek = null;
  guard.lastAutoMonthlyReportMonth = null;
}

function ensureWatchdogStarted(): void {
  const guard = getAutoBatchGuardState();
  const dataDir = getDataDir();
  // 常に最新モジュールの check* を呼ぶ（HMR 後も古いクロージャに閉じない）。
  guard.tick = () => {
    checkStaleRuns();
    checkMorningSummary();
    checkWeeklyDistillation();
    checkWeeklyGrow();
    checkJournalBatchReview();
    checkWeeklyReport();
    checkMonthlyReport();
  };
  if (guard.dataDir !== dataDir) {
    if (guard.interval) {
      clearInterval(guard.interval);
      guard.interval = null;
    }
    guard.dataDir = dataDir;
    guard.lastAutoMorningSummaryDate = loadLastAutoMorningSummaryDate();
    const distill = loadDistillationPersisted();
    guard.lastAutoDistillationWeek = distill.week;
    guard.lastAutoDistillationClaimedWeekdays = distill.claimedWeekdays;
    guard.lastAutoGrowWeek = loadLastAutoGrowWeek();
    const journal = loadJournalBatchPersisted();
    guard.lastAutoJournalBatchDate = journal.date;
    guard.lastAutoJournalBatchClaimedHours = journal.claimedHours;
    guard.lastAutoWeeklyReportWeek = loadLastAutoWeeklyReportWeek();
    guard.lastAutoMonthlyReportMonth = loadLastAutoMonthlyReportMonth();
  }
  if (guard.interval) return;
  guard.interval = setInterval(() => guard.tick(), WATCHDOG_INTERVAL_MS);
}
ensureWatchdogStarted();
