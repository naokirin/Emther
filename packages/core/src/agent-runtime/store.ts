import { spawn } from "node:child_process";
import { findByIdPrefix } from "../id-prefix";
import { mapAdviceStructuredStrings, normalizeAdviceStructured } from "../advice";
import { maskForStorage, unmaskNames } from "../people-directory";
import { createSqliteAgentRunRepository } from "../persistence/adapters/sqlite-agent-run-repository";
import { getRulesAndConstraints } from "../settings-store";
import {
  addMemo as addSuggestionMemo,
  archiveSuggestion,
  getSuggestion,
  listSuggestions,
  setConfirmPriority,
  setReviewStatus,
  setSuggestionReviewDueAt,
  unarchiveSuggestion,
} from "../suggestion-store";
import { adoptTheme, createThemeCandidate } from "../theme-store";
import type { AgentRunRepository } from "./agent-run-repository";
import type { AgentRun, AgentStatus, LogLine } from "./types";

// 以前は`.data/agent-runs.json`へ
// 全run・全ログを含む配列をベタ書きしており、標準出力1行ごと（appendLog呼び出しごと）に
// ファイル全体を書き直していた。半年〜1年単位で運用するとrunとログ行が単調増加するため、
// SQLite（agent_runs=runメタデータの低頻度更新、agent_run_logs=ログ行の高頻度追記）に分離し、
// 1回の更新につき対象run 1件・ログ1行だけを書き込むようにする。
// メモリ上の`AgentRun`（log配列を含む可変オブジェクト）はこれまで通り「作業中の実体」として
// 扱い、SQLiteへの書き込みはその都度の永続化先。
// 永続化は AgentRunRepository（SQLite アダプタ）経由。ドメインは SQL / getDb を知らない。

const agentRunRepository: AgentRunRepository = createSqliteAgentRunRepository();

export function insertRunLog(runId: string, line: LogLine): void {
  agentRunRepository.insertRunLog(runId, line);
}

export function persistRunMeta(run: AgentRun): void {
  agentRunRepository.upsertRunMeta(run);
}

// 起動時にSQLiteからrunメタデータ＋ログを読み込み、メモリ上のMapを組み立てる。
// 再起動時に残っていた"active"は、実体の子プロセスがもう存在しないため、
// 安全側に倒して"error"へ変換し、即座に永続化する（従来はappendLog等をトリガーに
// 遅れて反映されていたが、SQLiteでは対象行のみの更新なのでコストなく即時反映できる）。
function loadRunsFromDb(): Map<string, AgentRun> {
  const map = new Map<string, AgentRun>();
  for (let run of agentRunRepository.loadAllRunsWithLogs()) {
    // "queued"（同時実行数の上限による起動待ち）もキュー自体がメモリ上にしか無いため、
    // "active"と同じく再起動をまたいで復元できない。
    if (run.status === "active" || run.status === "queued") {
      const line: LogLine = {
        ts: Date.now(),
        channel: "system",
        text: "サーバー再起動により実行状態が不明になったため、エラー扱いにしました。",
      };
      run = { ...run, status: "error", updatedAt: line.ts, log: [...run.log, line] };
      insertRunLog(run.id, line);
      persistRunMeta(run);
    }
    map.set(run.id, run);
  }
  return map;
}

export const runs = loadRunsFromDb();

// 生きている子プロセスをrun.idで引けるようにしておき、watchdog（scheduled-tasks.ts）が
// ハングしたプロセスを実際にkillできるようにする。プロセス自体はメモリ上にしか存在しないため
// 永続化しない（サーバー再起動時は上のloadRunsFromDb変換で"error"に倒される）。
export const liveProcesses = new Map<string, ReturnType<typeof spawn>>();

// "active"のままログ更新（updatedAt）が長時間無いrunを見つけ、ハングした子プロセスとして
// 強制終了する自己修復の仕組み。「応答なしの表示」自体はクライアント側でisRunStaleを使い
// 実プロセスをkillせずに警告するが、それよりさらに長い時間放置されたものはゾンビプロセス化を
// 防ぐためここで実際に終了させる。killしても状態遷移は既存のchild.on("close")に任せる
// （二重に状態を書き換えず、実際にプロセスが終了したタイミングで確定させるため）。
export const WATCHDOG_INTERVAL_MS = 30_000;

// 個人情報の分離: 名前検出＋マスクの実処理はpeople-directory.tsの
// maskForStorageに一本化した（agent-runtime固有のロジックとしては持たない）。
// ここでは「マスクが実際に何か変えたらEMにその旨をログで知らせる」責務だけを持つ。
export async function sanitizeForCloud(run: AgentRun, text: string): Promise<string> {
  const masked = await maskForStorage(text);
  if (masked !== text) {
    appendLog(run, "meta", "送信前に人物名を匿名化しました（人物名はローカルのみで保持）");
  }
  return masked;
}

