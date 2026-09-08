import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dataFilePath, loadJSON, saveJSON } from "@/lib/persistence";
import { assertNoRealNamesLeaked, listPeople, maskForStorage, maskNames, unmaskNames } from "@/lib/people-directory";
import { getOrgStrategy, getTeam, listActiveTeams, listObjectives, type Team } from "@/lib/org-context-store";
import { getIssueByRunId, linkIssueRun, type IssueCharter } from "@/lib/issue-store";
import { listActiveFactsForPerson, listInterpretationsForPerson, searchSimilarEvents, type KnowledgeEvent } from "@/lib/knowledge-store";
import { embedText } from "@/lib/embeddings";
import { getDb } from "@/lib/db";
import { getRulesAndConstraints } from "@/lib/settings-store";
import { INTERVENTION_TYPES, teamDisplayName, teamPathSegments } from "@/lib/types";

// ユーザー指摘「設定変更時に、それまで起動していなかったエージェントが一気に並列で
// 起動することがある」対応。"queued"は同時実行数の上限（settings-store.tsの
// maxParallelAgentRuns）に達しているため、CLI子プロセスの起動を待っている状態
// （acquireRunSlot参照）。"active"は実際にCLI子プロセスが動いている状態で、
// 両者はEM向けUI上で区別して表示する。
export type AgentStatus = "active" | "queued" | "yield" | "idle" | "error";

export type YieldOption = {
  id: string;
  label: string;
  detail?: string;
  risk?: string;
};

export type YieldRequest = {
  reason: string;
  options: YieldOption[];
};

export type RejectedAlternative = {
  option: string;
  reason: string;
};

export type Proposal = {
  conclusion: string;
  facts: string[];
  logic: string;
  rejectedAlternatives: RejectedAlternative[];
};

// docs/memo.md「M. AIエージェント“チーム”の本格協働」対応。以前は専門エージェント
// 1体のみに相談できたが（agent: string）、複数の専門エージェントへ同時に（並行して）
// 相談し、それぞれの回答を踏まえて結論を出せるようにする（agents: string[]）。
// 連鎖相談（専門エージェントがさらに別の専門エージェントに相談する）は無限ループ
// リスクがあるため引き続き禁止（specialistRunはallowConsult=falseで起動する）。
// docs/agent_specialization.md「6. Leadのconsult差分化」段階5対応。以前はagents全員へ
// 同一questionを送るしかなく、プロンプトで「宛先ごとに書き分けろ」と指示するだけだった
// （1つの質問文に複数の宛先向けの依頼を詰め込む書き方）。questionsは任意のagentName→
// 個別質問のマップで、指定が無いagentには従来どおりquestionが使われる（後方互換）。
export type ConsultRequest = {
  agents: string[];
  question: string;
  questions?: Record<string, string>;
};

// docs/memo.md「F. Product Agentの追加」対応。Lead Agentの相談先候補にProduct Agentを含める。
const SPECIALIST_AGENTS = ["People Agent", "Process Agent", "Tech Agent", "Product Agent"];

// docs/agent_specialization.md「3. A. 役割定義」対応。以前は自己紹介1行
// （「あなたは『〇〇 Agent』です」）だけで専門性をモデルの名前推論に委ねていたため、
// 同じ事実を見ても各エージェントの結論・logicの軸が実質同じになりがちだった。
// ここでは「専門領域」「主に答える問い」「やらないこと（境界）」を各象限ごとに固定文で
// 与える。「やらないこと」を必ず書くのは、肯定文の専門領域だけより境界の方が
// 役割の安定に効くため（同ドキュメント3.1「共通の枠」の考え方）。
const ROLE_BLOCKS: Record<string, string[]> = {
  "Lead Agent": [
    "【役割】",
    "- 専門領域: 論点の分解、専門エージェントへの振り分け、統合判断、EMへのYield",
    "- 主に答える問い: 「今日EMが決めるべきことは何か／誰の専門見解が必要か」",
    "- やらないこと: 一象限の深い専門分析を自分だけで完結させること（必要ならconsult）",
    "- 統合時: 専門家の一致点・相違点・採用した軸をlogicに明示する",
    "- コスト: 無関係なconsultを増やさない",
  ],
  "People Agent": [
    "【役割】",
    "- 専門領域: 個人・関係性・動機・成長・心理的安全性・1on1・オンボーディング",
    "- 主に答える問い: 「誰の状態がどう変化し、EMは人にどう介入すべきか」",
    "- 見る: 人物プロファイル、Journalの感情・緊急度、チーム内の関係・負荷の偏り",
    "- やらないこと: 技術選定の本論、ロードマップ優先順位の本論（必要なら境界を示す）",
    "- 提案の翻訳先: 1on1設計、心理的安全性、役割の人側、採用・オンボーディング",
  ],
  "Process Agent": [
    "【役割】",
    "- 専門領域: 意思決定、フロー、依存、会議体、エスカレーション、プロセス変更",
    "- 主に答える問い: 「仕事がどこで止まり、仕組みとしてどう直すか」",
    "- 見る: 手戻り／待ち／承認の所在、チーム間依存、運用ルールと実態の乖離",
    "- やらないこと: 個人の内面の深掘り（People）、顧客価値の優先の本論（Product）",
    "- 提案の翻訳先: 意思決定プロセス、依存関係の切り方、プロセス変更、役割明確化（責任の置き方）",
  ],
  "Tech Agent": [
    "【役割】",
    "- 専門領域: 技術的負債、品質、アーキ制約、リリースリスク、実装可能性が組織に与える摩擦",
    "- 主に答える問い: 「技術制約が組織のどこを詰まらせているか／EMが調整すべき技術−組織の接点は何か」",
    "- 見る: 負債・障害・リリース遅延の技術要因、専門性の偏り、ツール／環境のボトルネック",
    "- やらないこと: コードを書く、リポジトリ操作（ツールは無効化済み）。純粋な人事評価の本論",
    "- 提案の翻訳先: 依存の技術境界、プロセス（リリース／レビュー）、優先順位（返済 vs 機能）へのインプット",
    "- 注意: 「実装タスク一覧」ではなく「組織障害としての技術」で語ること",
  ],
  "Product Agent": [
    "【役割】",
    "- 専門領域: 顧客価値、優先順位、スコープ、ロードマップと組織能力の齟齬",
    "- 主に答える問い: 「何をやる／やらないべきで、それが組織のどこと衝突しているか」",
    "- 見る: Objective/KR、並行過多、スコープ膨張、価値に対する組織の供給能力",
    "- やらないこと: 個人のケアの本論（People）、詳細な技術設計（Tech）",
    "- 提案の翻訳先: 優先順位／スコープ、役割・意思決定（優先の決まる場所）、プロセス（価値検証の回し方）",
  ],
};

// 専門エージェント（Lead以外）共通のテール。docs/agent_specialization.md 3.1
// 「情報不足時: 推測で埋めずyield（options空可）」対応。各象限固有の「提案の翻訳先」等は
// ROLE_BLOCKS側に持たせ、ここでは象限を問わず共通の境界だけを足す。
const SPECIALIST_ROLE_TAIL = "- 情報不足時: 推測で埋めず、proposalではなくyieldしてください（optionsは空でも構いません）";

// docs/agent_specialization.md「6. Leadのconsult差分化（振り分け表）」対応。以前は
// 「名前列挙＋コスト注意」のみで、Leadがどの論点でどの専門家を呼ぶべきかの
// ヒューリスティックが無かった。
const CONSULT_ROUTING_TABLE = [
  "  論点の兆しと呼ぶ先の目安:",
  "  - 特定人物・モチベ・1on1・安全性・オンボード → People Agent",
  "  - 承認待ち・会議・フロー・手戻り・依存 → Process Agent",
  "  - 障害・負債・リリース技術要因・スキル偏り（技術） → Tech Agent",
  "  - 優先順位・スコープ・KR・顧客価値・ロードマップ衝突 → Product Agent",
  "  - 複合論点（例: 人×プロセス、技術×優先）は該当する2つまでに絞る（3つ以上は例外的な場合のみ）",
];

// docs/agent_specialization.md「7. 介入の型 ↔ エージェント」対応。INTERVENTION_TYPES
// （EM向けのIssueテンプレート、types.ts）を、そのままエージェント振り分けの辞書としても
// 使う。コード・プロンプト・UIが同じ辞書を共有することで「専門チーム感」を出す狙い。
const INTERVENTION_TYPE_AGENTS: Record<string, { primary: string[]; secondary: string[] }> = {
  "1on1設計": { primary: ["People Agent"], secondary: ["Process Agent"] },
  心理的安全性: { primary: ["People Agent"], secondary: ["Process Agent"] },
  "採用・オンボーディング": { primary: ["People Agent"], secondary: ["Process Agent"] },
  意思決定プロセス: { primary: ["Process Agent"], secondary: ["Tech Agent"] },
  プロセス変更: { primary: ["Process Agent"], secondary: [] },
  依存関係の切り方: { primary: ["Process Agent"], secondary: ["Tech Agent"] },
  "優先順位／スコープ": { primary: ["Product Agent"], secondary: ["Process Agent"] },
  役割明確化: { primary: ["Process Agent", "People Agent"], secondary: [] },
};

// 紐づくIssueのtagsに介入の型が含まれ、かつそのagentNameが主担当／副担当に該当する場合、
// 「この介入型を主軸に」という一文を足す。該当しない場合はブロック自体を省略する
// （無関係な介入型の指示で専門性をブレさせないため）。
export function buildInterventionTypeGuidance(runId: string | undefined, agentName: string): string {
  if (!runId) return "";
  const issue = getIssueByRunId(runId);
  if (!issue || issue.tags.length === 0) return "";

  const validLabels = new Set(INTERVENTION_TYPES.map((t) => t.label));
  const lines: string[] = [];
  for (const tag of issue.tags) {
    if (!validLabels.has(tag)) continue;
    const mapping = INTERVENTION_TYPE_AGENTS[tag];
    if (!mapping) continue;
    if (mapping.primary.includes(agentName)) {
      lines.push(`- 「${tag}」はこのIssueに設定された介入の型です。あなたが主担当として、この介入型を主軸に検討してください。`);
    } else if (mapping.secondary.includes(agentName)) {
      lines.push(`- 「${tag}」はこのIssueに設定された介入の型です。あなたは副担当のため、主担当エージェントの観点を補う形で検討してください。`);
    }
  }
  if (lines.length === 0) return "";
  return ["このタスクに設定された介入の型（絶対の前提として扱うこと）:", ...lines].join("\n");
}

