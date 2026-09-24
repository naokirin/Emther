import { spawn } from "node:child_process";
import { getRulesAndConstraints } from "../../settings-store";
import { perTurnBudgetUsdArg } from "../context-blocks";
import { appendLog, liveProcesses } from "../store";
import type { AgentRun } from "../types";
import { handleStreamEvent } from "./core";

// 戻り値はこの試行が失敗した（run.statusが"error"で終わった）かどうか。
// 相談待ち（pendingConsult）・追加照会待ち（pendingLookup）は失敗ではない。
export function runClaudeCliAttempt(run: AgentRun, prompt: string, systemPrompt: string, allowConsult: boolean): Promise<boolean> {
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
      perTurnBudgetUsdArg(),
      "--append-system-prompt",
      systemPrompt,
    ];
    if (run.sessionId) {
      args.push("--resume", run.sessionId);
    }
    // 設定で
    // このエージェント種別に系統が指定されていれば渡す。未設定ならclaude CLIの既定に任せる
    // （挙動を変えないデフォルト）。
    const modelTier = getRulesAndConstraints().agentModelTiers[run.agentName];
    if (modelTier) {
      args.push("--model", modelTier);
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
      if (run.status === "active" && !run.pendingConsult && !run.pendingLookup) {
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