export function appendLog(run: AgentRun, channel: LogLine["channel"], text: string): void {
  const line: LogLine = { ts: Date.now(), channel, text };
  run.log.push(line);
  run.updatedAt = line.ts;
  insertRunLog(run.id, line);
  persistRunMeta(run);
}

export function checkStaleRuns(): void {
  const { agentKillAfterSeconds } = getRulesAndConstraints();
  const thresholdMs = agentKillAfterSeconds * 1000;
  const now = Date.now();
  for (const run of runs.values()) {
    if (run.status !== "active") continue;
    if (now - run.updatedAt <= thresholdMs) continue;

    const child = liveProcesses.get(run.id);
    if (child) {
      appendLog(run, "system", `⚠️ ${agentKillAfterSeconds}秒間ログの更新が無いため、応答なしとみなして強制終了します。`);
      child.kill();
      liveProcesses.delete(run.id);
    } else {
      // 子プロセスの参照を追跡できていないのに"active"のまま止まっている異常系への保険。
      run.status = "error";
      appendLog(run, "system", `⚠️ ${agentKillAfterSeconds}秒間ログの更新が無く、実行中のプロセスも追跡できないため、エラー扱いにしました。`);
    }
  }
}

/** データ復元／リセット直前用。追跡中の agent CLI 子プロセスをベストエフォートで kill する。 */
export function killLiveAgentProcesses(): void {
  for (const [id, child] of liveProcesses.entries()) {
    try {
      child.kill();
    } catch {
      // 既に終了済み等は無視
    }
    liveProcesses.delete(id);
  }
}

// 個人情報の分離: 上のrunsマップ・listRuns/getRun等はマスクされた
// （PERSON_n ID化された）テキストを保持する内部表現。EM向けのAPI応答を組み立てる境界
// だけで、この関数を通して実名へ復元する（runClaudeTurn等の内部処理からは呼ばないこと）。
export function toRunView(run: AgentRun): AgentRun {
  return {
    ...run,
    task: unmaskNames(run.task),
    log: run.log.map((l) => ({ ...l, text: unmaskNames(l.text) })),
    yieldRequest: run.yieldRequest
      ? {
          reason: unmaskNames(run.yieldRequest.reason),
          kind: run.yieldRequest.kind,
          options: run.yieldRequest.options.map((o) => ({
            ...o,
            label: unmaskNames(o.label),
            detail: o.detail !== undefined ? unmaskNames(o.detail) : o.detail,
            risk: o.risk !== undefined ? unmaskNames(o.risk) : o.risk,
          })),
        }
      : run.yieldRequest,
    proposal: run.proposal
      ? {
          conclusion: unmaskNames(run.proposal.conclusion),
          facts: run.proposal.facts.map(unmaskNames),
          logic: unmaskNames(run.proposal.logic),
          rejectedAlternatives: run.proposal.rejectedAlternatives.map((r) => ({
            option: unmaskNames(r.option),
            reason: unmaskNames(r.reason),
          })),
          // 旧永続runは expansions/challenges/explorations 欠落がありうるため空配列で補う。
          expansions: (run.proposal.expansions ?? []).map(unmaskNames),
          challenges: (run.proposal.challenges ?? []).map(unmaskNames),
          explorations: (run.proposal.explorations ?? []).map((e) => ({
            kind: e.kind,
            observation: unmaskNames(e.observation),
            relevance: unmaskNames(e.relevance),
            ...(e.confirmationQuestion
              ? { confirmationQuestion: unmaskNames(e.confirmationQuestion) }
              : {}),
          })),
          ...(run.proposal.recommendation ? { recommendation: run.proposal.recommendation } : {}),
          ...(run.proposal.suggestionTitle ? { suggestionTitle: unmaskNames(run.proposal.suggestionTitle) } : {}),
          ...(run.proposal.suggestionCandidates
            ? {
                suggestionCandidates: run.proposal.suggestionCandidates.map((c) => ({
                  title: unmaskNames(c.title),
                  ...(c.rationale ? { rationale: unmaskNames(c.rationale) } : {}),
                })),
              }
            : {}),
          ...(run.proposal.advice ? { advice: unmaskNames(run.proposal.advice) } : {}),
          ...(() => {
            const structured =
              run.proposal.adviceStructured ??
              (run.proposal.advice ? normalizeAdviceStructured(run.proposal.advice) : undefined);
            return structured
              ? { adviceStructured: mapAdviceStructuredStrings(structured, unmaskNames) }
              : {};
          })(),
        }
      : run.proposal,
    suggestedActionItems: run.suggestedActionItems?.map(unmaskNames),
    suggestedPriority: run.suggestedPriority,
    suggestedThemes: run.suggestedThemes?.map((t) => ({
      title: unmaskNames(t.title),
      summary: unmaskNames(t.summary),
      rationale: unmaskNames(t.rationale),
      facts: t.facts.map(unmaskNames),
      rootCause: t.rootCause !== undefined ? unmaskNames(t.rootCause) : undefined,
      suggestedDirection: t.suggestedDirection !== undefined ? unmaskNames(t.suggestedDirection) : undefined,
      evidenceJournalIds: t.evidenceJournalIds,
      evidenceSuggestionIds: t.evidenceSuggestionIds,
    })),
    suggestedSuggestionNotes: run.suggestedSuggestionNotes?.map((n) => ({
      suggestionId: n.suggestionId,
      text: unmaskNames(n.text),
    })),
    suggestedSuggestionUpdates: run.suggestedSuggestionUpdates?.map((u) => ({
      ...u,
      note: u.note !== undefined ? unmaskNames(u.note) : undefined,
      reason: unmaskNames(u.reason),
    })),
    periodReview: run.periodReview
      ? {
          overview: unmaskNames(run.periodReview.overview),
          observations: run.periodReview.observations.map(unmaskNames),
          interpretation: unmaskNames(run.periodReview.interpretation),
          comparisons: run.periodReview.comparisons.map((c) => ({
            area: unmaskNames(c.area),
            before: unmaskNames(c.before),
            after: unmaskNames(c.after),
            assessment: c.assessment,
          })),
          blindSpots: run.periodReview.blindSpots.map((b) => ({
            question: unmaskNames(b.question),
            reason: unmaskNames(b.reason),
          })),
          learnings: run.periodReview.learnings.map(unmaskNames),
          nextQuestions: run.periodReview.nextQuestions.map(unmaskNames),
        }
      : run.periodReview,
  };
}

