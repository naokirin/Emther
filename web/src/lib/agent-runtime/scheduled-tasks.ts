import { getDb } from "@/lib/db";
import { getDataDir, loadJSON, saveJSON } from "@/lib/persistence";
import { getIssue, listIssues } from "@/lib/issue-store";
import { listJournalEntries } from "@/lib/journal-store";
import { isUnconfirmedNameCandidatesError, type MaskOptions } from "@/lib/name-candidate-confirmation";
import { maskNames, unmaskNames } from "@/lib/people-directory";
import { getRulesAndConstraints, matchesJournalAutoFilters as settingsMatchesJournalAutoFilters } from "@/lib/settings-store";
import { listAdoptedThemes } from "@/lib/theme-store";
import { charterFilledCount } from "@/lib/types";
import { computeOrgVitals } from "@/lib/vitals";
import { decideRun, parkPendingUnmaskedSend, startRun } from "./run-actions";
import { checkStaleRuns, persistRunMeta, runs, WATCHDOG_INTERVAL_MS } from "./store";
import type { AgentRun, PendingAgentStart } from "./types";

// docs/first_implession 3.6「トリガー（起動条件）: バッチ駆動（朝のサマリー）」対応。
// 専用のジョブスケジューラは導入せず、既存のwatchdog間隔に相乗りする軽量な実装。
//
// 二重起動ガードは次の3層:
// 1) globalThis 上のクレーム（同一プロセス内の HMR でも共有）
// 2) auto-morning-summary.json の永続化（プロセス再起動後）
// 3) 当日の origin=auto-summary が DB/メモリに既にあれば起動しない
//
// (1) だけだと next dev の HMR でモジュール変数がリセットされ、かつ setInterval が
// クリアされずに積み上がると、指定時刻直後に複数 tick がほぼ同時に走りレースする
// （実機: 2026-09-11 07:00 に約3秒で9件）。ファイル永続化だけでは「全員が未クレームを
// 読んでから書く」レースを止められないため、globalThis 単一化 + 既存 run の有無確認が必要。
function loadLastAutoMorningSummaryDate(): string | null {
  return loadJSON<{ date: string | null }>("auto-morning-summary.json", { date: null }).date;
}

function saveLastAutoMorningSummaryDate(date: string): void {
  saveJSON("auto-morning-summary.json", { date });
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
  void startRun("Lead Agent", MORNING_SUMMARY_TASK, "auto-summary").catch(() => {
    // 自動サマリーの起動失敗は無視する（次のwatchdog tickで日付が変わらない限り再試行はしない）。
  });
}

/** 相談履歴・Inboxに載せる短いタスク文。材料の本体は buildMorningSummaryContextBlock へ。 */
export const MORNING_SUMMARY_TASK =
  "朝のサマリーを作成してください。Team Vitals・1on1 Coverage・判断待ち(Yield)やエラーのAgent Run・Why/What/Howが未整理のIssueなど、今日EMがまず確認すべきことを簡潔に整理してください。";

const MORNING_YIELD_LIMIT = 15;
const MORNING_ERROR_LIMIT = 10;
const MORNING_CHARTER_ISSUE_LIMIT = 15;

