import { spawn } from "node:child_process";
import { getDb } from "@/lib/db";
import { findByIdPrefix } from "@/lib/id-prefix";
import { addLogEntry, getIssue, listIssues } from "@/lib/issue-store";
import { maskForStorage, unmaskNames } from "@/lib/people-directory";
import { getRulesAndConstraints } from "@/lib/settings-store";
import { adoptTheme, createThemeCandidate } from "@/lib/theme-store";
import { normalizeSuggestedSubIssues, parseSuggestedPriority } from "./extraction";
import type { AgentRun, AgentStatus, LogLine } from "./types";

// docs/memo.md「H: 永続化データモデルの設計」対応。以前は`.data/agent-runs.json`へ
// 全run・全ログを含む配列をベタ書きしており、標準出力1行ごと（appendLog呼び出しごと）に
// ファイル全体を書き直していた。半年〜1年単位で運用するとrunとログ行が単調増加するため、
// SQLite（agent_runs=runメタデータの低頻度更新、agent_run_logs=ログ行の高頻度追記）に分離し、
// 1回の更新につき対象run 1件・ログ1行だけを書き込むようにする。
// メモリ上の`AgentRun`（log配列を含む可変オブジェクト）はこれまで通り「作業中の実体」として
// 扱い続け、SQLiteへの書き込みはその都度の永続化先を切り替えただけ——呼び出し側の
// runClaudeTurn/handleStreamEvent等は一切変更していない。

type AgentRunRow = {
  id: string;
  agent_name: string;
  task: string;
  status: string;
  session_id: string | null;
  agy_conversation_id: string | null;
  cursor_session_id: string | null;
  yield_request_json: string | null;
  proposal_json: string | null;
  suggested_action_items_json: string | null;
  suggested_sub_issues_json: string | null;
  suggested_charter_json: string | null;
  suggested_priority_json: string | null;
  suggested_themes_json: string | null;
  suggested_issue_notes_json: string | null;
  total_cost_usd: number;
  created_at: number;
  updated_at: number;
  consulted_by: string | null;
  source_journal_id: string | null;
  origin: string;
  reviewed: number;
  triage_status: string | null;
  triage_at: number | null;
};

type AgentRunLogRow = {
  run_id: string;
  ts: number;
  channel: string;
  text: string;
};

function insertRunLog(runId: string, line: LogLine): void {
  getDb()
    .prepare("INSERT INTO agent_run_logs (run_id, ts, channel, text) VALUES (?, ?, ?, ?)")
    .run(runId, line.ts, line.channel, line.text);
}

function persistRunMeta(run: AgentRun): void {
  getDb()
    .prepare(
      `INSERT INTO agent_runs
        (id, agent_name, task, status, session_id, agy_conversation_id, cursor_session_id, yield_request_json, proposal_json, suggested_action_items_json, suggested_sub_issues_json, suggested_charter_json, suggested_priority_json, suggested_themes_json, suggested_issue_notes_json, total_cost_usd, created_at, updated_at, consulted_by, source_journal_id, origin, reviewed, triage_status, triage_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         status = excluded.status,
         session_id = excluded.session_id,
         agy_conversation_id = excluded.agy_conversation_id,
         cursor_session_id = excluded.cursor_session_id,
         yield_request_json = excluded.yield_request_json,
         proposal_json = excluded.proposal_json,
         suggested_action_items_json = excluded.suggested_action_items_json,
         suggested_sub_issues_json = excluded.suggested_sub_issues_json,
         suggested_charter_json = excluded.suggested_charter_json,
         suggested_priority_json = excluded.suggested_priority_json,
         suggested_themes_json = excluded.suggested_themes_json,
         suggested_issue_notes_json = excluded.suggested_issue_notes_json,
         total_cost_usd = excluded.total_cost_usd,
         updated_at = excluded.updated_at,
         reviewed = excluded.reviewed,
         triage_status = excluded.triage_status,
         triage_at = excluded.triage_at`,
    )
    .run(
      run.id,
      run.agentName,
      run.task,
      run.status,
      run.sessionId ?? null,
      run.agyConversationId ?? null,
      run.cursorSessionId ?? null,
      run.yieldRequest ? JSON.stringify(run.yieldRequest) : null,
      run.proposal ? JSON.stringify(run.proposal) : null,
      run.suggestedActionItems ? JSON.stringify(run.suggestedActionItems) : null,
      run.suggestedSubIssues ? JSON.stringify(run.suggestedSubIssues) : null,
      run.suggestedCharter ? JSON.stringify(run.suggestedCharter) : null,
      run.suggestedPriority ? JSON.stringify(run.suggestedPriority) : null,
      run.suggestedThemes ? JSON.stringify(run.suggestedThemes) : null,
      run.suggestedIssueNotes ? JSON.stringify(run.suggestedIssueNotes) : null,
      run.totalCostUsd,
      run.createdAt,
      run.updatedAt,
      run.consultedBy ?? null,
      run.sourceJournalId ?? null,
      run.origin,
      run.reviewed ? 1 : 0,
      run.triageStatus ?? null,
      run.triageAt ?? null,
    );
}