export function listRuns(): AgentRun[] {
  return Array.from(runs.values()).sort((a, b) => b.createdAt - a.createdAt);
}

export function getRun(id: string): AgentRun | undefined {
  return runs.get(id);
}

// agents（Inbox一覧）専用の
// ページ取得。toRunViewはrun.logを全文含めて返すため一覧表示には過剰に重く、runの件数が
// 増えるほどAPIレスポンスも線形に肥大化する。runFallbackTitle（「📌 提案にする」クリック時の
// タイトル自動生成の最終フォールバック）が「先頭の非systemログ行」だけを参照するため、
// 全ログではなく最大1行だけに切り詰めて返す（表示にも自動生成にも必要十分）。
export function listRunsPage(
  filter: { status?: AgentStatus; showDismissed?: boolean },
  opts: { limit: number; offset: number },
): { runs: AgentRun[]; total: number } {
  const all = listRuns()
    .filter((r) => filter.showDismissed || r.triageStatus !== "dismissed")
    .filter((r) => !filter.status || r.status === filter.status);
  const page = all.slice(opts.offset, opts.offset + opts.limit).map((r) => {
    const firstNonSystemLine = r.log.find((l) => l.channel !== "system");
    return toRunView({ ...r, log: firstNonSystemLine ? [firstNonSystemLine] : [] });
  });
  return { runs: page, total: all.length };
}

// AI主導（origin !== "manual"）で起動されたrunをEMが
// 開いた・提案化した際に「確認済み」にする。手動起動のrunは常にreviewed=trueのため無害。
export function markRunReviewed(id: string): AgentRun | undefined {
  const run = runs.get(id);
  if (!run || run.reviewed) return run;
  run.reviewed = true;
  persistRunMeta(run);
  return run;
}

function applyTriageStatus(
  run: AgentRun,
  status: "watching" | "dismissed",
  opts?: { nextReviewAt?: number },
): void {
  run.reviewed = true;
  run.triageStatus = status;
  run.triageAt = Date.now();
  if (status === "watching" && opts?.nextReviewAt !== undefined) {
    run.triageNextReviewAt = opts.nextReviewAt;
  } else {
    run.triageNextReviewAt = undefined;
  }
}