export type LogLine = {
  ts: number;
  channel: "meta" | "agent" | "system";
  text: string;
};

export type AgentRun = {
  id: string;
  agentName: string;
  task: string;
  status: AgentStatus;
  sessionId?: string;
  // docs/memo.md「Claude Codeが使えない場合はagy経由でフォールバックする」対応。
  // agyの会話継続（--conversation）はclaudeのsessionIdとは別のID空間なので分けて持つ。
  agyConversationId?: string;
  // docs/memo.md「サポートするAIエージェントCLIにCursor CLIを追加する」対応。
  // cursor-agentの会話継続（--resume）もclaude/agyとは別のID空間なので分けて持つ。
  cursorSessionId?: string;
  log: LogLine[];
  yieldRequest?: YieldRequest;
  proposal?: Proposal;
  // docs/first_implession 3.8「壁打ちによるState更新」対応。AIが提案するAction Itemsの
  // 下書き。EMが個別に「採用」するまでIssue.actionItemsには反映されない。
  suggestedActionItems?: string[];
  // docs/memo.md「K. ズームイン／ズームアウトの協働計画」対応。トップレベルIssueが
  // 抽象的すぎると判断した場合にAIが提案する、具体的な子Issue案の下書き。EMが個別に
  // 「採用」するまで実際のサブIssueは作られない（action_itemsと同じHuman-in-the-Loop）。
  suggestedSubIssues?: string[];
  // ユーザー依頼「Journal等からIssueを生成する際、AIエージェントチームに内容を埋めさせる」
  // 対応。紐づくIssueのWhy/What/Howのうち未整理の項目をAIが埋める提案の下書き。
  // suggestedActionItems/suggestedSubIssuesと同じくEMが「採用」するまでIssue.charterへは
  // 反映しない（Human-in-the-Loopを維持）。埋める提案がある項目のみキーを持つ。
  suggestedCharter?: Partial<IssueCharter>;
  totalCostUsd: number;
  createdAt: number;
  updatedAt: number;
  // docs 3.3「階層型マルチエージェント」用。Lead Agentが専門エージェントに相談した際、
  // 相談先のrunにはconsultedBy（相談元のLead run id）を付与し、EM向けの表示で
  // 「誰から相談されたrunか」を追跡できるようにする。pendingConsultは
  // handleStreamEventからrunClaudeTurnへ「相談したい」を伝えるための一時フィールドで、
  // 外部からは基本的に参照しない。
  consultedBy?: string;
  pendingConsult?: ConsultRequest;
  // docs/first_implession 3.6「トリガー（起動条件）: イベント駆動・バッチ駆動・人間駆動」対応。
  // 既定の"manual"はこれまで通りEM/Issue経由での起動。"auto-anomaly"はJournalの高緊急度
  // エントリをきっかけにした自動分析、"auto-summary"は朝のバッチサマリー。
  // reviewedはAI主導（"manual"以外）のrunに限り意味を持つ——EMがまだ内容を確認していない
  // 間はDashboardの「次にすべきこと」に居座らせ、見て見ぬふりをできないようにする。
  origin: "manual" | "auto-anomaly" | "auto-summary";
  reviewed: boolean;
  // docs/memo.md「B. 何でも相談↔Issueの昇格物語」対応。reviewed（bool）だけでは
  // 「様子見」（追跡は続けるが緊急ではない）と「却下」（対応不要）を区別できないため、
  // 明示的にEMが選んだ場合のみ値が入る別フィールドとして持つ。
  triageStatus?: "watching" | "dismissed";
  // docs/em_human_story_and_ux.md P0-3対応。triageStatusを設定した時刻。「様子見」が
  // 期限切れ（WATCH_RESURFACE_AFTER_MS超）になったら「次にすべきこと」へ再浮上させる判定に使う。
  triageAt?: number;
};

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
  total_cost_usd: number;
  created_at: number;
  updated_at: number;
  consulted_by: string | null;
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
        (id, agent_name, task, status, session_id, agy_conversation_id, cursor_session_id, yield_request_json, proposal_json, suggested_action_items_json, suggested_sub_issues_json, suggested_charter_json, total_cost_usd, created_at, updated_at, consulted_by, origin, reviewed, triage_status, triage_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      run.totalCostUsd,
      run.createdAt,
      run.updatedAt,
      run.consultedBy ?? null,
      run.origin,
      run.reviewed ? 1 : 0,
      run.triageStatus ?? null,
      run.triageAt ?? null,
    );
}

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
      suggestedSubIssues: row.suggested_sub_issues_json ? JSON.parse(row.suggested_sub_issues_json) : undefined,
      suggestedCharter: row.suggested_charter_json ? JSON.parse(row.suggested_charter_json) : undefined,
      totalCostUsd: row.total_cost_usd,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      consultedBy: row.consulted_by ?? undefined,
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

const runs = loadRunsFromDb();

// docs/memo.md TODO「動いていると思ったら止まっていた、を防ぐ」対応の実体。
// 生きている子プロセスをrun.idで引けるようにしておき、watchdog（下記）がハングした
// プロセスを実際にkillできるようにする。プロセス自体はメモリ上にしか存在しないため
// 永続化しない（サーバー再起動時は上のpersistedRuns変換で"error"に倒される）。
const liveProcesses = new Map<string, ReturnType<typeof spawn>>();

// "active"のままログ更新（updatedAt）が長時間無いrunを見つけ、ハングした子プロセスとして
// 強制終了する自己修復の仕組み。「応答なしの表示」自体はクライアント側でisRunStale()を使い
// 実プロセスをkillせずに警告するが、それよりさらに長い時間放置されたものはゾンビプロセス化を
// 防ぐためここで実際に終了させる。killしても状態遷移は既存のchild.on("close")に任せる
// （二重に状態を書き換えず、実際にプロセスが終了したタイミングで確定させるため）。
const WATCHDOG_INTERVAL_MS = 30_000;

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

// docs/first_implession 3.6「トリガー（起動条件）: バッチ駆動（朝のサマリー）」対応。
// 専用のジョブスケジューラは導入せず、既存のwatchdog間隔に相乗りする軽量な実装。
// ユーザー指摘「朝のサマリーのログが大量に並んでいる」対応（原因調査の結果）:
// 以前はこの「今日はもう作った」ガードをモジュール内の変数だけで持っていたため、
// サーバー再起動はもちろん、開発サーバー（next dev）がファイル変更のたびに
// このモジュールをホットリロードするだけでもガードがリセットされ、リロードのたびに
// 朝のサマリーRunが重複生成されてしまっていた。`.data/auto-morning-summary.json`へ
// 永続化することで、再起動・ホットリロードをまたいでも「今日は既に生成済み」を
// 正しく覚えておくようにする。
function loadLastAutoMorningSummaryDate(): string | null {
  return loadJSON<{ date: string | null }>("auto-morning-summary.json", { date: null }).date;
}

function saveLastAutoMorningSummaryDate(date: string): void {
  saveJSON("auto-morning-summary.json", { date });
}

let lastAutoMorningSummaryDate: string | null = loadLastAutoMorningSummaryDate();