// 朝サマリーの材料は run.task に載せない（巨大 task で相談履歴が壊れる・U13 と同型）。
// origin=auto-summary のときシステムプロンプトへ動的注入する。再開（decideRun）でも
// origin 判定だけで再注入するため、「続けて」だけでは材料が消えない。
export function buildMorningSummaryContextBlock(): string {
  const vitals = computeOrgVitals();
  const issues = listIssues();
  const allRuns = [...runs.values()];

  const omitRun = (run: AgentRun) => {
    if (run.consultedBy) return true;
    if (run.triageStatus === "dismissed") return true;
    return issues.some((i) => i.agentRunId === run.id && i.archived);
  };

  const yieldRuns = allRuns
    .filter((r) => r.status === "yield" && !omitRun(r))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MORNING_YIELD_LIMIT);
  const errorRuns = allRuns
    .filter((r) => r.status === "error" && !omitRun(r))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MORNING_ERROR_LIMIT);
  const unchartered = issues
    .filter((i) => !i.parentId && !i.archived && i.status !== "done" && charterFilledCount(i.charter) < 3)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MORNING_CHARTER_ISSUE_LIMIT);

  const teamLines =
    vitals.teams.length > 0
      ? vitals.teams.map((t) => `- ${t.teamName}: ${t.label}（${t.status}）— ${t.reason}`)
      : ["- （チーム未登録）"];
  const coverage = vitals.oneOnOneCoverage;
  const coverageStatusLabel =
    coverage.status === "good"
      ? "安定"
      : coverage.status === "warn"
        ? "やや注意"
        : coverage.status === "bad"
          ? "要注意"
          : "評価不能";
  const coverageLine = `- 1on1 Coverage: ${coverageStatusLabel}（${coverage.status}） ${coverage.covered}/${coverage.total} — ${coverage.reason}`;

  const yieldLines =
    yieldRuns.length > 0
      ? yieldRuns.map((r) => {
          const reason = r.yieldRequest?.reason?.slice(0, 120) ?? "(理由なし)";
          const kind = r.yieldRequest?.kind ? ` [${r.yieldRequest.kind}]` : "";
          return `- [${r.id}] ${r.agentName}${kind}: ${reason}`;
        })
      : ["- （判断待ちの Yield なし）"];
  const errorLines =
    errorRuns.length > 0
      ? errorRuns.map((r) => `- [${r.id}] ${r.agentName}: ${r.task.slice(0, 100)}`)
      : ["- （エラー状態の Run なし）"];
  const charterLines =
    unchartered.length > 0
      ? unchartered.map((i) => {
          const filled = charterFilledCount(i.charter);
          return `- [${i.id}] ${i.title}（Why/What/How ${filled}/3）`;
        })
      : ["- （Why/What/How 未整理の Issue なし）"];

  return maskNames(
    [
      "朝のサマリーの材料（このタスク専用。下記はシステムが業務データから組み立てたスナップショット。無視して「材料が無い」としないこと）:",
      "今日EMがまず確認・判断すべきことを優先度順に簡潔に整理し、proposalブロックで結論を出してください。",
      "",
      "【Team Vitals】",
      ...teamLines,
      "",
      "【1on1 Coverage】",
      coverageLine,
      "",
      "【判断待ち Yield】",
      ...yieldLines,
      "",
      "【エラーの Agent Run】",
      ...errorLines,
      "",
      "【Why/What/How 未整理の Issue】",
      ...charterLines,
    ].join("\n"),
  );
}

// docs/knowledge_distillation.md。週次の状況蒸留。朝サマリーと同様に watchdog へ相乗りし、
// ISO 週キーを永続化して二重起動を防ぐ。
function loadLastAutoDistillationWeek(): string | null {
  return loadJSON<{ week: string | null }>("auto-distillation.json", { week: null }).week;
}