export { insertRunLog, persistRunMeta };

// 起動時にSQLiteからrunメタデータ＋ログを読み込み、メモリ上のMapを組み立てる。
// 再起動時に残っていた"active"は、実体の子プロセスがもう存在しないため、
// 安全側に倒して"error"へ変換し、即座に永続化する（従来はappendLog等をトリガーに
// 遅れて反映されていたが、SQLiteでは対象行のみの更新なのでコストなく即時反映できる）。
function loadRunsFromDb(): Map<string, AgentRun> {
  const db = getDb();
  const runRows = db.prepare("SELECT * FROM agent_runs").all() as unknown as AgentRunRow[];
  const logRows = db
    .prepare("SELECT run_id, ts, channel, text FROM agent_run_logs ORDER BY id ASC")
    .all() as unknown as AgentRunLogRow[];

  const logsByRun = new Map<string, LogLine[]>();
  for (const row of logRows) {
    const list = logsByRun.get(row.run_id) ?? [];
    list.push({ ts: row.ts, channel: row.channel as LogLine["channel"], text: row.text });
    logsByRun.set(row.run_id, list);
  }

  const map = new Map<string, AgentRun>();
  for (const row of runRows) {
    let run: AgentRun = {
      id: row.id,
      agentName: row.agent_name,
      task: row.task,
      status: row.status as AgentStatus,
      sessionId: row.session_id ?? undefined,
      agyConversationId: row.agy_conversation_id ?? undefined,
      cursorSessionId: row.cursor_session_id ?? undefined,
      log: logsByRun.get(row.id) ?? [],
      yieldRequest: row.yield_request_json ? JSON.parse(row.yield_request_json) : undefined,
      proposal: row.proposal_json ? JSON.parse(row.proposal_json) : undefined,
      suggestedActionItems: row.suggested_action_items_json ? JSON.parse(row.suggested_action_items_json) : undefined,
      suggestedSubIssues: row.suggested_sub_issues_json
        ? normalizeSuggestedSubIssues(JSON.parse(row.suggested_sub_issues_json))
        : undefined,
      suggestedCharter: row.suggested_charter_json ? JSON.parse(row.suggested_charter_json) : undefined,
      suggestedPriority: row.suggested_priority_json
        ? parseSuggestedPriority(JSON.parse(row.suggested_priority_json))
        : undefined,
      suggestedThemes: row.suggested_themes_json ? JSON.parse(row.suggested_themes_json) : undefined,
      suggestedIssueNotes: row.suggested_issue_notes_json ? JSON.parse(row.suggested_issue_notes_json) : undefined,
      totalCostUsd: row.total_cost_usd,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      consultedBy: row.consulted_by ?? undefined,
      sourceJournalId: row.source_journal_id ?? undefined,
      origin: (row.origin as AgentRun["origin"]) ?? "manual",
      reviewed: !!row.reviewed,
      triageStatus: (row.triage_status as AgentRun["triageStatus"]) ?? undefined,
      triageAt: row.triage_at ?? undefined,
    };
    // "queued"（同時実行数の上限による起動待ち）もキュー自体がメモリ上にしか無いため、
    // "active"と同じく再起動をまたいで復元できない。
    if (run.status === "active" || run.status === "queued") {
      const line: LogLine = { ts: Date.now(), channel: "system", text: "サーバー再起動により実行状態が不明になったため、エラー扱いにしました。" };
      run = { ...run, status: "error", updatedAt: line.ts, log: [...run.log, line] };
      insertRunLog(run.id, line);
      persistRunMeta(run);
    }
    map.set(run.id, run);
  }
  return map;
}

export const runs = loadRunsFromDb();

// docs/memo.md TODO「動いていると思ったら止まっていた、を防ぐ」対応の実体。
// 生きている子プロセスをrun.idで引けるようにしておき、watchdog（scheduled-tasks.ts）が
// ハングしたプロセスを実際にkillできるようにする。プロセス自体はメモリ上にしか存在しないため
// 永続化しない（サーバー再起動時は上のloadRunsFromDb変換で"error"に倒される）。
export const liveProcesses = new Map<string, ReturnType<typeof spawn>>();