export function todayDateString(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function checkMorningSummary(): void {
  const { autoMorningSummaryEnabled, autoMorningSummaryHour } = getRulesAndConstraints();
  if (!autoMorningSummaryEnabled) return;
  const now = new Date();
  if (now.getHours() < autoMorningSummaryHour) return;
  const today = todayDateString(now);
  if (lastAutoMorningSummaryDate === today) return;
  lastAutoMorningSummaryDate = today;
  saveLastAutoMorningSummaryDate(today);
  void startRun(
    "Lead Agent",
    "朝のサマリーを作成してください。Team Vitals・1on1 Coverage・判断待ち(Yield)やエラーのAgent Run・Why/What/Howが未整理のIssueなど、今日EMがまず確認すべきことを簡潔に整理してください。",
    "auto-summary",
  ).catch(() => {
    // 自動サマリーの起動失敗は無視する（次のwatchdog tickで日付が変わらない限り再試行はしない）。
  });
}

let watchdogStarted = false;
function ensureWatchdogStarted(): void {
  if (watchdogStarted) return;
  watchdogStarted = true;
  setInterval(() => {
    checkStaleRuns();
    checkMorningSummary();
  }, WATCHDOG_INTERVAL_MS);
}
ensureWatchdogStarted();

const PER_TURN_BUDGET_USD = "0.5";

// agy（複数モデル対応CLI）経由でのGeminiフォールバックに使うモデル。agyのモデル一覧は
// バージョン付きの名前（例: gemini-3.6-flash-medium）でしか指定できず、汎用エイリアスは
// 無いことを実機で確認済み。将来モデルが更新されたら定数を差し替える想定
// （local-model.tsのMODEL_ID/MODEL_DTYPEと同じ考え方）。
const AGY_GEMINI_MODEL = "gemini-3.6-flash-medium";

// docs/memo.md「サポートするAIエージェントCLIにCursor CLIを追加する」対応。
// cursor-agentも複数モデルに対応するマルチモデルCLIで、汎用モデル名（コーディング特化で
// ない一般的なモデル）として"gpt-5.2"を使う。`--mode ask`は実機確認済みで
// 書き込み・シェル実行を拒否する（安全側）が、Glob/Read等の読み取り専用ツールは
// 承認無しで実行してしまうため、`--workspace`で空の専用ディレクトリに限定し、
// 万一読み取りツールが呼ばれてもこのアプリのソース・`.data`が見えないようにする。
const CURSOR_MODEL = "gpt-5.2";
const CURSOR_WORKSPACE_DIR = dataFilePath("cursor-sandbox");
mkdirSync(CURSOR_WORKSPACE_DIR, { recursive: true });

// docs 3.1「動的ロード」対応（docs/em_human_story_and_ux.md P2-13で残件を解消）。
// 紐づくIssueのteamId、またはタスク本文中のチーム名の言及という手がかりがあれば
// Organization Context（チーム名簿）を関連チームだけに絞る（buildOrgContextBlock内の
// relevantTeams参照）。手がかりが一つも無い場合だけ、MVP当初の方針どおり全チームを注入する。
// メンバー名はここで初めて登場する可能性があるため、注入前に必ずpeople-directoryへ登録し、
// 実名のままクラウドに出さないようmaskNamesを通す（他の経路と同じ匿名化ルール）。
// docs 3.1「Core Context」の`Strategy/`ディレクトリ相当。MVV/OKRは組織全体で
// 1つの静的な前提であり、Issueに紐づくかどうかに関わらず常に「絶対の前提」として注入する
// （動的ロード対象はIssue charterとJournalのみ）。未設定の項目は行ごと省略する。
// 個人情報の分離（ユーザー指摘対応）: org-context-store.tsはMission/Vision/Values/OKRを
// 既にPERSON_n IDでマスクした状態で保持している（保存前にmaskForStorageを通す設計に変更）。
// そのためここではmaskNamesを呼ばない——呼ぶ必要が無いのではなく、呼んではいけない
// （既にマスク済みのIDをもう一度maskNamesに通しても実害は無いが、「保存時点で安全」が
// 構造的に保証されているという前提を明確にするため、送信直前のマスク処理は撤去した）。
export function buildStrategyBlock(): string {
  const strategy = getOrgStrategy();
  const lines: string[] = [];
  if (strategy.mission) lines.push(`Mission: ${strategy.mission}`);
  if (strategy.vision) lines.push(`Vision: ${strategy.vision}`);
  if (strategy.values) lines.push(`Values: ${strategy.values}`);
  if (lines.length === 0) return "";
  return ["組織のMVV（Organization Context / Strategy、絶対の前提として扱うこと）:", ...lines].join("\n");
}

// docs/memo.md「H. 戦略→Issue→結果の一本線」対応。以前は自由記述のOKRだった部分を、
// Objective/KeyResultの構造化データから組み立てる。進捗（何件完了か）はEMが画面で見る
// ものであり、エージェントへの前提としては「今期何を目指し、何が主要な結果か」という
// 構造だけで十分なため、ここでは件数計算はしない。
// docs/agent_specialization.md「5.3 象限ごとの厚み」対応。同じObjectives/KRという
// 事実は全エージェントに渡す（コアは共通のまま）が、前置き文だけを変えて
// 「判断の主軸にすべきか、参考程度か」という重み付けの差をつける。事実そのものを
// 隠すと判断材料が欠けるため、削るのではなく強調の度合いだけを変える。
function objectivesBlockIntro(agentName: string): string {
  if (agentName === "Product Agent" || agentName === "Lead Agent") {
    return "組織の今期Objective/Key Results（あなたの判断の主軸としてください。Organization Context / Strategy、絶対の前提として扱うこと）:";
  }
  if (agentName === "People Agent") {
    return "組織の今期Objective/Key Results（参考情報。人物・関係性の判断を優先してください。Organization Context / Strategy）:";
  }
  return "組織の今期Objective/Key Results（Organization Context / Strategy、絶対の前提として扱うこと）:";
}

export function buildObjectivesBlock(agentName: string): string {
  const objectives = listObjectives();
  if (objectives.length === 0) return "";
  const lines = objectives.map((o) => {
    const krs = o.keyResults.length > 0 ? o.keyResults.map((k) => `KR: ${k.title}`).join(" / ") : "(Key Result未設定)";
    return `- ${o.title} — ${krs}`;
  });
  return [objectivesBlockIntro(agentName), ...lines].join("\n");
}

// docs/em_human_story_and_ux.md P2-13（docs 3.1「動的ロード」の残件）対応。
// チーム憲法（buildTeamCharterBlock）は既にIssue単位でスコープ済みだが、チーム名簿
// （名前＋メンバー一覧）自体は「チーム数が少ない前提」で常に全件注入していた。
// 関連性の手がかり（紐づくIssueのteamId、タスク本文中のチーム名の言及）が
// 1つも無い場合は絞り込みようがないため、当初のMVP方針どおり全件にフォールバックする
// （手がかりが無いのに一部だけ見せると、かえって判断材料が欠けて混乱させるため）。
// 手がかりがある場合だけ、関連するチームに絞る。
export function relevantTeams(teams: Team[], runId: string | undefined, rawText: string | undefined): Team[] {
  const relevantIds = new Set<string>();

  const linkedTeamId = runId ? getIssueByRunId(runId)?.teamId : undefined;
  if (linkedTeamId) relevantIds.add(linkedTeamId);

  if (rawText) {
    for (const t of teams) {
      const segments = [t.name, ...teamPathSegments(t.name)];
      if (segments.some((seg) => seg && rawText.includes(seg))) relevantIds.add(t.id);
    }
  }

  if (relevantIds.size === 0) return teams;
  return teams.filter((t) => relevantIds.has(t.id));
}

// 同様にorg-context-store.tsはmembersをPERSON_n IDで保持しているため、registerName/
// maskNamesはもう不要（メンバー名はチーム作成・編集の時点で既にIDへ変換済み）。
export function buildOrgContextBlock(runId?: string, rawText?: string): string {
  const teams = listActiveTeams();
  if (teams.length === 0) return "";
  const scoped = relevantTeams(teams, runId, rawText);

  const lines = scoped.map((t) => `- ${teamDisplayName(t.name)}: ${t.members.length > 0 ? t.members.join(", ") : "(メンバー未登録)"}`);
  return ["組織のチーム構成（Organization Context、絶対の前提として扱うこと）:", ...lines].join("\n");
}

// docs 3.1「動的ロード」: そのrunがIssueに紐づいている場合、Issueのタイトルと
// charter（Why/What/How）を「絶対の前提」としてエージェントに渡す。docs/first_implession
// のIssue Workspaceが目指していた「壁打ちがIssueの文脈を踏まえる」ことの実体化。
// charterが3項目とも空（未整理）のIssueなら、渡す情報が無いのでブロック自体を省略する
// （空の前提を渡して混乱させないため）。
export function buildIssueContextBlock(runId: string): string {
  const issue = getIssueByRunId(runId);
  if (!issue) return "";
  const { why, what, how } = issue.charter;
  if (!why && !what && !how && issue.tags.length === 0) return "";

  // issue-store.tsはtitle/charterをPERSON_n IDでマスクした状態で保持しているため、
  // ここでmaskNamesを呼ぶ必要は無い（既に安全）。
  const lines = ["このタスクが紐づくIssueの前提（絶対の前提として扱うこと）:", `タイトル: ${issue.title}`];
  if (why) lines.push(`Why（生む価値・誰のため・なぜ今か）: ${why}`);
  if (what) lines.push(`What（何を・どこまで・どのくらい・完了の定義）: ${what}`);
  if (how) lines.push(`How（どのように実現するか・前提や制約）: ${how}`);
  if (issue.tags.length > 0) lines.push(`タグ: ${issue.tags.join(", ")}`);
  return lines.join("\n");
}

// docs/memo.md「I. チーム単位の憲法（ミッション／制約）」対応。buildOrgContextBlockが
// 全チームの名簿を常時注入するのに対し、こちらは「そのIssueが紐づくチーム」1つだけの
// Mission/制約を動的にロードする（docs/memo.md TODO「Organization Contextの動的ロードを
// 対象Issueに関連するチームのみに絞る」に対応する部分）。Mission/制約が両方未設定なら
// 渡す情報が無いのでブロック自体を省略する。
export function buildTeamCharterBlock(runId: string): string {
  const issue = getIssueByRunId(runId);
  if (!issue?.teamId) return "";
  const team = getTeam(issue.teamId);
  if (!team) return "";
  const { mission, constraints } = team.charter;
  if (!mission && !constraints) return "";

  const lines = [`このタスクが紐づくチームの前提（${teamDisplayName(team.name)}、絶対の前提として扱うこと）:`];
  if (mission) lines.push(`Mission: ${mission}`);
  if (constraints) lines.push(`制約: ${constraints}`);
  return lines.join("\n");
}

// docs 3.1「動的ロード」: タスク/EMの発言に登場する人物（people-directoryに登録済み＝
// 過去にJournalで言及されたか、Org Contextのメンバーとして登録された人）について、
// その人に関する直近のJournalエントリを参考情報として渡す。全Journalを渡すと
// ノイズが増え推論がブレるため、「今回の話題に出てきた人」だけに絞るのが「動的」の要点。
// 実名でのマッチングが必要なため、maskNamesで置換する前のテキストに対して行うこと。
// docs/memo.md「H: 永続化データモデルの設計」対応。「ファクト（一時的な出来事・発言）」と
// 「解釈（長期的なプロファイル）」を分けて注入する。ファクトはTTLを過ぎたものを除外し
// （listActiveFactsForPerson）、解釈は基本的に常に有効（listInterpretationsForPerson）。
// この2つを別々のラベルでプロンプトに渡すことで、エージェントが「一時的な感情」と
// 「長期的な傾向」を混同しないようにする。
// docs/memo.md「H: Phase 3」ローカル完結のベクトル検索。名前の完全一致では拾えない
// 「意味的に関連しそうな過去の情報」（例: 具体的な名前を出さずに「最近チームの士気は？」と
// 聞かれた場合等）を補う。名前一致より確度が低いため、別ラベル・低い信頼度の書き方で
// 提示し、類似度が低いものは足切りする（無関係な情報を紛れ込ませないため）。
const SEMANTIC_SIMILARITY_THRESHOLD = 0.4;

// docs/agent_specialization.md「5.3 象限ごとの厚み」対応。Peopleは「言及人物の解釈
// （長期プロファイル）を多め、直近Journalのsentiment/urgencyを厚く」が期待値、
// Process/Tech/Product/Leadは「個人解釈の長文すべて／人物性格の深掘りは薄くてよい」が
// 期待値（表5.3）。完全に隠すと判断材料が欠けるため、削るのではなく件数だけを絞る。
const PERSON_FACT_LIMIT_DEFAULT = 5;
const PERSON_FACT_LIMIT_PEOPLE = 10;
const PERSON_INTERPRETATION_LIMIT_NON_PEOPLE = 3;

// 個人情報の分離（ユーザー指摘対応）: rawTextは実名（EM/クラウドどちらの入力の場合もある）
// またはPERSON_n ID（Lead Agentからのconsult.questionのように既にマスクされたテキストの
// 場合）のどちらかを含み得るため、両方でマッチングする。listActiveFactsForPerson等は
// 既にPERSON_n IDで検索する契約になっているため、person.id（実名ではない）を渡す。
async function buildJournalContextBlock(rawText: string, agentName: string): Promise<string> {
  const mentioned = listPeople().filter((p) => rawText.includes(p.name) || rawText.includes(p.id));
  const isPeopleAgent = agentName === "People Agent";
  const factLimit = isPeopleAgent ? PERSON_FACT_LIMIT_PEOPLE : PERSON_FACT_LIMIT_DEFAULT;

  const factLines: string[] = [];
  const interpretationLines: string[] = [];
  let omittedInterpretationCount = 0;
  const seenIds = new Set<string>();
  for (const person of mentioned) {
    for (const e of listActiveFactsForPerson(person.id, factLimit)) {
      seenIds.add(e.id);
      factLines.push(`- [${person.id}] ${e.text}（タグ: ${e.tags.join(", ") || "なし"} / 緊急度: ${e.urgency ?? "-"} / 感情: ${e.sentiment ?? "-"}）`);
    }
    const interpretations = listInterpretationsForPerson(person.id);
    const capped = isPeopleAgent ? interpretations : interpretations.slice(0, PERSON_INTERPRETATION_LIMIT_NON_PEOPLE);
    omittedInterpretationCount += interpretations.length - capped.length;
    for (const e of capped) {
      seenIds.add(e.id);
      interpretationLines.push(`- [${person.id}] ${e.text}`);
    }
  }

  const semanticLines: string[] = [];
  try {
    const queryEmbedding = await embedText(rawText);
    const similarFacts = searchSimilarEvents(queryEmbedding, { kind: "fact", limit: 3 });
    const similarInterpretations = searchSimilarEvents(queryEmbedding, { kind: "interpretation", limit: 3 });
    const describe = (e: KnowledgeEvent & { similarity: number }) =>
      `- ${e.text}${e.people.length > 0 ? `（${e.people.join(", ")}）` : ""}（類似度: ${e.similarity.toFixed(2)}）`;
    for (const e of [...similarFacts, ...similarInterpretations]) {
      if (seenIds.has(e.id) || e.similarity < SEMANTIC_SIMILARITY_THRESHOLD) continue;
      seenIds.add(e.id);
      semanticLines.push(describe(e));
    }
  } catch {
    // 埋め込み生成に失敗しても、名前一致の結果だけで動的ロード自体は継続する。
  }

  if (factLines.length === 0 && interpretationLines.length === 0 && semanticLines.length === 0) return "";

  const blocks: string[] = [];
  if (interpretationLines.length > 0) {
    const omittedNote = omittedInterpretationCount > 0 ? `。他${omittedInterpretationCount}件は抜粋のため省略（詳細はPeople Agentの専門領域）` : "";
    blocks.push(
      [
        `長期的なプロファイル・解釈（TTLなし、訂正されるまで有効。一時的な感情と混同しないこと${omittedNote}）:`,
        ...interpretationLines,
      ].join("\n"),
    );
  }
  if (factLines.length > 0) {
    blocks.push(
      ["直近の一時的な状況（Journal、有効期限内のもののみ。あくまで参考情報として扱うこと）:", ...factLines].join("\n"),
    );
  }
  if (semanticLines.length > 0) {
    blocks.push(
      [
        "意味的に関連する可能性のある過去の情報（ベクトル検索による推測、名前の完全一致ではないため確度は低い。参考程度に留めること）:",
        ...semanticLines,
      ].join("\n"),
    );
  }
  return maskNames(blocks.join("\n\n"));
}

export function buildSystemPrompt(
  agentName: string,
  allowConsult: boolean,
  runId?: string,
  journalContext?: string,
  rawText?: string,
): string {
  const consultRule =
    agentName === "Lead Agent" && allowConsult
      ? [
          "- あなたはリードエージェントとして、必要なら専門エージェント（People Agent / Process Agent / Tech Agent / Product Agent）のうち1つ以上に、1ターンにつき1回だけ相談できます。複数の専門性にまたがる論点なら、複数の専門エージェントに同時に（並行して）相談し、それぞれの回答を踏まえて結論を出してください。",
          ...CONSULT_ROUTING_TABLE,
          "  自分（たち）の専門外の知識が結論の質を左右すると判断した場合、proposal/yieldの代わりに以下の形式でconsultブロックを1つだけ出力してください（相談は1回のみ。2回目以降は使えません）。",
          "  ```consult",
          '  { "agents": ["People Agent", "Tech Agent"], "question": "相談内容の要約（ログ用。questionsを省略したagentにはこの文面がそのまま送られます）", "questions": { "People Agent": "People Agent宛の質問（人物面だけを聞く）", "Tech Agent": "Tech Agent宛の質問（技術要因だけを聞く）" } }',
          "  ```",
          '  agentsには "People Agent" / "Process Agent" / "Tech Agent" / "Product Agent" のうち1つ以上を、本当に必要な専門性だけに絞って指定してください（無関係なエージェントを含めるとコストが無駄に増えます）。',
          '  questionsは任意ですが、同じ長文タスクを丸投げしないため強く推奨します。agentsに含まれるエージェントごとに「その専門性だけで答えられる問い」を1文で書き分けてください（例: 「Peopleには人物面だけ、Processには流れの詰まりだけ」）。questionsで指定しなかったagentにはquestionがそのまま使われます。',
          "",
        ]
      : [];

  // docs/first_implession 3.8「壁打ちによるState更新: AIからのサジェストによってIssueの
  // 状態（タスクリスト）を直接・動的に上書きできる仕組み」対応。Issueに紐づくタスクの場合
  // だけ、Action Itemsの下書きを提案できるようにする。EMが「採用」を押すまでは
  // 提案のままで、Action Items自体は書き換わらない（Human-in-the-Loopを維持）。
  const actionItemsRule =
    runId && getIssueByRunId(runId)
      ? [
          "- このタスクはIssueに紐づいています。結論を踏まえて次にやるべき具体的な作業（Action Item）があれば、proposalブロックの直後に以下の形式でaction_itemsブロックを追加してください（無ければ省略して構いません。yieldする場合は出力しないこと）。",
          "```action_items",
          '["具体的な作業1", "具体的な作業2"]',
          "```",
          "",
        ]
      : [];

  // docs/memo.md「K. ズームイン／ズームアウトの協働計画」対応。トップレベルのIssue
  // （子Issueは1階層制限のため、さらに分解できない）に紐づく場合だけ、抽象的すぎる
  // 課題を具体的な子Issue案に分解する提案を許可する。action_itemsと同じく、EMが
  // 「採用」を押すまで実際のサブIssueは作られない（Human-in-the-Loopを維持）。
  const linkedIssueForSubIssues = runId ? getIssueByRunId(runId) : undefined;
  const subIssuesRule =
    linkedIssueForSubIssues && !linkedIssueForSubIssues.parentId
      ? [
          "- このタスクが紐づくIssueが抽象的で、複数の具体的な子Issueに分解した方が計画・実行しやすいと判断した場合は、proposal/action_itemsブロックに続けて以下の形式でsub_issuesブロックを追加してください（分解の必要が無ければ省略して構いません。yieldする場合は出力しないこと）。",
          "```sub_issues",
          '["具体的な子Issue案1", "具体的な子Issue案2"]',
          "```",
          "",
        ]
      : [];

  // ユーザー依頼「Journal等からIssueを生成する際、AIエージェントチームに内容を埋めさせる」
  // 対応。action_items/sub_issuesと同じ形式で、紐づくIssueのWhy/What/Howのうち
  // 未整理（空欄）の項目だけを埋める提案を許可する。既に書かれている項目を上書き提案しない
  // のは、EMが既に整理した内容をAIが勝手に書き換えたと誤解しないようにするため。
  const linkedIssueForCharter = runId ? getIssueByRunId(runId) : undefined;
  const missingCharterFields = linkedIssueForCharter
    ? (["why", "what", "how"] as const).filter((k) => !linkedIssueForCharter.charter[k])
    : [];
  const charterRule =
    linkedIssueForCharter && missingCharterFields.length > 0
      ? [
          `- このタスクが紐づくIssueは、Why/What/Howのうち次の項目が未整理です: ${missingCharterFields.join(", ")}。与えられた前提から埋められるものがあれば、proposal/action_items/sub_issuesブロックに続けて以下の形式でcharterブロックを追加してください（未整理のうち埋められる項目だけを含め、既に書かれている項目・埋められない項目はキー自体を含めないこと。1つも埋められなければ省略して構いません。yieldする場合は出力しないこと）。`,
          "```charter",
          '{ "why": "生む価値・誰のため・なぜ今か", "what": "何を・どこまで・どのくらい・完了の定義", "how": "どのように実現するか・前提や制約" }',
          "```",
          "",
        ]
      : [];

  const roleBlockLines = ROLE_BLOCKS[agentName] ?? [];
  const roleBlock =
    roleBlockLines.length > 0
      ? [...roleBlockLines, ...(agentName === "Lead Agent" ? [] : [SPECIALIST_ROLE_TAIL]), ""]
      : [];

  const base = [
    `あなたはEM(エンジニアリングマネージャー)支援システムの一部として動作する「${agentName}」です。`,
    "与えられたタスクの文脈だけを判断材料とし、実際の外部システムやファイルには一切アクセスできません（ツールは無効化されています）。",
    "",
    ...roleBlock,
    "回答のルール:",
    ...consultRule,
    "- タスクを完結できる場合（yieldしない場合）は、通常の文章で説明したうえで、回答の最後に必ず以下の形式でproposalブロックを1つだけ出力してください。",
    "",
    "proposalブロックのフォーマット（このとおりのfenced code blockにすること）:",
    "```proposal",
    "{",
    '  "conclusion": "結論（一文で）",',
    '  "facts": ["判断の根拠にした参照ファクト（与えられた情報の中から）"],',
    '  "logic": "その結論に至った判断ロジック",',
    '  "rejectedAlternatives": [ { "option": "検討したが採用しなかった案", "reason": "棄却理由" } ]',
    "}",
    "```",
    "棄却した代替案が無い場合は rejectedAlternatives: [] としてください。ブラックボックスの提案は禁止です。",
    ...actionItemsRule,
    ...subIssuesRule,
    ...charterRule,
    "",
    "- 次のいずれかに該当し、人間(EM)の判断や情報がなければ先に進めない場合は、proposalブロックの代わりに、回答の最後に必ず以下の形式でyieldブロックを1つだけ出力してください（yieldとproposalを同時に出さないこと）。",
    "  1. 複数の妥当な選択肢があり、組織の泥臭い文脈に基づく判断が必要なとき",
    "  2. 判断に必須の前提情報が不足しているとき",
    "",
    "yieldブロックのフォーマット（このとおりのfenced code blockにすること。前後に他の文章を混ぜないこと）:",
    "```yield",
    "{",
    '  "reason": "なぜ人間の判断が必要かの説明",',
    '  "options": [',
    '    { "id": "A", "label": "選択肢Aの短い名前", "detail": "説明", "risk": "懸念点" }',
    "  ]",
    "}",
    "```",
    '情報が単に不足しているだけで具体的な選択肢を提示できない場合は "options": [] としてください。',
  ].join("\n");

  const issueContext = runId ? buildIssueContextBlock(runId) : "";
  const interventionTypeGuidance = buildInterventionTypeGuidance(runId, agentName);
  const teamCharterContext = runId ? buildTeamCharterBlock(runId) : "";
  const orgContext = buildOrgContextBlock(runId, rawText);
  const strategyContext = buildStrategyBlock();
  const objectivesContext = buildObjectivesBlock(agentName);
  return [
    base,
    issueContext,
    interventionTypeGuidance,
    teamCharterContext,
    journalContext,
    orgContext,
    strategyContext,
    objectivesContext,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function extractYield(resultText: string): YieldRequest | undefined {
  const match = resultText.match(/```yield\s*\n?([\s\S]*?)```/);
  if (!match) return undefined;
  try {
    const parsed = JSON.parse(match[1].trim());
    if (parsed && typeof parsed.reason === "string") {
      return {
        reason: parsed.reason,
        options: Array.isArray(parsed.options) ? parsed.options : [],
      };
    }
  } catch {
    // 不正なyieldブロックは「yieldなし（通常完了）」として扱う
  }
  return undefined;
}

// docs 3.5「構造化された提案」: 結論・参照ファクト・判断ロジック・棄却した代替案を
// 必ず含めさせる。抽出できない（規約に従わなかった）場合はundefinedを返し、
// UI側は素のテキストログのみを表示する（無理に構造化して見せない）。
export function extractProposal(resultText: string): Proposal | undefined {
  const match = resultText.match(/```proposal\s*\n?([\s\S]*?)```/);
  if (!match) return undefined;
  try {
    const parsed = JSON.parse(match[1].trim());
    if (parsed && typeof parsed.conclusion === "string" && typeof parsed.logic === "string") {
      return {
        conclusion: parsed.conclusion,
        facts: Array.isArray(parsed.facts) ? parsed.facts.filter((f: unknown) => typeof f === "string") : [],
        logic: parsed.logic,
        rejectedAlternatives: Array.isArray(parsed.rejectedAlternatives)
          ? parsed.rejectedAlternatives.filter(
              (r: unknown): r is RejectedAlternative =>
                typeof r === "object" && r !== null && typeof (r as RejectedAlternative).option === "string",
            )
          : [],
      };
    }
  } catch {
    // 不正なproposalブロックは構造化なしとして扱う
  }
  return undefined;
}

// docs/first_implession 3.8対応。AIが提案するAction Itemsの下書き。EMが個別に採用する
// までIssue.actionItemsへは反映しない（extractYield/extractProposalと同じ壊れにくい
// パースの考え方: 不正な形式は「提案なし」として扱うだけで、proposal自体は無効にしない）。
export function extractActionItems(resultText: string): string[] | undefined {
  const match = resultText.match(/```action_items\s*\n?([\s\S]*?)```/);
  if (!match) return undefined;
  try {
    const parsed = JSON.parse(match[1].trim());
    if (Array.isArray(parsed)) {
      const items = parsed.filter((i: unknown): i is string => typeof i === "string" && i.trim().length > 0);
      return items.length > 0 ? items : undefined;
    }
  } catch {
    // 不正なaction_itemsブロックは「提案なし」として扱う
  }
  return undefined;
}

// docs/memo.md「K. ズームイン／ズームアウトの協働計画」対応。AIが提案する子Issue分解案。
// extractActionItemsと同じ壊れにくいパースの考え方（不正な形式は「提案なし」として扱う）。
export function extractSubIssues(resultText: string): string[] | undefined {
  const match = resultText.match(/```sub_issues\s*\n?([\s\S]*?)```/);
  if (!match) return undefined;
  try {
    const parsed = JSON.parse(match[1].trim());
    if (Array.isArray(parsed)) {
      const items = parsed.filter((i: unknown): i is string => typeof i === "string" && i.trim().length > 0);
      return items.length > 0 ? items : undefined;
    }
  } catch {
    // 不正なsub_issuesブロックは「提案なし」として扱う
  }
  return undefined;
}

// ユーザー依頼「Journal等からIssueを生成する際、AIエージェントチームに内容を埋めさせる」
// 対応。AIが提案するWhy/What/Howの埋め合わせ案。extractActionItems/extractSubIssuesと
// 同じ壊れにくいパースの考え方（不正な形式は「提案なし」として扱う）。why/what/how以外の
// キー・空文字列の値は無視し、1つも有効な値が残らなければ「提案なし」とする。
export function extractCharter(resultText: string): Partial<IssueCharter> | undefined {
  const match = resultText.match(/```charter\s*\n?([\s\S]*?)```/);
  if (!match) return undefined;
  try {
    const parsed = JSON.parse(match[1].trim());
    if (!parsed || typeof parsed !== "object") return undefined;
    const result: Partial<IssueCharter> = {};
    for (const key of ["why", "what", "how"] as const) {
      const value = (parsed as Record<string, unknown>)[key];
      if (typeof value === "string" && value.trim()) result[key] = value.trim();
    }
    return Object.keys(result).length > 0 ? result : undefined;
  } catch {
    // 不正なcharterブロックは「提案なし」として扱う
  }
  return undefined;
}

// docs 3.3「階層型マルチエージェント」/ docs/memo.md「M」: Lead Agentが1体以上の
// 専門エージェントに並行相談したい場合の合図。agentsは重複除去し、SPECIALIST_AGENTSに
// 含まれない値・空配列は不正なブロックとして扱う（相談なしにフォールバック）。
// docs/agent_specialization.md 段階5対応。questionsはagentName→個別質問の任意マップ。
// キーがagentsに含まれない・SPECIALIST_AGENTS外・値が文字列でない場合はそのエントリだけ
// 無視する（consultブロック全体を不正扱いにはしない）。
export function extractConsult(resultText: string): ConsultRequest | undefined {
  const match = resultText.match(/```consult\s*\n?([\s\S]*?)```/);
  if (!match) return undefined;
  try {
    const parsed = JSON.parse(match[1].trim());
    if (!parsed || typeof parsed.question !== "string") return undefined;
    const rawAgents: unknown[] = Array.isArray(parsed.agents) ? parsed.agents : typeof parsed.agent === "string" ? [parsed.agent] : [];
    const agents = Array.from(new Set(rawAgents.filter((a): a is string => typeof a === "string" && SPECIALIST_AGENTS.includes(a))));
    if (agents.length === 0) return undefined;

    let questions: Record<string, string> | undefined;
    if (parsed.questions && typeof parsed.questions === "object") {
      const entries = Object.entries(parsed.questions as Record<string, unknown>).filter(
        (entry): entry is [string, string] =>
          typeof entry[1] === "string" && entry[1].trim().length > 0 && agents.includes(entry[0]),
      );
      if (entries.length > 0) questions = Object.fromEntries(entries);
    }

    return { agents, question: parsed.question, questions };
  } catch {
    // 不正なconsultブロックは相談なしとして扱う
  }
  return undefined;
}

// docs/agent_specialization.md 段階5対応。指定agentへの個別質問があればそれを、
// 無ければ共通questionにフォールバックする（後方互換）。
export function consultQuestionFor(consult: ConsultRequest, agentName: string): string {
  return consult.questions?.[agentName] ?? consult.question;
}

function appendLog(run: AgentRun, channel: LogLine["channel"], text: string) {
  const line: LogLine = { ts: Date.now(), channel, text };
  run.log.push(line);
  run.updatedAt = line.ts;
  insertRunLog(run.id, line);
  persistRunMeta(run);
}

// 個人情報の分離（ユーザー指摘対応）: 名前検出＋マスクの実処理はpeople-directory.tsの
// maskForStorage()に一本化した（agent-runtime.ts固有のロジックとしては持たない）。
// ここでは「マスクが実際に何か変えたらEMにその旨をログで知らせる」責務だけを持つ。
async function sanitizeForCloud(run: AgentRun, text: string): Promise<string> {
  const masked = await maskForStorage(text);
  if (masked !== text) {
    appendLog(run, "meta", "送信前に人物名を匿名化しました（人物名はローカルのみで保持）");
  }
  return masked;
}

// 個人情報の分離（ユーザー指摘対応）: クラウドが返すテキストは、渡したプロンプトが
// PERSON_n IDでマスクされている以上、常にPERSON_n IDのままである（クラウドが実名を
// 新たに生成することはあり得ない）。そのため、ここでは意図的にunmaskNamesを呼ばず、
// マスクされたままrun.log/yieldRequest/proposal等へ保存する。実名への復元は、EM向けの
// API応答を組み立てる境界（各APIルート）でだけ行う——保存経路には実名が一切乗らない。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function handleStreamEvent(run: AgentRun, event: any, allowConsult: boolean) {
  switch (event.type) {
    case "assistant": {
      const content = event.message?.content ?? [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const block of content as any[]) {
        if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
          appendLog(run, "agent", block.text.trim());
        }
      }
      break;
    }
    case "result": {
      run.sessionId = event.session_id ?? run.sessionId;
      run.totalCostUsd += typeof event.total_cost_usd === "number" ? event.total_cost_usd : 0;
      if (event.is_error) {
        run.status = "error";
        run.yieldRequest = undefined;
        appendLog(run, "system", `エラーで終了しました: ${event.result ?? "(no message)"}`);
      } else {
        applyAssistantResultText(run, typeof event.result === "string" ? event.result : "", allowConsult);
      }
      break;
    }
    default:
      break;
  }
}

// docs/memo.md TODO「Claude Codeが使えない場合にGemini CLIを使うようにする」対応。
// claude/geminiどちらの結果テキストからも、consult/yield/proposalの抽出とrun状態の
// 確定を同じロジックで行うための共通処理（元は"result"ケースに直書きしていたもの）。
// 個人情報の分離対応: 呼び出し側は「マスクされたまま」のテキストを渡すこと
// （unmaskNamesを通した後のテキストを渡してはいけない——yieldRequest/proposal/
// suggestedActionItemsはそのままSQLiteへ保存されるため、実名が混入する）。
function applyAssistantResultText(run: AgentRun, resultText: string, allowConsult: boolean): void {
  const consultRequest = run.agentName === "Lead Agent" && allowConsult ? extractConsult(resultText) : undefined;
  if (consultRequest) {
    // まだ完了ではない。runClaudeTurn側でpendingConsultを見て相談処理へ進む。
    run.pendingConsult = consultRequest;
    const consultLog = consultRequest.questions
      ? consultRequest.agents.map((a) => `${a}へ: ${consultQuestionFor(consultRequest, a)}`).join(" / ")
      : `${consultRequest.agents.join("・")}に質問: ${consultRequest.question}`;
    appendLog(run, "system", `[相談] ${consultLog}`);
    return;
  }

  const yieldRequest = extractYield(resultText);
  if (yieldRequest) {
    run.status = "yield";
    run.yieldRequest = yieldRequest;
    run.proposal = undefined;
    run.suggestedActionItems = undefined;
    run.suggestedSubIssues = undefined;
    run.suggestedCharter = undefined;
    appendLog(run, "system", `[YIELD] ${yieldRequest.reason}`);
  } else {
    run.status = "idle";
    run.yieldRequest = undefined;
    run.proposal = extractProposal(resultText);
    run.suggestedActionItems = run.proposal ? extractActionItems(resultText) : undefined;
    run.suggestedSubIssues = run.proposal ? extractSubIssues(resultText) : undefined;
    run.suggestedCharter = run.proposal ? extractCharter(resultText) : undefined;
    appendLog(
      run,
      "system",
      run.proposal ? "タスクが完了しました（人間の入力は不要です）。" : "タスクが完了しました（proposal形式には従いませんでした）。",
    );
    if (run.suggestedActionItems) {
      appendLog(run, "system", `[Action Items提案] ${run.suggestedActionItems.length}件`);
    }
    if (run.suggestedSubIssues) {
      appendLog(run, "system", `[サブIssue分解案] ${run.suggestedSubIssues.length}件`);
    }
    if (run.suggestedCharter) {
      appendLog(run, "system", `[Why/What/How提案] ${Object.keys(run.suggestedCharter).length}件`);
    }
  }
}

// AGENT_OPTIONSのうち、Settingsで明示的にagy（Gemini）フォールバックを有効化した
// エージェント種別だけがフォールバック対象になる（既定は全エージェントOFF）。
export function isAgyFallbackEnabled(agentName: string): boolean {
  return getRulesAndConstraints().agyFallbackAgents.includes(agentName);
}

export function isCursorFallbackEnabled(agentName: string): boolean {
  return getRulesAndConstraints().cursorFallbackAgents.includes(agentName);
}

// ユーザー指摘「設定変更時に、それまで起動していなかったエージェントが一気に並列で
// 起動することがある」対応。1回のCLI子プロセス起動（claude/agy/cursor-agentのいずれか）
// をここで数える「枠」で囲み、settings-store.tsのmaxParallelAgentRunsを超える同時起動を
// 防ぐ。1つのrunのターン内でのフォールバック（claude失敗→agy→cursor）は逐次実行のため
// 同時に複数の枠を要求することは無く、Lead Agentのconsultによる並行相談は専門エージェントの
// 数だけ別々に枠を取り合う（上限に達した分だけキューイングされる）。
let activeRunSlots = 0;
const runSlotQueue: Array<() => void> = [];

async function acquireRunSlot(run: AgentRun): Promise<void> {
  const maxParallelAgentRuns = Math.max(1, getRulesAndConstraints().maxParallelAgentRuns);
  if (activeRunSlots < maxParallelAgentRuns) {
    activeRunSlots++;
    run.status = "active";
    return;
  }
  run.status = "queued";
  const position = runSlotQueue.length + 1;
  appendLog(run, "system", `⏳ 同時実行数の上限（${maxParallelAgentRuns}）に達しているため、順番待ちです（現在${position}番目）。`);
  await new Promise<void>((resolve) => runSlotQueue.push(resolve));
  activeRunSlots++;
  run.status = "active";
}

function releaseRunSlot(): void {
  activeRunSlots--;
  const next = runSlotQueue.shift();
  if (next) next();
}

// CLI子プロセスを1回起動する処理（fn）を同時実行数の枠で囲む。枠が空くまではrun.statusが
// "queued"のまま待機し、空いたら"active"に戻してfnを実行する。fn完了後（成功・失敗問わず）は
// 必ず枠を解放し、キュー待ちがいれば次の枠を渡す。
async function withRunSlot<T>(run: AgentRun, fn: () => Promise<T>): Promise<T> {
  await acquireRunSlot(run);
  try {
    return await fn();
  } finally {
    releaseRunSlot();
  }
}

// 個人情報の分離（ユーザー指摘対応）: precomputedPromptを渡された場合はsanitizeForCloudを
// 再度呼ばない。startRun/decideRunは、run.task/ログへ保存する文言自体を「保存前にマスクする」
// ため、既にマスク済みのテキストを持っている——同じテキストに対して二重にローカルNERを
// 走らせる（コスト増）だけでなく、既にPERSON_n ID化された文字列を再度NERにかけると
// 誤検出のリスクもあるため、呼び出し側の結果をそのまま使う。
async function runClaudeTurn(run: AgentRun, rawPrompt: string, allowConsult = true, precomputedPrompt?: string): Promise<void> {
  // 非同期のsanitizeForCloud()を待つ前に同期でactiveへ倒しておく。
  // でないとdecideRun()が呼び出し直後に返すrunの状態がまだ古いまま（yield/idle）になり、
  // 「実行中は入力を受け付けない」というdecideRunの多重実行ガードもすり抜けてしまう。
  run.status = "active";
  run.pendingConsult = undefined;

  // 実名でのマッチングが必要なので、maskNamesで置換される前のrawPromptに対して行う。
  const journalContext = await buildJournalContextBlock(rawPrompt, run.agentName);
  const prompt = precomputedPrompt ?? (await sanitizeForCloud(run, rawPrompt));
  const systemPrompt = buildSystemPrompt(run.agentName, allowConsult, run.id, journalContext, rawPrompt);

  const claudeFailed = await withRunSlot(run, () => runClaudeCliAttempt(run, prompt, systemPrompt, allowConsult));

  // docs/memo.md TODO「Claude Codeが使えない場合にGemini CLIを使うようにする」対応。
  // claude CLIの実行失敗・予算/レート制限のいずれでも（run.statusが"error"になっていれば）
  // トリガーとする。フォールバックはこのエージェント種別で明示的に有効化されている場合のみ。
  // agyは`--conversation`で会話継続できるため、run.agyConversationIdがあればそのまま
  // 引き継げる（claudeのsessionIdとは別のID空間で管理している）。
  if (claudeFailed && isAgyFallbackEnabled(run.agentName)) {
    appendLog(run, "system", "⚠️ claude CLIが利用できなかったため、agy経由でGeminiモデルにこのターンをフォールバックします。");
    await withRunSlot(run, () => runAgyCliAttempt(run, prompt, systemPrompt, allowConsult));
  }

  // docs/memo.md「サポートするAIエージェントCLIにCursor CLIを追加する」対応。
  // claude→agyの順で試した結果、依然として"error"のまま（agyが未有効 or agyも失敗）で、
  // かつこのエージェント種別でCursorフォールバックが有効な場合のみ、最後にcursor-agentを試す。
  if ((run.status as AgentStatus) === "error" && isCursorFallbackEnabled(run.agentName)) {
    appendLog(run, "system", "⚠️ 他のCLIも利用できなかったため、Cursor CLI経由でこのターンをフォールバックします。");
    await withRunSlot(run, () => runCursorCliAttempt(run, prompt, systemPrompt, allowConsult));
  }

  if (run.pendingConsult) {
    const consult = run.pendingConsult;
    run.pendingConsult = undefined;
    await handleConsult(run, consult);
  }
}

// 戻り値はこの試行が失敗した（run.statusが"error"で終わった）かどうか。
// 相談待ち（pendingConsult）は失敗ではない。
function runClaudeCliAttempt(run: AgentRun, prompt: string, systemPrompt: string, allowConsult: boolean): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    // 個人情報の分離の「最後の砦」（ユーザー指摘対応）。ここまでの保存時マスク・
    // クラウド応答の非アンマスク化がすべて正しく機能している前提だが、それに頼らず、
    // 外部プロセスへ渡す直前のテキストそのものを検査する。実名が1件でも残っていたら
    // このrunをerrorにして送信自体を止める（実名をログにも残さない）。
    try {
      assertNoRealNamesLeaked(prompt);
      assertNoRealNamesLeaked(systemPrompt);
    } catch (err) {
      run.status = "error";
      appendLog(run, "system", (err as Error).message);
      resolve(true);
      return;
    }

    const args = [
      "-p",
      prompt,
      "--output-format",
      "stream-json",
      "--verbose",
      "--tools",
      "",
      "--max-budget-usd",
      PER_TURN_BUDGET_USD,
      "--append-system-prompt",
      systemPrompt,
    ];
    if (run.sessionId) {
      args.push("--resume", run.sessionId);
    }

    appendLog(run, "meta", run.sessionId ? "エージェントを再開しています…" : "エージェントを起動しています…");

    let child;
    try {
      child = spawn("claude", args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      run.status = "error";
      appendLog(run, "system", `起動エラー: ${(err as Error).message}`);
      resolve(true);
      return;
    }
    liveProcesses.set(run.id, child);

    let buffer = "";

    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (!line.trim()) continue;
        try {
          handleStreamEvent(run, JSON.parse(line), allowConsult);
        } catch {
          appendLog(run, "system", line);
        }
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8").trim();
      if (text) appendLog(run, "system", `[stderr] ${text}`);
    });

    child.on("close", (code) => {
      liveProcesses.delete(run.id);
      if (buffer.trim()) {
        try {
          handleStreamEvent(run, JSON.parse(buffer), allowConsult);
        } catch {
          appendLog(run, "system", buffer.trim());
        }
      }
      if (run.status === "active" && !run.pendingConsult) {
        run.status = "error";
        appendLog(run, "system", `プロセスが結果を返さずに終了しました (exit code: ${code})`);
      }
      resolve(run.status === "error");
    });

    child.on("error", (err) => {
      liveProcesses.delete(run.id);
      run.status = "error";
      appendLog(run, "system", `起動エラー: ${err.message}`);
      resolve(true);
    });
  });
}