function saveLastAutoDistillationWeek(week: string): void {
  saveJSON("auto-distillation.json", { week });
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

const DISTILL_JOURNAL_LIMIT = 25;
const DISTILL_ISSUE_LIMIT = 20;

/** 相談履歴・Inboxに載せる短いタスク文。材料の本体は buildDistillationContextBlock へ。 */
export const DISTILLATION_TASK =
  "直近の組織状況（Journal・未完了Issue・採用済みテーマ）を統括し、より根本の課題のテーマ解釈を蒸留してください。proposalとthemesブロックを出力してください。";

// docs/knowledge_distillation.md。蒸留の材料は run.task に載せない（巨大な task だと
// /api/agents 全件取得が重くなり、相談タブの履歴に載らない／開けない不具合の原因になる）。
// origin=auto-distill のときシステムプロンプトへ動的注入する。
export function buildDistillationContextBlock(): string {
  const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const journals = listJournalEntries()
    .filter((e) => e.createdAt >= since)
    .slice(0, DISTILL_JOURNAL_LIMIT);
  const openIssues = listIssues()
    .filter((i) => !i.archived && i.status !== "done")
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, DISTILL_ISSUE_LIMIT);
  const adopted = listAdoptedThemes().slice(0, 10);

  const journalLines =
    journals.length > 0
      ? journals.map((e) => {
          const snippet = (e.summary || e.rawText).slice(0, 160);
          return `- [${e.id}] ${snippet}${e.tags.length ? `（タグ: ${e.tags.join(", ")}）` : ""}`;
        })
      : ["- （直近30日のJournalなし）"];
  const issueLines =
    openIssues.length > 0
      ? openIssues.map((i) => {
          const why = i.charter.why ? ` Why: ${i.charter.why.slice(0, 80)}` : "";
          return `- [${i.id}] ${i.title}${why}`;
        })
      : ["- （未完了のIssueなし）"];
  const themeLines =
    adopted.length > 0
      ? adopted.map((t) => `- ${t.title}: ${t.summary.slice(0, 120)}`)
      : ["- （採用済みテーマなし）"];

  return [
    "状況蒸留の材料（このタスク専用。個別1件対応ではなく、繰り返しや横断から見える上段の解釈を出すこと）:",
    "proposalブロックでは全体の見立て（結論・参照ファクト・判断ロジック・棄却した代替案）を述べてください。",
    "加えて、採用候補となるテーマを themes ブロックで1〜5件出してください（無ければ空配列でも可）。",
    "各テーマには title / summary（根本課題の見立て）/ rationale（なぜこの結果に至ったか）/ facts（根拠）を必須とし、任意で rootCause・suggestedDirection・evidenceJournalIds・evidenceIssueIds（下記一覧のID）を付けてください。",
    "```themes",
    '[{ "title": "…", "summary": "…", "rationale": "…", "facts": ["…"], "rootCause": "…", "suggestedDirection": "…", "evidenceJournalIds": [], "evidenceIssueIds": [] }]',
    "```",
    "",
    "【直近Journal（最大25件）】",
    ...journalLines,
    "",
    "【未完了Issue（最大20件）】",
    ...issueLines,
    "",
    "【既に採用されているテーマ解釈】",
    ...themeLines,
  ].join("\n");
}

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

export function checkWeeklyDistillation(): void {
  const { autoDistillationEnabled, autoDistillationWeekday, autoDistillationHour } = getRulesAndConstraints();
  if (!autoDistillationEnabled) return;
  const now = new Date();
  if (now.getDay() !== autoDistillationWeekday) return;
  if (now.getHours() < autoDistillationHour) return;
  const week = isoWeekKey(now);
  const guard = getAutoBatchGuardState();
  if (guard.lastAutoDistillationWeek === week) return;
  if (loadLastAutoDistillationWeek() === week || hasOriginRunInIsoWeek("auto-distill", week)) {
    guard.lastAutoDistillationWeek = week;
    saveLastAutoDistillationWeek(week);
    return;
  }
  guard.lastAutoDistillationWeek = week;
  saveLastAutoDistillationWeek(week);
  void startDistillationAnalysis().catch(() => {
    // 週次蒸留の起動失敗は無視（次週まで再試行しない）。
  });
}

// Issue Why/What/How・経過ログの連打保存でコストが爆発しないよう、同一Issueは
// デバウンスしてから1回だけ分析する（朝サマリーと同系の軽量実装）。
// デバウンス中は listPendingAgentStarts() でUIへ「あとN秒で起動」を公開する。
export const ISSUE_UPDATE_DEBOUNCE_MS = 45_000;

type PendingIssueUpdateJob = {
  timer: ReturnType<typeof setTimeout>;
  pending: PendingAgentStart;
};

const pendingIssueUpdateJobs = new Map<string, PendingIssueUpdateJob>();

// テストからデバウンスを bypass するためのフック（本番は常にデバウンスする）。
let issueUpdateDebounceMs = ISSUE_UPDATE_DEBOUNCE_MS;
export function setIssueUpdateDebounceMsForTest(ms: number): void {
  issueUpdateDebounceMs = ms;
}

export function listPendingAgentStarts(): PendingAgentStart[] {
  return [...pendingIssueUpdateJobs.values()]
    .map((j) => j.pending)
    .sort((a, b) => a.firesAt - b.firesAt);
}

function scheduleDebouncedIssueUpdate(
  issueId: string,
  meta: { label: string; issueTitle: string; detail: string },
  run: () => void,
): void {
  const existing = pendingIssueUpdateJobs.get(issueId);
  if (existing) clearTimeout(existing.timer);

  if (issueUpdateDebounceMs <= 0) {
    pendingIssueUpdateJobs.delete(issueId);
    run();
    return;
  }

  const firesAt = Date.now() + issueUpdateDebounceMs;
  const pending: PendingAgentStart = {
    id: `issue-update:${issueId}`,
    kind: "issue-update",
    label: meta.label,
    firesAt,
    issueId,
    issueTitle: meta.issueTitle,
    detail: meta.detail,
  };
  const timer = setTimeout(() => {
    pendingIssueUpdateJobs.delete(issueId);
    run();
  }, issueUpdateDebounceMs);
  pendingIssueUpdateJobs.set(issueId, { timer, pending });
}

