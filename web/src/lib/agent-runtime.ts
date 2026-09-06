import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { extractFirstJsonObject, runLocalChat } from "@/lib/local-model";
import { listPeople, maskNames, registerName, unmaskNames } from "@/lib/people-directory";
import { getOrgStrategy, listActiveTeams } from "@/lib/org-context-store";
import { getIssueByRunId } from "@/lib/issue-store";
import { listActiveFactsForPerson, listInterpretationsForPerson, searchSimilarEvents, type KnowledgeEvent } from "@/lib/knowledge-store";
import { embedText } from "@/lib/embeddings";
import { getDb } from "@/lib/db";
import { getRulesAndConstraints } from "@/lib/settings-store";
import { teamDisplayName } from "@/lib/types";

export type AgentStatus = "active" | "yield" | "idle" | "error";

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

export type ConsultRequest = {
  agent: string;
  question: string;
};

const SPECIALIST_AGENTS = ["People Agent", "Process Agent", "Tech Agent"];

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
  log: LogLine[];
  yieldRequest?: YieldRequest;
  proposal?: Proposal;
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
  yield_request_json: string | null;
  proposal_json: string | null;
  total_cost_usd: number;
  created_at: number;
  updated_at: number;
  consulted_by: string | null;
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
        (id, agent_name, task, status, session_id, yield_request_json, proposal_json, total_cost_usd, created_at, updated_at, consulted_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         status = excluded.status,
         session_id = excluded.session_id,
         yield_request_json = excluded.yield_request_json,
         proposal_json = excluded.proposal_json,
         total_cost_usd = excluded.total_cost_usd,
         updated_at = excluded.updated_at`,
    )
    .run(
      run.id,
      run.agentName,
      run.task,
      run.status,
      run.sessionId ?? null,
      run.yieldRequest ? JSON.stringify(run.yieldRequest) : null,
      run.proposal ? JSON.stringify(run.proposal) : null,
      run.totalCostUsd,
      run.createdAt,
      run.updatedAt,
      run.consultedBy ?? null,
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
      log: logsByRun.get(row.id) ?? [],
      yieldRequest: row.yield_request_json ? JSON.parse(row.yield_request_json) : undefined,
      proposal: row.proposal_json ? JSON.parse(row.proposal_json) : undefined,
      totalCostUsd: row.total_cost_usd,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      consultedBy: row.consulted_by ?? undefined,
    };
    if (run.status === "active") {
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

function checkStaleRuns(): void {
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

let watchdogStarted = false;
function ensureWatchdogStarted(): void {
  if (watchdogStarted) return;
  watchdogStarted = true;
  setInterval(checkStaleRuns, WATCHDOG_INTERVAL_MS);
}
ensureWatchdogStarted();

const PER_TURN_BUDGET_USD = "0.5";

// docs 3.1「動的ロード」の簡略版: 本来は対象Issueに関連する部分だけを動的にロードすべきだが、
// MVPではチーム数が少ない前提でOrganization Context（チーム名簿）全体を常に注入する。
// メンバー名はここで初めて登場する可能性があるため、注入前に必ずpeople-directoryへ登録し、
// 実名のままクラウドに出さないようmaskNamesを通す（他の経路と同じ匿名化ルール）。
// docs 3.1「Core Context」の`Strategy/`ディレクトリ相当。MVV/OKRは組織全体で
// 1つの静的な前提であり、Issueに紐づくかどうかに関わらず常に「絶対の前提」として注入する
// （動的ロード対象はIssue charterとJournalのみ）。未設定の項目は行ごと省略する。
function buildStrategyBlock(): string {
  const strategy = getOrgStrategy();
  const lines: string[] = [];
  if (strategy.mission) lines.push(`Mission: ${strategy.mission}`);
  if (strategy.vision) lines.push(`Vision: ${strategy.vision}`);
  if (strategy.values) lines.push(`Values: ${strategy.values}`);
  if (strategy.okr) lines.push(`OKR: ${strategy.okr}`);
  if (lines.length === 0) return "";
  return maskNames(["組織のMVV/OKR（Organization Context / Strategy、絶対の前提として扱うこと）:", ...lines].join("\n"));
}

function buildOrgContextBlock(): string {
  const teams = listActiveTeams();
  if (teams.length === 0) return "";

  for (const team of teams) {
    for (const member of team.members) {
      registerName(member);
    }
  }

  const lines = teams.map((t) => `- ${teamDisplayName(t.name)}: ${t.members.length > 0 ? t.members.join(", ") : "(メンバー未登録)"}`);
  const block = ["組織のチーム構成（Organization Context、絶対の前提として扱うこと）:", ...lines].join("\n");
  return maskNames(block);
}

// docs 3.1「動的ロード」: そのrunがIssueに紐づいている場合、Issueのタイトルと
// charter（Why/What/How）を「絶対の前提」としてエージェントに渡す。docs/first_implession
// のIssue Workspaceが目指していた「壁打ちがIssueの文脈を踏まえる」ことの実体化。
// charterが3項目とも空（未整理）のIssueなら、渡す情報が無いのでブロック自体を省略する
// （空の前提を渡して混乱させないため）。
function buildIssueContextBlock(runId: string): string {
  const issue = getIssueByRunId(runId);
  if (!issue) return "";
  const { why, what, how } = issue.charter;
  if (!why && !what && !how && issue.tags.length === 0) return "";

  const lines = ["このタスクが紐づくIssueの前提（絶対の前提として扱うこと）:", `タイトル: ${issue.title}`];
  if (why) lines.push(`Why（生む価値・誰のため・なぜ今か）: ${why}`);
  if (what) lines.push(`What（何を・どこまで・どのくらい・完了の定義）: ${what}`);
  if (how) lines.push(`How（どのように実現するか・前提や制約）: ${how}`);
  if (issue.tags.length > 0) lines.push(`タグ: ${issue.tags.join(", ")}`);
  return maskNames(lines.join("\n"));
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

async function buildJournalContextBlock(rawText: string): Promise<string> {
  const mentioned = listPeople().filter((p) => rawText.includes(p.name));

  const factLines: string[] = [];
  const interpretationLines: string[] = [];
  const seenIds = new Set<string>();
  for (const person of mentioned) {
    for (const e of listActiveFactsForPerson(person.name, 5)) {
      seenIds.add(e.id);
      factLines.push(`- [${person.name}] ${e.text}（タグ: ${e.tags.join(", ") || "なし"} / 緊急度: ${e.urgency ?? "-"} / 感情: ${e.sentiment ?? "-"}）`);
    }
    for (const e of listInterpretationsForPerson(person.name)) {
      seenIds.add(e.id);
      interpretationLines.push(`- [${person.name}] ${e.text}`);
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
    blocks.push(
      ["長期的なプロファイル・解釈（TTLなし、訂正されるまで有効。一時的な感情と混同しないこと）:", ...interpretationLines].join("\n"),
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

function buildSystemPrompt(agentName: string, allowConsult: boolean, runId?: string, journalContext?: string): string {
  const consultRule =
    agentName === "Lead Agent" && allowConsult
      ? [
          "- あなたはリードエージェントとして、必要なら専門エージェント（People Agent / Process Agent / Tech Agent）のうち1つに、1ターンにつき1回だけ相談できます。",
          "  自分の専門外の知識が結論の質を左右すると判断した場合、proposal/yieldの代わりに以下の形式でconsultブロックを1つだけ出力してください（相談は1回のみ。2回目以降は使えません）。",
          "  ```consult",
          '  { "agent": "People Agent", "question": "相談したい内容を1つの質問文で" }',
          "  ```",
          '  agentは "People Agent" / "Process Agent" / "Tech Agent" のいずれか1つのみ指定できます。',
          "",
        ]
      : [];

  const base = [
    `あなたはEM(エンジニアリングマネージャー)支援システムの一部として動作する「${agentName}」です。`,
    "与えられたタスクの文脈だけを判断材料とし、実際の外部システムやファイルには一切アクセスできません（ツールは無効化されています）。",
    "",
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
  const orgContext = buildOrgContextBlock();
  const strategyContext = buildStrategyBlock();
  return [base, issueContext, journalContext, orgContext, strategyContext].filter(Boolean).join("\n\n");
}