// 「様子見」（追跡は続けるが緊急ではない）
// と「却下」（対応不要）をEMに明示的に選ばせ、triageStatusへ記録する。どちらもreviewed=trueに
// なるため「次にすべきこと」の緊急度からは外れるが、triageStatusで後から区別できる。
// nextReviewAt: 様子見時のみ有効。「次に確認する日」まで日次キューへ再浮上させない。
export function setRunTriageStatus(
  id: string,
  status: "watching" | "dismissed",
  opts?: { nextReviewAt?: number },
): AgentRun | undefined {
  const run = runs.get(id);
  if (!run) return undefined;
  applyTriageStatus(run, status, opts);
  persistRunMeta(run);
  // 親Leadを却下してもconsult子runが判断待ちに残らないよう伝播する。
  for (const child of runs.values()) {
    if (child.consultedBy === id) {
      applyTriageStatus(child, status, opts);
      persistRunMeta(child);
    }
  }
  return run;
}

// 誤って起票した・
// テストで作った等の相談を、相談履歴一覧・AIの判断材料（context-blocks等）から除外する
// （ログ・run自体は削除しない）。triageStatusとは独立（却下済みの相談も後から
// アーカイブできるように、意味を混同しない）。
export function setRunArchived(id: string, archived: boolean): AgentRun | undefined {
  const run = runs.get(id);
  if (!run) return undefined;
  run.archivedAt = archived ? Date.now() : undefined;
  persistRunMeta(run);
  return run;
}

export function clearSuggestedThemes(id: string): AgentRun | undefined {
  const run = runs.get(id);
  if (!run) return undefined;
  run.suggestedThemes = undefined;
  persistRunMeta(run);
  return run;
}

// indicesを指定するとsuggestedSuggestionNotes配列中の該当要素のみを対象にし、
// 残りは提案として残す（未指定時は従来どおり全件対象・全消去、後方互換を維持）。
// reason:"handled"は「却下」（提案自体が誤り）ではなく「別口で対応済みなので追わない」ことを
// runのログに残す——却下と違い何の記録も残らないと後から見分けがつかないため。
export function clearSuggestedSuggestionNotes(
  id: string,
  opts?: { indices?: number[]; reason?: "dismissed" | "handled" },
): AgentRun | undefined {
  const run = runs.get(id);
  if (!run) return undefined;
  const notes = run.suggestedSuggestionNotes ?? [];
  const selected = opts?.indices ? new Set(opts.indices) : undefined;
  if (opts?.reason === "handled") {
    const targets = notes.filter((_, i) => !selected || selected.has(i));
    const ts = Date.now();
    for (const note of targets) {
      run.log.push({
        ts,
        channel: "meta",
        text: `📝 他提案への追記提案を対応済みとして却下しました（対象提案: ${note.suggestionId.slice(0, 8)}）: ${note.text}`,
      });
    }
  }
  run.suggestedSuggestionNotes = selected
    ? notes.filter((_, i) => !selected.has(i))
    : undefined;
  if (run.suggestedSuggestionNotes?.length === 0) run.suggestedSuggestionNotes = undefined;
  persistRunMeta(run);
  return run;
}

// suggestedSuggestionNotes を対象提案のメモへ書き込んで確定する。suggestionIdは
// lookup結果由来のためフルID一致を優先し、無ければ8桁以上のプレフィックス一致（1件のみ）を
// 許容する（提案詳細のURL欄と同じ解決規則）。存在しない/曖昧なsuggestionIdの要素は書き込まず
// スキップする（作成・ステータス変更等は行わない——追記のみの安全側API）。indices未指定時は
// 従来どおり全件を対象にする。
export async function adoptSuggestedSuggestionNotesFromRun(
  id: string,
  indices?: number[],
): Promise<{ run: AgentRun; written: { suggestionId: string; text: string }[]; skipped: string[] } | undefined> {
  const run = runs.get(id);
  if (!run?.suggestedSuggestionNotes?.length) return undefined;
  const selected = indices ? new Set(indices) : undefined;
  const targetNotes = run.suggestedSuggestionNotes.filter((_, i) => !selected || selected.has(i));
  if (targetNotes.length === 0) return undefined;
  const written: { suggestionId: string; text: string }[] = [];
  const skipped: string[] = [];
  for (const note of targetNotes) {
    const exact = getSuggestion(note.suggestionId);
    const target = exact ?? findByIdPrefix(listSuggestions(), (s) => s.id, note.suggestionId).at(0);
    const matchCount = exact ? 1 : findByIdPrefix(listSuggestions(), (s) => s.id, note.suggestionId).length;
    if (!target || matchCount !== 1) {
      skipped.push(note.suggestionId);
      continue;
    }
    await addSuggestionMemo(target.id, note.text, { source: "agent" });
    written.push({ suggestionId: target.id, text: note.text });
  }
  run.suggestedSuggestionNotes = selected
    ? run.suggestedSuggestionNotes.filter((_, i) => !selected.has(i))
    : undefined;
  if (run.suggestedSuggestionNotes?.length === 0) run.suggestedSuggestionNotes = undefined;
  persistRunMeta(run);
  return { run, written, skipped };
}