// agy経由でのGeminiフォールバック実行。agyのstream-json出力はclaudeと同じ選択肢名を
// 持つが、実際のイベント構造は別物（{"event": "result", "result": {"status", "response",
// "conversation_id", ...}}等）であることを実機で確認済み。会話継続はagyの
// `--conversation <id>`（claudeの--resumeと違い実際のUUID指定に対応）を使い、
// run.agyConversationIdに保存して次回以降のフォールバックで引き継ぐ。
// 明示的なツール無効化フラグは無いが、非対話（-p）実行中のツール承認はヘッドレスでは
// 自動拒否される（実機で確認済み）ため、claudeの`--tools ""`ほど厳格ではないものの
// 実質的にツールが実行されることはない。--append-system-prompt相当のフラグも無いため、
// システムプロンプトをプロンプト本文の先頭に連結して渡す。
function runAgyCliAttempt(run: AgentRun, prompt: string, systemPrompt: string, allowConsult: boolean): Promise<void> {
  return new Promise<void>((resolve) => {
    // 個人情報の分離の「最後の砦」（ユーザー指摘対応、runClaudeCliAttemptと同じ考え方）。
    try {
      assertNoRealNamesLeaked(prompt);
      assertNoRealNamesLeaked(systemPrompt);
    } catch (err) {
      run.status = "error";
      appendLog(run, "system", (err as Error).message);
      resolve();
      return;
    }

    const combinedPrompt = `${systemPrompt}\n\n---\n\n${prompt}`;
    const args = ["-p", combinedPrompt, "--model", AGY_GEMINI_MODEL, "--output-format", "stream-json"];
    if (run.agyConversationId) {
      args.push("--conversation", run.agyConversationId);
    }

    appendLog(run, "meta", run.agyConversationId ? "agy（Gemini）で会話を再開しています…" : "agy（Gemini）でこのターンを実行しています…");

    let child;
    try {
      child = spawn("agy", args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      run.status = "error";
      appendLog(run, "system", `agy起動エラー: ${(err as Error).message}`);
      resolve();
      return;
    }
    liveProcesses.set(run.id, child);

    let sawResult = false;

    function handleAgyLine(line: string) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let event: any;
      try {
        event = JSON.parse(line);
      } catch {
        appendLog(run, "system", line);
        return;
      }

      if (event.event === "step_update") {
        const step = event.step_update;
        if (step?.step_type === "tool" && step?.state === "ERROR") {
          appendLog(run, "system", `[agy] ツール呼び出しが拒否されました: ${step.tool_name ?? "unknown"}`);
        }
        return;
      }

      if (event.event === "result") {
        sawResult = true;
        const result = event.result ?? {};
        if (typeof result.conversation_id === "string" && result.conversation_id) {
          run.agyConversationId = result.conversation_id;
        }
        if (result.status !== "SUCCESS") {
          run.status = "error";
          appendLog(run, "system", `agy（Gemini）も失敗しました: ${result.error ?? "(no message)"}`);
          return;
        }
        const text = typeof result.response === "string" ? result.response.trim() : "";
        if (!text) {
          run.status = "error";
          appendLog(
            run,
            "system",
            "agy（Gemini）が空の応答を返しました（ツール呼び出しが拒否され、テキストでの結論に至らなかった可能性があります）。",
          );
          return;
        }
        appendLog(run, "agent", text);
        applyAssistantResultText(run, text, allowConsult);
      }
    }

    let buffer = "";
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (line.trim()) handleAgyLine(line);
      }
    });

    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("close", (code) => {
      liveProcesses.delete(run.id);
      if (buffer.trim()) handleAgyLine(buffer.trim());
      if (!sawResult) {
        run.status = "error";
        appendLog(
          run,
          "system",
          `agyも結果を返さずに終了しました (exit code: ${code})${stderr.trim() ? `: ${stderr.trim().slice(0, 500)}` : ""}`,
        );
      }
      resolve();
    });

    child.on("error", (err) => {
      liveProcesses.delete(run.id);
      run.status = "error";
      appendLog(run, "system", `agy起動エラー: ${err.message}`);
      resolve();
    });
  });
}