// "active"のままログ更新（updatedAt）が長時間無いrunを見つけ、ハングした子プロセスとして
// 強制終了する自己修復の仕組み。「応答なしの表示」自体はクライアント側でisRunStale()を使い
// 実プロセスをkillせずに警告するが、それよりさらに長い時間放置されたものはゾンビプロセス化を
// 防ぐためここで実際に終了させる。killしても状態遷移は既存のchild.on("close")に任せる
// （二重に状態を書き換えず、実際にプロセスが終了したタイミングで確定させるため）。
export const WATCHDOG_INTERVAL_MS = 30_000;

// 個人情報の分離（ユーザー指摘対応）: 名前検出＋マスクの実処理はpeople-directory.tsの
// maskForStorage()に一本化した（agent-runtime固有のロジックとしては持たない）。
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

// 個人情報の分離（ユーザー指摘対応）: 上のrunsマップ・listRuns/getRun等はマスクされた
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
          ...(run.proposal.recommendation ? { recommendation: run.proposal.recommendation } : {}),
          ...(run.proposal.issueTitle ? { issueTitle: unmaskNames(run.proposal.issueTitle) } : {}),
          ...(run.proposal.issueCandidates
            ? {
                issueCandidates: run.proposal.issueCandidates.map((c) => ({
                  title: unmaskNames(c.title),
                  ...(c.rationale ? { rationale: unmaskNames(c.rationale) } : {}),
                })),
              }
            : {}),
        }
      : run.proposal,
    suggestedActionItems: run.suggestedActionItems?.map(unmaskNames),
    suggestedSubIssues: run.suggestedSubIssues?.map((s) => ({
      title: unmaskNames(s.title),
      priority: s.priority,
    })),
    suggestedCharter: run.suggestedCharter
      ? {
          why: run.suggestedCharter.why !== undefined ? unmaskNames(run.suggestedCharter.why) : undefined,
          what: run.suggestedCharter.what !== undefined ? unmaskNames(run.suggestedCharter.what) : undefined,
          how: run.suggestedCharter.how !== undefined ? unmaskNames(run.suggestedCharter.how) : undefined,
        }
      : run.suggestedCharter,
    suggestedPriority: run.suggestedPriority,
    suggestedThemes: run.suggestedThemes?.map((t) => ({
      title: unmaskNames(t.title),
      summary: unmaskNames(t.summary),
      rationale: unmaskNames(t.rationale),
      facts: t.facts.map(unmaskNames),
      rootCause: t.rootCause !== undefined ? unmaskNames(t.rootCause) : undefined,
      suggestedDirection: t.suggestedDirection !== undefined ? unmaskNames(t.suggestedDirection) : undefined,
      evidenceJournalIds: t.evidenceJournalIds,
      evidenceIssueIds: t.evidenceIssueIds,
    })),
    suggestedIssueNotes: run.suggestedIssueNotes?.map((n) => ({
      issueId: n.issueId,
      text: unmaskNames(n.text),
    })),
  };
}

export function listRuns(): AgentRun[] {
  return Array.from(runs.values()).sort((a, b) => b.createdAt - a.createdAt);
}

export function getRun(id: string): AgentRun | undefined {
  return runs.get(id);
}

// ユーザー要望「一覧の全件取得をページネーション化したい」対応。/agents（Inbox一覧）専用の
// ページ取得。toRunView()はrun.logを全文含めて返すため一覧表示には過剰に重く、runの件数が
// 増えるほどAPIレスポンスも線形に肥大化する。runFallbackTitle（「📌 Issueにする」クリック時の
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

// docs/first_implession 3.6対応。AI主導（origin !== "manual"）で起動されたrunをEMが
// 開いた・Issue化した際に「確認済み」にする。手動起動のrunは常にreviewed=trueのため無害。
export function markRunReviewed(id: string): AgentRun | undefined {
  const run = runs.get(id);
  if (!run || run.reviewed) return run;
  run.reviewed = true;
  persistRunMeta(run);
  return run;
}

function applyTriageStatus(run: AgentRun, status: "watching" | "dismissed"): void {
  run.reviewed = true;
  run.triageStatus = status;
  run.triageAt = Date.now();
}

// docs/memo.md「B. 何でも相談↔Issueの昇格物語」対応。「様子見」（追跡は続けるが緊急ではない）
// と「却下」（対応不要）をEMに明示的に選ばせ、triageStatusへ記録する。どちらもreviewed=trueに
// なるため「次にすべきこと」の緊急度からは外れるが、triageStatusで後から区別できる。
export function setRunTriageStatus(id: string, status: "watching" | "dismissed"): AgentRun | undefined {
  const run = runs.get(id);
  if (!run) return undefined;
  applyTriageStatus(run, status);
  persistRunMeta(run);
  // docs/usage_issues U4。親Leadを却下してもconsult子runが判断待ちに残らないよう伝播する。
  for (const child of runs.values()) {
    if (child.consultedBy === id) {
      applyTriageStatus(child, status);
      persistRunMeta(child);
    }
  }
  return run;
}

