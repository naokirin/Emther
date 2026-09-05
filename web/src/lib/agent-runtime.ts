import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

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
  totalCostUsd: number;
  createdAt: number;
  updatedAt: number;
};

// MVPではシングルプロセス内のメモリに実行状態を保持する。
// 複数ワーカー/再起動をまたいだ永続化はスコープ外（Core Context DB / Daily Logs DBの実装時に再検討）。
const runs = new Map<string, AgentRun>();

const PER_TURN_BUDGET_USD = "0.5";

function buildSystemPrompt(agentName: string): string {
  return [
    `あなたはEM(エンジニアリングマネージャー)支援システムの一部として動作する「${agentName}」です。`,
    "与えられたタスクの文脈だけを判断材料とし、実際の外部システムやファイルには一切アクセスできません（ツールは無効化されています）。",
    "",
    "回答のルール:",
    "- タスクを完結できる場合は、通常どおり結論を述べて終了してください（yieldブロックは不要です）。",
    "- 次のいずれかに該当し、人間(EM)の判断や情報がなければ先に進めない場合は、回答の最後に必ず以下の形式でyieldブロックを1つだけ出力してください。",
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

function appendLog(run: AgentRun, channel: LogLine["channel"], text: string) {
  run.log.push({ ts: Date.now(), channel, text });
  run.updatedAt = Date.now();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function handleStreamEvent(run: AgentRun, event: any) {
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
        const yieldRequest = extractYield(typeof event.result === "string" ? event.result : "");
        if (yieldRequest) {
          run.status = "yield";
          run.yieldRequest = yieldRequest;
          appendLog(run, "system", `[YIELD] ${yieldRequest.reason}`);
        } else {
          run.status = "idle";
          run.yieldRequest = undefined;
          appendLog(run, "system", "タスクが完了しました（人間の入力は不要です）。");
        }
      }
      break;
    }
    default:
      break;
  }
}

function runClaudeTurn(run: AgentRun, prompt: string): Promise<void> {
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

    run.status = "active";
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