function buildIssueUpdateTask(
  trigger: "charter" | "log",
  detail: string,
  issue: { title: string; charter: { why?: string; what?: string; how?: string } },
): string {
  const charterLines = [
    issue.charter.why ? `Why（最新）: ${issue.charter.why}` : "",
    issue.charter.what ? `What（最新）: ${issue.charter.what}` : "",
    issue.charter.how ? `How（最新）: ${issue.charter.how}` : "",
  ].filter(Boolean);
  if (trigger === "charter") {
    return [
      "IssueのWhy/What/Howが更新されました。最新の整理内容を踏まえ、チームとして再分析してください。",
      `タイトル: ${issue.title}`,
      ...charterLines,
      `今回更新された項目: ${detail}`,
      "不足している観点・リスク・次の一手（Action Itemsや子Issue分解）があれば提案してください。",
      "判断や介入の実行が必要ならYieldしてください。Issue本体の直接変更は提案に留め、EMの採用を待ってください。",
    ].join("\n");
  }
  return [
    "Issueに経過ログが追加されました。進捗・ピボット要否・次の一手をチームとして判断してください。",
    `タイトル: ${issue.title}`,
    ...charterLines,
    `追加された経過: ${detail}`,
    "必要ならAction Itemsや子Issue分解を提案し、判断が必要ならYieldしてください。",
  ].join("\n");
}

async function executeIssueUpdateAnalysis(
  issueId: string,
  trigger: "charter" | "log",
  detail: string,
): Promise<void> {
  if (!getRulesAndConstraints().autoIssueUpdateAnalysisEnabled) return;
  const issue = getIssue(issueId);
  if (!issue || issue.archived || issue.status === "done") return;

  const task = buildIssueUpdateTask(trigger, detail, issue);
  const linkedRun = issue.agentRunId ? runs.get(issue.agentRunId) : undefined;
  const issueTitle = unmaskNames(issue.title);

  if (linkedRun) {
    if (linkedRun.status === "active" || linkedRun.status === "queued") {
      // 実行中なら完了後に再試行するよう再度デバウンスする（カウントダウン表示も続く）。
      reactToIssueUpdate(issueId, trigger, detail);
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
          label: "課題の更新分析の送信確認",
          issueId,
          issueTitle,
          runId: linkedRun.id,
          message: task,
          teamParallelKickoff: getRulesAndConstraints().teamParallelKickoffEnabled,
        });
      }
    }
    return;
  }

  try {
    await startRun("Lead Agent", task, "auto-issue-update", issueId);
  } catch (err) {
    if (isUnconfirmedNameCandidatesError(err)) {
      parkPendingUnmaskedSend({
        id: `unmasked-start:${issueId}:${Date.now()}`,
        kind: "start-run",
        candidates: err.candidates,
        label: "課題の更新分析の送信確認",
        issueId,
        issueTitle,
        agentName: "Lead Agent",
        task,
        origin: "auto-issue-update",
        linkedIssueId: issueId,
      });
    }
  }
}

// Issueの重要更新（Why/What/How・経過ログ）をきっかけにAgentチームを起こす。
// 既定OFF。呼び出し側（issue-store）は失敗しても本体の保存を失敗させない。
export function reactToIssueUpdate(
  issueId: string,
  trigger: "charter" | "log",
  detail: string,
): void {
  if (!getRulesAndConstraints().autoIssueUpdateAnalysisEnabled) return;
  const issue = getIssue(issueId);
  if (!issue || issue.archived || issue.status === "done") return;

  const label = trigger === "charter" ? "課題の更新分析（Why/What/How）" : "課題の更新分析（経過ログ）";
  scheduleDebouncedIssueUpdate(
    issueId,
    {
      label,
      issueTitle: unmaskNames(issue.title),
      detail: trigger === "charter" ? detail : unmaskNames(detail),
    },
    () => {
      void executeIssueUpdateAnalysis(issueId, trigger, detail).catch(() => {
        // 自動分析の起動失敗でIssue更新自体は失敗させない。
      });
    },
  );
}