// docs/memo.md「K」対応。AIが提案した子Issue分解案を、EMが採用した後（実際の作成は
// 呼び出し側が/api/issuesを個別に叩く）または却下した後に、提案自体をrunから消す。
export function clearSuggestedSubIssues(id: string): AgentRun | undefined {
  const run = runs.get(id);
  if (!run) return undefined;
  run.suggestedSubIssues = undefined;
  persistRunMeta(run);
  return run;
}

// ユーザー依頼「Journal等からIssueを生成する際、AIエージェントチームに内容を埋めさせる」
// 対応。AIが提案したWhy/What/Howの埋め合わせ案を、EMが採用した後（実際の反映は
// 呼び出し側が/api/issues/[id]を個別に叩く）または却下した後に、提案自体をrunから消す。
export function clearSuggestedCharter(id: string): AgentRun | undefined {
  const run = runs.get(id);
  if (!run) return undefined;
  run.suggestedCharter = undefined;
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

// docs/memo.md「他Issueへの追記提案で追記対象を個別に選択できるようにする」「却下だけでなく
// 対応済みも」対応。indicesを指定するとsuggestedIssueNotes配列中の該当要素のみを対象にし、
// 残りは提案として残す（未指定時は従来どおり全件対象・全消去、後方互換を維持）。
// reason:"handled"は「却下」（提案自体が誤り）ではなく「別口で対応済みなので追わない」ことを
// runのログに残す——却下と違い何の記録も残らないと後から見分けがつかないため。
export function clearSuggestedIssueNotes(
  id: string,
  opts?: { indices?: number[]; reason?: "dismissed" | "handled" },
): AgentRun | undefined {
  const run = runs.get(id);
  if (!run) return undefined;
  const notes = run.suggestedIssueNotes ?? [];
  const selected = opts?.indices ? new Set(opts.indices) : undefined;
  if (opts?.reason === "handled") {
    const targets = notes.filter((_, i) => !selected || selected.has(i));
    const ts = Date.now();
    for (const note of targets) {
      run.log.push({
        ts,
        channel: "meta",
        text: `📝 他Issueへの追記提案を対応済みとして却下しました（対象Issue: ${note.issueId.slice(0, 8)}）: ${note.text}`,
      });
    }
  }
  run.suggestedIssueNotes = selected
    ? notes.filter((_, i) => !selected.has(i))
    : undefined;
  if (run.suggestedIssueNotes?.length === 0) run.suggestedIssueNotes = undefined;
  persistRunMeta(run);
  return run;
}

// docs/memo.md「Agentが相談などから他Issueなどへ記録することができない」対応。
// suggestedIssueNotes を対象Issueのlog（IssueLogEntry）へ書き込んで確定する。issueIdは
// lookup結果由来のためフルID一致を優先し、無ければ8桁以上のプレフィックス一致（1件のみ）を
// 許容する（Issue詳細のURL欄と同じ解決規則）。存在しない/曖昧なissueIdの要素は書き込まず
// スキップする（作成・ステータス変更等は行わない——追記のみの安全側API）。indices未指定時は
// 従来どおり全件を対象にする。
export async function adoptSuggestedIssueNotesFromRun(
  id: string,
  indices?: number[],
): Promise<{ run: AgentRun; written: { issueId: string; text: string }[]; skipped: string[] } | undefined> {
  const run = runs.get(id);
  if (!run?.suggestedIssueNotes?.length) return undefined;
  const selected = indices ? new Set(indices) : undefined;
  const targetNotes = run.suggestedIssueNotes.filter((_, i) => !selected || selected.has(i));
  if (targetNotes.length === 0) return undefined;
  const written: { issueId: string; text: string }[] = [];
  const skipped: string[] = [];
  for (const note of targetNotes) {
    const exact = getIssue(note.issueId);
    const target = exact ?? findByIdPrefix(listIssues(), (i) => i.id, note.issueId).at(0);
    const matchCount = exact ? 1 : findByIdPrefix(listIssues(), (i) => i.id, note.issueId).length;
    if (!target || matchCount !== 1) {
      skipped.push(note.issueId);
      continue;
    }
    await addLogEntry(target.id, note.text);
    written.push({ issueId: target.id, text: note.text });
  }
  run.suggestedIssueNotes = selected
    ? run.suggestedIssueNotes.filter((_, i) => !selected.has(i))
    : undefined;
  if (run.suggestedIssueNotes?.length === 0) run.suggestedIssueNotes = undefined;
  persistRunMeta(run);
  return { run, written, skipped };
}

// docs/knowledge_distillation.md。suggestedThemes を OrgTheme(candidate→adopted) として確定する。
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
