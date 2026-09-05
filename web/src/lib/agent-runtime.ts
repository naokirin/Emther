import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { extractFirstJsonObject, runLocalChat } from "@/lib/local-model";
import { maskNames, registerName, unmaskNames } from "@/lib/people-directory";
import { listTeams } from "@/lib/org-context-store";
import { loadJSON, saveJSON } from "@/lib/persistence";

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
};

// `.data/agent-runs.json`への簡易永続化。Core Context DB / Daily Logs DBとしての
// 本格実装は今後の課題（README参照）。再起動時に残っていた"active"は、実体の
// 子プロセスがもう存在しないため、安全側に倒して"error"へ変換する。
const persistedRuns = loadJSON<AgentRun[]>("agent-runs.json", []).map((r) =>
  r.status === "active"
    ? { ...r, status: "error" as const, log: [...r.log, { ts: Date.now(), channel: "system" as const, text: "サーバー再起動により実行状態が不明になったため、エラー扱いにしました。" }] }
    : r,
);
const runs = new Map<string, AgentRun>(persistedRuns.map((r) => [r.id, r]));

function persistRuns(): void {
  saveJSON("agent-runs.json", Array.from(runs.values()));
}

const PER_TURN_BUDGET_USD = "0.5";

// docs 3.1「動的ロード」の簡略版: 本来は対象Issueに関連する部分だけを動的にロードすべきだが、
// MVPではチーム数が少ない前提でOrganization Context（チーム名簿）全体を常に注入する。
// メンバー名はここで初めて登場する可能性があるため、注入前に必ずpeople-directoryへ登録し、
// 実名のままクラウドに出さないようmaskNamesを通す（他の経路と同じ匿名化ルール）。
function buildOrgContextBlock(): string {
  const teams = listTeams();
  if (teams.length === 0) return "";

  for (const team of teams) {
    for (const member of team.members) {
      registerName(member);
    }
  }

  const lines = teams.map((t) => `- ${t.name}: ${t.members.length > 0 ? t.members.join(", ") : "(メンバー未登録)"}`);
  const block = ["組織のチーム構成（Organization Context、絶対の前提として扱うこと）:", ...lines].join("\n");
  return maskNames(block);
}

function buildSystemPrompt(agentName: string): string {
  const base = [
    `あなたはEM(エンジニアリングマネージャー)支援システムの一部として動作する「${agentName}」です。`,
    "与えられたタスクの文脈だけを判断材料とし、実際の外部システムやファイルには一切アクセスできません（ツールは無効化されています）。",
    "",
    "回答のルール:",
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

  const orgContext = buildOrgContextBlock();
  return orgContext ? `${base}\n\n${orgContext}` : base;
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

function appendLog(run: AgentRun, channel: LogLine["channel"], text: string) {
  run.log.push({ ts: Date.now(), channel, text });
  run.updatedAt = Date.now();
  persistRuns();
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
function handleStreamEvent(run: AgentRun, event: any) {
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
        const resultText = unmaskNames(typeof event.result === "string" ? event.result : "");
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
      break;
    }
    default:
      break;
  }
}

async function runClaudeTurn(run: AgentRun, rawPrompt: string): Promise<void> {
  // 非同期のsanitizeForCloud()を待つ前に同期でactiveへ倒しておく。
  // でないとdecideRun()が呼び出し直後に返すrunの状態がまだ古いまま（yield/idle）になり、
  // 「実行中は入力を受け付けない」というdecideRunの多重実行ガードもすり抜けてしまう。
  run.status = "active";

  const prompt = await sanitizeForCloud(run, rawPrompt);

  return new Promise((resolve) => {
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
      buildSystemPrompt(run.agentName),
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
      resolve();
      return;
    }

    let buffer = "";

    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (!line.trim()) continue;
        try {
          handleStreamEvent(run, JSON.parse(line));
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
      if (buffer.trim()) {
        try {
          handleStreamEvent(run, JSON.parse(buffer));
        } catch {
          appendLog(run, "system", buffer.trim());
        }
      }
      if (run.status === "active") {
        run.status = "error";
        appendLog(run, "system", `プロセスが結果を返さずに終了しました (exit code: ${code})`);
      }
      resolve();
    });

    child.on("error", (err) => {
      run.status = "error";
      appendLog(run, "system", `起動エラー: ${err.message}`);
      resolve();
    });
  });
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