function extractYield(resultText: string): YieldRequest | undefined {
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
function extractProposal(resultText: string): Proposal | undefined {
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

// docs 3.3「階層型マルチエージェント」: Lead Agentが専門エージェントに相談したい場合の合図。
function extractConsult(resultText: string): ConsultRequest | undefined {
  const match = resultText.match(/```consult\s*\n?([\s\S]*?)```/);
  if (!match) return undefined;
  try {
    const parsed = JSON.parse(match[1].trim());
    if (parsed && typeof parsed.agent === "string" && typeof parsed.question === "string" && SPECIALIST_AGENTS.includes(parsed.agent)) {
      return { agent: parsed.agent, question: parsed.question };
    }
  } catch {
    // 不正なconsultブロックは相談なしとして扱う
  }
  return undefined;
}

function appendLog(run: AgentRun, channel: LogLine["channel"], text: string) {
  const line: LogLine = { ts: Date.now(), channel, text };
  run.log.push(line);
  run.updatedAt = line.ts;
  insertRunLog(run.id, line);
  persistRunMeta(run);
}

// docs/memo.md の匿名化方式: クラウド(claude -p)に送る前に、テキスト中の人物名を
// ローカルモデルで検出してpeople-directoryに登録し、既知の名前をすべてIDに置換する。
// 実名はEM向けの表示（run.task, ログ）にはそのまま残し、外部に出る経路だけをマスクする。
const NAME_EXTRACTION_SYSTEM_PROMPT = [
  "入力テキストに含まれる人物名だけをJSON形式で出力してください。説明や前置きは一切書かず、JSONオブジェクト1つだけを出力すること。",
  'フォーマット: {"people": string[]}',
  "敬称はそのまま残すこと（例: Aさん）。人物が見当たらなければ空配列にすること。",
].join("\n");

async function detectAndRegisterNames(text: string): Promise<void> {
  try {
    const content = await runLocalChat(
      [
        { role: "system", content: NAME_EXTRACTION_SYSTEM_PROMPT },
        { role: "user", content: "経営会議。Q3のリリース日が前倒しになった。" },
        { role: "assistant", content: JSON.stringify({ people: [] }) },
        { role: "user", content: "CさんのPRレビューが速い。" },
        { role: "assistant", content: JSON.stringify({ people: ["Cさん"] }) },
        { role: "user", content: text },
      ],
      100,
    );
    const jsonText = extractFirstJsonObject(content);
    if (!jsonText) return;
    const parsed = JSON.parse(jsonText);
    if (Array.isArray(parsed.people)) {
      for (const p of parsed.people) {
        if (typeof p === "string" && p.trim()) registerName(p);
      }
    }
  } catch {
    // ローカルNERの失敗は握りつぶす。既知の名前のマスクは引き続き有効なので、
    // 「新規の名前だけ検出できない」という劣化に留まる。
  }
}

async function sanitizeForCloud(run: AgentRun, text: string): Promise<string> {
  await detectAndRegisterNames(text);
  const masked = maskNames(text);
  if (masked !== text) {
    appendLog(run, "meta", "送信前に人物名を匿名化しました（人物名はローカルのみで保持）");
  }
  return masked;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function handleStreamEvent(run: AgentRun, event: any, allowConsult: boolean) {
  switch (event.type) {
    case "assistant": {
      const content = event.message?.content ?? [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const block of content as any[]) {
        if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
          appendLog(run, "agent", unmaskNames(block.text.trim()));
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
        appendLog(run, "system", `エラーで終了しました: ${unmaskNames(event.result ?? "(no message)")}`);
      } else {
        applyAssistantResultText(run, unmaskNames(typeof event.result === "string" ? event.result : ""), allowConsult);
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
// 呼び出し側は既にunmaskNames()済みのテキストを渡すこと。
function applyAssistantResultText(run: AgentRun, resultText: string, allowConsult: boolean): void {
  const consultRequest = run.agentName === "Lead Agent" && allowConsult ? extractConsult(resultText) : undefined;
  if (consultRequest) {
    // まだ完了ではない。runClaudeTurn側でpendingConsultを見て相談処理へ進む。
    run.pendingConsult = consultRequest;
    appendLog(run, "system", `[相談] ${consultRequest.agent}に質問: ${consultRequest.question}`);
    return;
  }

  const yieldRequest = extractYield(resultText);
  if (yieldRequest) {
    run.status = "yield";
    run.yieldRequest = yieldRequest;
    run.proposal = undefined;
    appendLog(run, "system", `[YIELD] ${yieldRequest.reason}`);
  } else {
    run.status = "idle";
    run.yieldRequest = undefined;
    run.proposal = extractProposal(resultText);
    appendLog(
      run,
      "system",
      run.proposal ? "タスクが完了しました（人間の入力は不要です）。" : "タスクが完了しました（proposal形式には従いませんでした）。",
    );
  }
}

// AGENT_OPTIONSのうち、Settingsで明示的にGemini CLIフォールバックを有効化した
// エージェント種別だけがフォールバック対象になる（既定は全エージェントOFF）。
function isGeminiFallbackEnabled(agentName: string): boolean {
  return getRulesAndConstraints().geminiFallbackAgents.includes(agentName);
}

async function runClaudeTurn(run: AgentRun, rawPrompt: string, allowConsult = true): Promise<void> {
  // 非同期のsanitizeForCloud()を待つ前に同期でactiveへ倒しておく。
  // でないとdecideRun()が呼び出し直後に返すrunの状態がまだ古いまま（yield/idle）になり、
  // 「実行中は入力を受け付けない」というdecideRunの多重実行ガードもすり抜けてしまう。
  run.status = "active";
  run.pendingConsult = undefined;

  // 実名でのマッチングが必要なので、maskNamesで置換される前のrawPromptに対して行う。
  const journalContext = await buildJournalContextBlock(rawPrompt);
  const prompt = await sanitizeForCloud(run, rawPrompt);
  const systemPrompt = buildSystemPrompt(run.agentName, allowConsult, run.id, journalContext);

  const claudeFailed = await runClaudeCliAttempt(run, prompt, systemPrompt, allowConsult);

  // docs/memo.md TODO「Claude Codeが使えない場合にGemini CLIを使うようにする」対応。
  // claude CLIの実行失敗・予算/レート制限のいずれでも（run.statusが"error"になっていれば）
  // トリガーとする。フォールバックはこのエージェント種別で明示的に有効化されている場合のみ。
  // Gemini CLIはセッション継続を持たないため、このターン単体（直前までの会話履歴なし）での
  // 再試行になる——複数ターンの壁打ち途中で失敗した場合は文脈が失われる点は既知の制約。
  if (claudeFailed && isGeminiFallbackEnabled(run.agentName)) {
    appendLog(run, "system", "⚠️ claude CLIが利用できなかったため、Gemini CLIにこのターンをフォールバックします。");
    await runGeminiCliAttempt(run, prompt, systemPrompt, allowConsult);
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

// Gemini CLIでの単発フォールバック実行。stream-json形式（Claudeと同じ選択肢名だが
// 実際のイベント構造は未検証のため使わない）ではなく、確実に扱える`-o text`の
// プレーンテキスト出力を丸ごと最終応答として扱う。`--approval-mode plan`で
// 読み取り専用（ツールによる変更を行わない）にし、claudeの`--tools ""`と同等の
// 安全性を保つ。--append-system-prompt相当のフラグが無いため、システムプロンプトを
// プロンプト本文の先頭に連結して渡す。
function runGeminiCliAttempt(run: AgentRun, prompt: string, systemPrompt: string, allowConsult: boolean): Promise<void> {
  return new Promise<void>((resolve) => {
    const combinedPrompt = `${systemPrompt}\n\n---\n\n${prompt}`;
    const args = ["-p", combinedPrompt, "-o", "text", "--approval-mode", "plan"];

    appendLog(run, "meta", "Gemini CLIでこのターンを実行しています…");

    let child;
    try {
      child = spawn("gemini", args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      run.status = "error";
      appendLog(run, "system", `Gemini CLI起動エラー: ${(err as Error).message}`);
      resolve();
      return;
    }
    liveProcesses.set(run.id, child);

    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });

    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("close", (code) => {
      liveProcesses.delete(run.id);
      const text = stdout.trim();
      if (code !== 0 || !text) {
        run.status = "error";
        appendLog(
          run,
          "system",
          `Gemini CLIも失敗しました (exit code: ${code})${stderr.trim() ? `: ${stderr.trim().slice(0, 500)}` : ""}`,
        );
        resolve();
        return;
      }
      const unmasked = unmaskNames(text);
      appendLog(run, "agent", unmasked);
      applyAssistantResultText(run, unmasked, allowConsult);
      resolve();
    });

    child.on("error", (err) => {
      liveProcesses.delete(run.id);
      run.status = "error";
      appendLog(run, "system", `Gemini CLI起動エラー: ${err.message}`);
      resolve();
    });
  });
}

// docs 3.3「階層型マルチエージェント」: Lead Agentからの相談を実際に専門エージェントへ
// 委譲し、その回答をLead Agent自身の会話（--resumeで同一セッション）に返して
// 最終的な結論を出させる。相談は1ターンにつき1回だけ（フォローアップ呼び出しは
// allowConsult=falseにして再帰的な相談連鎖を禁止する）。
async function handleConsult(leadRun: AgentRun, consult: ConsultRequest): Promise<void> {
  const specialistRun: AgentRun = {
    id: randomUUID(),
    agentName: consult.agent,
    task: consult.question,
    status: "active",
    log: [],
    totalCostUsd: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    consultedBy: leadRun.id,
  };
  runs.set(specialistRun.id, specialistRun);
  appendLog(specialistRun, "meta", `${leadRun.agentName}からの相談: ${consult.question}`);

  await runClaudeTurn(specialistRun, consult.question, false);

  const lastAgentLine = [...specialistRun.log].reverse().find((l) => l.channel === "agent");
  const answerText = lastAgentLine?.text ?? "(専門エージェントから回答を取得できませんでした)";

  appendLog(leadRun, "agent", `[${consult.agent}からの回答]\n${answerText}`);

  const followUp = [
    `${consult.agent}に相談した結果は以下の通りです。`,
    "",
    answerText,
    "",
    "これを踏まえて、最終的な結論をproposalブロック（追加でEMの判断が必要ならyieldブロック）として出力してください。",
  ].join("\n");

  await runClaudeTurn(leadRun, followUp, false);
}

export function listRuns(): AgentRun[] {
  return Array.from(runs.values()).sort((a, b) => b.createdAt - a.createdAt);
}

export function getRun(id: string): AgentRun | undefined {
  return runs.get(id);
}

export function startRun(agentName: string, task: string): AgentRun {
  const run: AgentRun = {
    id: randomUUID(),
    agentName,
    task,
    status: "active",
    log: [],
    totalCostUsd: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  runs.set(run.id, run);
  appendLog(run, "meta", `タスクを受理: ${task}`);
  void runClaudeTurn(run, task);
  return run;
}

export function decideRun(id: string, message: string): AgentRun | undefined {
  const run = runs.get(id);
  if (!run) return undefined;
  if (run.status === "active") {
    throw new Error("エージェントが実行中のため、今は入力を受け付けられません");
  }
  appendLog(run, "meta", `EMからの入力: ${message}`);
  void runClaudeTurn(run, message);
  return run;
}