// EMが「まとめて
// 反映」を押したタイミングでのみ、suggestedSuggestionUpdates を実際のSuggestionへ書き込む。
// suggestionIdの解決規則はadoptSuggestedSuggestionNotesFromRunと同じ（フルID一致優先、無ければ
// プレフィックス一致1件のみ許容）。反映してよい変更種類は制限しない（reviewStatus/
// confirmPriority/reviewDueAt/archived/noteのいずれも、指定されたものだけ順に適用する）。
// noteの追記はaddMemoにonUpdatedを渡さない——auto-suggestion-update（reactToSuggestionUpdate）を
// 裏で起動させないため（「裏での自動書き換えはしない」という本方針の核）。indices未指定時は
// 従来どおり全件を対象にする。
export async function adoptSuggestionUpdatesFromRun(
  id: string,
  indices?: number[],
): Promise<{ run: AgentRun; applied: { suggestionId: string; reason: string }[]; skipped: string[] } | undefined> {
  const run = runs.get(id);
  if (!run?.suggestedSuggestionUpdates?.length) return undefined;
  const selected = indices ? new Set(indices) : undefined;
  const targets = run.suggestedSuggestionUpdates.filter((_, i) => !selected || selected.has(i));
  if (targets.length === 0) return undefined;
  const applied: { suggestionId: string; reason: string }[] = [];
  const skipped: string[] = [];
  for (const update of targets) {
    const exact = getSuggestion(update.suggestionId);
    const target = exact ?? findByIdPrefix(listSuggestions(), (s) => s.id, update.suggestionId).at(0);
    const matchCount = exact ? 1 : findByIdPrefix(listSuggestions(), (s) => s.id, update.suggestionId).length;
    if (!target || matchCount !== 1) {
      skipped.push(update.suggestionId);
      continue;
    }
    if (update.reviewStatus !== undefined) setReviewStatus(target.id, update.reviewStatus);
    if (update.confirmPriority !== undefined) setConfirmPriority(target.id, update.confirmPriority);
    if (update.reviewDueAt !== undefined) setSuggestionReviewDueAt(target.id, update.reviewDueAt);
    if (update.archived === true) archiveSuggestion(target.id);
    if (update.archived === false) unarchiveSuggestion(target.id);
    if (update.note) {
      await addSuggestionMemo(target.id, update.note, { source: "agent" });
    }
    applied.push({ suggestionId: target.id, reason: update.reason });
  }
  run.suggestedSuggestionUpdates = selected
    ? run.suggestedSuggestionUpdates.filter((_, i) => !selected.has(i))
    : undefined;
  if (run.suggestedSuggestionUpdates?.length === 0) run.suggestedSuggestionUpdates = undefined;
  persistRunMeta(run);
  return { run, applied, skipped };
}

/** 整理差分の却下（提案自体が不適切）。indices未指定時は全件を対象にする。 */
export function clearSuggestedSuggestionUpdates(
  id: string,
  opts?: { indices?: number[] },
): AgentRun | undefined {
  const run = runs.get(id);
  if (!run) return undefined;
  const updates = run.suggestedSuggestionUpdates ?? [];
  const selected = opts?.indices ? new Set(opts.indices) : undefined;
  run.suggestedSuggestionUpdates = selected ? updates.filter((_, i) => !selected.has(i)) : undefined;
  if (run.suggestedSuggestionUpdates?.length === 0) run.suggestedSuggestionUpdates = undefined;
  persistRunMeta(run);
  return run;
}

// suggestedThemes を OrgTheme(candidate→adopted) として確定する。
export async function adoptSuggestedThemesFromRun(
  id: string,
): Promise<{ run: AgentRun; themes: Awaited<ReturnType<typeof createThemeCandidate>>[] } | undefined> {
  const run = runs.get(id);
  if (!run?.suggestedThemes?.length) return undefined;
  const created = [];
  for (const suggested of run.suggestedThemes) {
    const candidate = await createThemeCandidate({ ...suggested, sourceRunId: run.id });
    const adopted = await adoptTheme(candidate.id);
    if (adopted) created.push(adopted);
  }
  run.suggestedThemes = undefined;
  run.reviewed = true;
  persistRunMeta(run);
  return { run, themes: created };
}
