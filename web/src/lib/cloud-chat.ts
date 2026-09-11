import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dataFilePath } from "@/lib/persistence";
import { assertNoRealNamesLeaked } from "@/lib/people-directory";
import { getRulesAndConstraints } from "@/lib/settings-store";
import { CLI_LABELS, type CliName } from "@/lib/types";

// Agent Runtime の Lead 起動とは分離した、ワンショットのクラウドCLI呼び出し。
// OKR構造化など「JSONだけ返してほしい短いタスク」向け。Run DB・Org注入・consultは載せない。

const AGY_DEFAULT_MODEL = "gemini-3.6-flash-medium";
const CURSOR_DEFAULT_MODEL = "gpt-5.2";
const CURSOR_WORKSPACE_DIR = dataFilePath("cursor-sandbox");
mkdirSync(CURSOR_WORKSPACE_DIR, { recursive: true });

const DEFAULT_TIMEOUT_MS = 120_000;

function perTurnBudgetUsdArg(): string {
  const n = getRulesAndConstraints().perTurnBudgetUsd;
  const usd = typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0.5;
  return String(Math.max(0.01, usd));
}

function collectNdjsonResult(
  stdout: string,
  pick: (event: Record<string, unknown>) => string | null | undefined,
): string {
  let last = "";
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const event = JSON.parse(trimmed) as Record<string, unknown>;
      const text = pick(event);
      if (typeof text === "string" && text.trim()) last = text.trim();
    } catch {
      // stream-json以外の行は無視
    }
  }
  return last;
}

function runProcess(command: string, args: string[], timeoutMs: number): Promise<{ stdout: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      reject(err);
      return;
    }

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${command} がタイムアウトしました（${Math.round(timeoutMs / 1000)}秒）`));
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code && code !== 0 && !stdout.trim()) {
        reject(new Error(`${command} が終了コード ${code} で失敗しました${stderr.trim() ? `: ${stderr.trim()}` : ""}`));
        return;
      }
      resolve({ stdout, code });
    });
  });
}

async function runClaudeOnce(systemPrompt: string, userPrompt: string, timeoutMs: number): Promise<string> {
  const args = [
    "-p",
    userPrompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--tools",
    "",
    "--max-budget-usd",
    perTurnBudgetUsdArg(),
    "--append-system-prompt",
    systemPrompt,
  ];
  const { stdout } = await runProcess("claude", args, timeoutMs);
  const text = collectNdjsonResult(stdout, (event) => {
    if (event.type !== "result" || event.is_error) return null;
    return typeof event.result === "string" ? event.result : null;
  });
  if (!text) throw new Error("Claude CLIが空の応答を返しました");
  return text;
}

async function runAgyOnce(systemPrompt: string, userPrompt: string, timeoutMs: number): Promise<string> {
  const model = getRulesAndConstraints().agentAgyModels["Lead Agent"] || AGY_DEFAULT_MODEL;
  const combined = `${systemPrompt}\n\n---\n\n${userPrompt}`;
  const args = ["-p", combined, "--model", model, "--output-format", "stream-json"];
  const { stdout } = await runProcess("agy", args, timeoutMs);
  const text = collectNdjsonResult(stdout, (event) => {
    if (event.event !== "result") return null;
    const result = (event.result ?? {}) as Record<string, unknown>;
    if (result.status !== "SUCCESS") return null;
    return typeof result.response === "string" ? result.response : null;
  });
  if (!text) throw new Error("agy（Gemini）が空の応答を返しました");
  return text;
}

async function runCursorOnce(systemPrompt: string, userPrompt: string, timeoutMs: number): Promise<string> {
  const model = getRulesAndConstraints().agentCursorModels["Lead Agent"] || CURSOR_DEFAULT_MODEL;
  const combined = `${systemPrompt}\n\n---\n\n${userPrompt}`;
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
    model,
    combined,
  ];
  const { stdout } = await runProcess("cursor-agent", args, timeoutMs);
  const text = collectNdjsonResult(stdout, (event) => {
    if (event.type !== "result" || event.is_error) return null;
    return typeof event.result === "string" ? event.result : null;
  });
  if (!text) throw new Error("Cursor CLIが空の応答を返しました");
  return text;
}

async function runOneCli(cli: CliName, systemPrompt: string, userPrompt: string, timeoutMs: number): Promise<string> {
  switch (cli) {
    case "claude":
      return runClaudeOnce(systemPrompt, userPrompt, timeoutMs);
    case "agy":
      return runAgyOnce(systemPrompt, userPrompt, timeoutMs);
    case "cursor":
      return runCursorOnce(systemPrompt, userPrompt, timeoutMs);
    default: {
      const _exhaustive: never = cli;
      throw new Error(`未対応のCLI: ${_exhaustive}`);
    }
  }
}

/**
 * Settings の cliOrder 順にワンショット実行し、最初に非空テキストを返したCLIの結果を使う。
 * 送信前に assertNoRealNamesLeaked する（呼び出し側で maskForStorage 済みであること）。
 */
export async function runCloudChat(
  systemPrompt: string,
  userPrompt: string,
  opts?: { timeoutMs?: number },
): Promise<string> {
  assertNoRealNamesLeaked(systemPrompt);
  assertNoRealNamesLeaked(userPrompt);

  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const order = getRulesAndConstraints().cliOrder;
  const errors: string[] = [];

  for (const cli of order) {
    try {
      return await runOneCli(cli, systemPrompt, userPrompt, timeoutMs);
    } catch (err) {
      errors.push(`${CLI_LABELS[cli]}: ${(err as Error).message}`);
    }
  }

  throw new Error(`外部AIでの応答に失敗しました（${errors.join(" / ") || "候補CLIなし"}）`);
}