// cursor-agent（Cursor CLI）経由でのフォールバック実行。`--output-format stream-json`の
// イベント構造はclaudeの`handleStreamEvent`とほぼ同じ形（type: "assistant"/"result"等）だが、
// session_idはclaude用のrun.sessionIdとは別のID空間なので、handleStreamEventは再利用せず
// 専用のパーサーを実装し、run.cursorSessionIdに保存する。
// 安全面: `--mode ask`は書き込み・シェル実行を拒否することを実機確認済みだが、
// Glob/Read等の読み取り専用ツールは承認無しで実行してしまうことも確認したため、
// `--workspace`で空の専用ディレクトリ（CURSOR_WORKSPACE_DIR）に限定し、
// 万一読み取りツールが呼ばれてもこのアプリのソース・`.data`が見えないようにしている。
// `--append-system-prompt`相当のフラグも無いため、システムプロンプトをプロンプト本文の
// 先頭に連結して渡す。
function runCursorCliAttempt(run: AgentRun, prompt: string, systemPrompt: string, allowConsult: boolean): Promise<void> {
  return new Promise<void>((resolve) => {
    // 個人情報の分離の「最後の砦」（ユーザー指摘対応、runClaudeCliAttemptと同じ考え方）。
    try {
      assertNoRealNamesLeaked(prompt);
      assertNoRealNamesLeaked(systemPrompt);
    } catch (err) {
      run.status = "error";
      appendLog(run, "system", (err as Error).message);
      resolve();
      return;
    }

    const combinedPrompt = `${systemPrompt}\n\n---\n\n${prompt}`;
    const args = [
      "--print",
      "--mode",
      "ask",
      "--trust",
      "--workspace",
      CURSOR_WORKSPACE_DIR,
      "--output-format",
      "stream-json",
      "--model",
      CURSOR_MODEL,
    ];
    if (run.cursorSessionId) {
      args.push("--resume", run.cursorSessionId);
    }
    args.push(combinedPrompt);

    appendLog(run, "meta", run.cursorSessionId ? "Cursor CLIで会話を再開しています…" : "Cursor CLIでこのターンを実行しています…");

    let child;
    try {
      child = spawn("cursor-agent", args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      run.status = "error";
      appendLog(run, "system", `Cursor CLI起動エラー: ${(err as Error).message}`);
      resolve();
      return;
    }
    liveProcesses.set(run.id, child);

    let sawResult = false;

    function handleCursorLine(line: string) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let event: any;
      try {
        event = JSON.parse(line);
      } catch {
        appendLog(run, "system", line);
        return;
      }

      if (event.type === "assistant") {
        const content = event.message?.content ?? [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const block of content as any[]) {
          if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
            appendLog(run, "agent", block.text.trim());
          }
        }
        return;
      }

      if (event.type === "result") {
        sawResult = true;
        if (typeof event.session_id === "string" && event.session_id) {
          run.cursorSessionId = event.session_id;
        }
        if (event.is_error) {
          run.status = "error";
          appendLog(run, "system", `Cursor CLIも失敗しました: ${typeof event.result === "string" ? event.result : "(no message)"}`);
          return;
        }
        const text = typeof event.result === "string" ? event.result.trim() : "";
        if (!text) {
          run.status = "error";
          appendLog(run, "system", "Cursor CLIが空の応答を返しました。");
          return;
        }
        applyAssistantResultText(run, text, allowConsult);
      }
    }

    let buffer = "";
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (line.trim()) handleCursorLine(line);
      }
    });

    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("close", (code) => {
      liveProcesses.delete(run.id);
      if (buffer.trim()) handleCursorLine(buffer.trim());
      if (!sawResult) {
        run.status = "error";
        appendLog(
          run,
          "system",
          `Cursor CLIも結果を返さずに終了しました (exit code: ${code})${stderr.trim() ? `: ${stderr.trim().slice(0, 500)}` : ""}`,
        );
      }
      resolve();
    });

    child.on("error", (err) => {
      liveProcesses.delete(run.id);
      run.status = "error";
      appendLog(run, "system", `Cursor CLI起動エラー: ${err.message}`);
      resolve();
    });
  });
}