export function matchesJournalAutoFilters(
  urgency: "low" | "mid" | "high",
  sentiment: "positive" | "negative" | "neutral",
): boolean {
  return settingsMatchesJournalAutoFilters(urgency, sentiment);
}

/** Journal 自動／手動分析の共通タスク文。本文マーカーは origin-trace と揃える。 */
export function buildJournalAnalysisTask(rawText: string, trigger: "auto" | "manual" = "auto"): string {
  const lead =
    trigger === "manual"
      ? "EMがこのJournalエントリの分析を依頼しました（内容は確認済みです）。内容を確認し、Issueとして追跡すべき実質的な問題かどうかを判断してください。"
      : "Journalに、設定した自動分析条件に合うエントリが追加されました（EMが内容を確認・校正済みです）。内容を確認し、Issueとして追跡すべき実質的な問題かどうかを判断してください。";
  return [
    lead,
    "問題だと判断した場合は、通常の提案形式（結論・参照ファクト・判断ロジック・棄却した代替案）で示し、結論の中でIssue化を検討する旨を明記してください。あわせて proposal の issueTitle（単一）または issueCandidates（複数・親なしの独立Issue）に一覧向きの短い課題名（各40文字以内・「〜と判断します」等は入れない）を付けてください。",
    "内容が別責任・別チーム・別KRになりうる複数の介入を含む場合は、無理に1件へまとめず issueCandidates に分けてください（親Issueは作らない）。同じ介入の具体作業への分解はここではしないこと。",
    "単なる一時的な感情の吐露などで追跡不要と判断した場合は、proposalの recommendation を \"dismiss\" にし、その旨を結論に書いてください（無理にIssue化を勧めないこと）。Issue化すべきなら recommendation は \"issue\" です。",
    "",
    `対象のJournalエントリ: "${rawText}"`,
  ].join("\n");
}

// Journal校正後の自動分析、またはEM明示の手動分析。
// 校正時の自動起動は人名未確認をparkしてJournal保存を止めない。手動APIはthrowして確認UIへ渡す。
export async function startJournalAnalysis(
  rawText: string,
  journalId?: string,
  opts: MaskOptions & {
    trigger?: "auto" | "manual";
    onUnconfirmedNames?: "park" | "throw";
  } = {},
): Promise<AgentRun | undefined> {
  const { trigger = "auto", onUnconfirmedNames = "park", ...maskOpts } = opts;
  const task = buildJournalAnalysisTask(rawText, trigger);
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
        label: "Journal自動分析の送信確認",
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

/** Journal校正後の自動分析。フィルタ（緊急度・感情）はSettingsで調整する。 */
export async function startJournalAutoAnalysis(rawText: string, journalId?: string): Promise<AgentRun | undefined> {
  return startJournalAnalysis(rawText, journalId, { trigger: "auto", onUnconfirmedNames: "park" });
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
    };
  }
  return g[AUTO_BATCH_GUARD_KEY];
}

/** テスト用: クレームだけ忘れた状態を再現する（既存 run / ファイルは触らない）。 */
export function clearAutoBatchClaimsForTest(): void {
  const guard = getAutoBatchGuardState();
  guard.lastAutoMorningSummaryDate = null;
  guard.lastAutoDistillationWeek = null;
}

function ensureWatchdogStarted(): void {
  const guard = getAutoBatchGuardState();
  const dataDir = getDataDir();
  // 常に最新モジュールの check* を呼ぶ（HMR 後も古いクロージャに閉じない）。
  guard.tick = () => {
    checkStaleRuns();
    checkMorningSummary();
    checkWeeklyDistillation();
  };
  if (guard.dataDir !== dataDir) {
    if (guard.interval) {
      clearInterval(guard.interval);
      guard.interval = null;
    }
    guard.dataDir = dataDir;
    guard.lastAutoMorningSummaryDate = loadLastAutoMorningSummaryDate();
    guard.lastAutoDistillationWeek = loadLastAutoDistillationWeek();
  }
  if (guard.interval) return;
  guard.interval = setInterval(() => guard.tick(), WATCHDOG_INTERVAL_MS);
}
ensureWatchdogStarted();