// docs 3.3「階層型マルチエージェント」/ docs/memo.md「M. AIエージェント“チーム”の
// 本格協働」: Lead Agentからの相談を1体以上の専門エージェントへ並行して委譲し、
// 全員の回答をLead Agent自身の会話（--resumeで同一セッション）に返して最終的な結論を
// 出させる。相談は1ターンにつき1回だけ（フォローアップ呼び出しはallowConsult=falseに
// して再帰的な相談連鎖を禁止する——専門エージェント同士が孫相談することは無い）。
async function handleConsult(leadRun: AgentRun, consult: ConsultRequest): Promise<void> {
  const specialistRuns = consult.agents.map((agentName) => {
    // docs/agent_specialization.md 段階5対応。consult.questionsにこのagentName向けの
    // 個別質問があればそれを使い、無ければ従来どおり共通questionにフォールバックする。
    const question = consultQuestionFor(consult, agentName);
    const specialistRun: AgentRun = {
      id: randomUUID(),
      agentName,
      task: question,
      status: "active",
      log: [],
      totalCostUsd: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      consultedBy: leadRun.id,
      origin: leadRun.origin,
      reviewed: leadRun.reviewed,
    };
    runs.set(specialistRun.id, specialistRun);
    // consult.question(s)はLead Agentの応答（クラウド由来、既にPERSON_n IDでマスク済み）から
    // 抽出したものなので、実名を含まない。そのままprecomputedPromptとしても渡し、
    // 既にマスク済みのテキストに対して再度ローカルNERを走らせない（無駄かつ誤検出のリスク）。
    appendLog(specialistRun, "meta", `${leadRun.agentName}からの相談: ${question}`);
    return { run: specialistRun, question };
  });

  // 複数の専門エージェントへの相談は並行実行する（Fleet/Activity Streamにも
  // 同時にactiveな複数のエージェントとして自然に反映される）。
  await Promise.all(specialistRuns.map(({ run: r, question }) => runClaudeTurn(r, question, false, question)));

  const answers = specialistRuns.map(({ run: r }) => {
    const lastAgentLine = [...r.log].reverse().find((l) => l.channel === "agent");
    return { agentName: r.agentName, answerText: lastAgentLine?.text ?? "(専門エージェントから回答を取得できませんでした)" };
  });

  for (const { agentName, answerText } of answers) {
    appendLog(leadRun, "agent", `[${agentName}からの回答]\n${answerText}`);
  }

  const followUp = [
    `${consult.agents.join("・")}に相談した結果は以下の通りです。`,
    "",
    ...answers.map(({ agentName, answerText }) => `【${agentName}】\n${answerText}`),
    "",
    consult.agents.length > 1
      ? "これらを踏まえて、最終的な結論をproposalブロック（追加でEMの判断が必要ならyieldブロック）として出力してください。回答の間で見解が割れている場合は、判断ロジックの中でどちらを重視したか・なぜかを明記してください。"
      : "これを踏まえて、最終的な結論をproposalブロック（追加でEMの判断が必要ならyieldブロック）として出力してください。",
  ].join("\n");

  // followUpもanswerText（クラウド由来・マスク済み）から組み立てただけなので実名を含まない。
  await runClaudeTurn(leadRun, followUp, false, followUp);
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
        }
      : run.proposal,
    suggestedActionItems: run.suggestedActionItems?.map(unmaskNames),
    suggestedSubIssues: run.suggestedSubIssues?.map(unmaskNames),
    suggestedCharter: run.suggestedCharter
      ? {
          why: run.suggestedCharter.why !== undefined ? unmaskNames(run.suggestedCharter.why) : undefined,
          what: run.suggestedCharter.what !== undefined ? unmaskNames(run.suggestedCharter.what) : undefined,
          how: run.suggestedCharter.how !== undefined ? unmaskNames(run.suggestedCharter.how) : undefined,
        }
      : run.suggestedCharter,
  };
}

export function listRuns(): AgentRun[] {
  return Array.from(runs.values()).sort((a, b) => b.createdAt - a.createdAt);
}

export function getRun(id: string): AgentRun | undefined {
  return runs.get(id);
}

// 個人情報の分離（ユーザー指摘対応）: run.task・ログへ保存する文言は、SQLiteに書き込む
// 前に必ずマスクする（クラウド送信の直前ではなく、保存の直前にマスクするという設計に
// 変更した）。runをrunsマップへ登録するのは、マスクが完了した後にする——マスク完了前に
// 登録すると、その一瞬だけtaskが空文字列で見えるが、実名が見える瞬間は無い（安全側）。
// ユーザー依頼「Journal等からIssueを生成する際、AIエージェントチームに内容を埋めさせる」
// 対応。linkedIssueIdを渡すと、実際にClaudeを起動する（runClaudeTurn）前に同期的に
// Issue.agentRunIdを紐づける。buildSystemPrompt内のgetIssueByRunId（issueContext/
// actionItemsRule/subIssuesRule/charterRuleが参照する）が、最初のターンから
// 紐付き済みの状態を見られるようにするための順序保証（先にrunClaudeTurnを起動して
// 後から紐づけると、非同期処理のタイミング次第で最初のターンにIssueの前提が
// 渡らないレースが起き得る）。
export async function startRun(
  agentName: string,
  rawTask: string,
  origin: AgentRun["origin"] = "manual",
  linkedIssueId?: string,
): Promise<AgentRun> {
  const run: AgentRun = {
    id: randomUUID(),
    agentName,
    task: "",
    status: "active",
    log: [],
    totalCostUsd: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    origin,
    reviewed: origin === "manual",
  };
  const maskedTask = await sanitizeForCloud(run, rawTask);
  run.task = maskedTask;
  runs.set(run.id, run);
  if (linkedIssueId) linkIssueRun(linkedIssueId, run.id);
  appendLog(
    run,
    "meta",
    origin === "manual"
      ? `タスクを受理: ${maskedTask}`
      : `AIによる自動起動（${origin === "auto-anomaly" ? "異常検知" : "朝のサマリー"}）: ${maskedTask}`,
  );
  void runClaudeTurn(run, rawTask, true, maskedTask);
  return run;
}

// ユーザー依頼「Journal等からIssueを生成する際、AIエージェントチームに内容を埋めさせる」
// 対応。/api/issues・/api/issues/[id]/parentの両方（＝「素のIssue作成」の全経路）から
// 同じ文面でLead Agentへタスクを渡すための共通ビルダー。issueContext（buildIssueContextBlock）
// が既に紐付き済みのWhy/What/Howをブロックとして注入するが、それが省略されるケース
// （タイトルのみでWhy/What/How・タグが全て空のIssue）でもタイトルだけは確実に伝わるよう、
// ここでも明示的に含める。
export function buildIssueDraftTask(title: string, charter: { why?: string; what?: string; how?: string }): string {
  const lines = ["新しいIssueが起票されました。EMが次の一手を判断できるよう、チームとして分析してください。", `タイトル: ${title}`];
  if (charter.why) lines.push(`Why（記録時点）: ${charter.why}`);
  if (charter.what) lines.push(`What（記録時点）: ${charter.what}`);
  if (charter.how) lines.push(`How（記録時点）: ${charter.how}`);
  lines.push(
    "Why/What/Howのうち未整理な項目があれば埋める提案をし、そのうえで改善の方向性を判断してください。次にやるべき具体的なAction Itemsや、課題が抽象的な場合は子Issueへの分解案も、必要に応じて提案してください。複数の専門性にまたがる論点なら、該当する専門エージェントに相談してください。",
  );
  return lines.join("\n");
}

export async function decideRun(id: string, rawMessage: string): Promise<AgentRun | undefined> {
  const run = runs.get(id);
  if (!run) return undefined;
  if (run.status === "active" || run.status === "queued") {
    throw new Error("エージェントが実行中または順番待ちのため、今は入力を受け付けられません");
  }
  const maskedMessage = await sanitizeForCloud(run, rawMessage);
  appendLog(run, "meta", `EMからの入力: ${maskedMessage}`);
  void runClaudeTurn(run, rawMessage, true, maskedMessage);
  return run;
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

// docs/memo.md「B. 何でも相談↔Issueの昇格物語」対応。「様子見」（追跡は続けるが緊急ではない）
// と「却下」（対応不要）をEMに明示的に選ばせ、triageStatusへ記録する。どちらもreviewed=trueに
// なるため「次にすべきこと」の緊急度からは外れるが、triageStatusで後から区別できる。
export function setRunTriageStatus(id: string, status: "watching" | "dismissed"): AgentRun | undefined {
  const run = runs.get(id);
  if (!run) return undefined;
  run.reviewed = true;
  run.triageStatus = status;
  run.triageAt = Date.now();
  persistRunMeta(run);
  return run;
}

// docs/first_implession 3.8対応。AIが提案したAction Itemsを、EMが採用した後（実際の
// 追加は呼び出し側がIssueのaction-items APIを個別に叩く）または却下した後に、
// 提案自体をrunから消す（採用・却下いずれの場合も、同じ提案が表示され続けないように）。
export function clearSuggestedActionItems(id: string): AgentRun | undefined {
  const run = runs.get(id);
  if (!run) return undefined;
  run.suggestedActionItems = undefined;
  persistRunMeta(run);
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
