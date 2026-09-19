import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dataFilePath } from "@core/persistence";
import { getRulesAndConstraints } from "@core/settings-store";
import { appendLog, liveProcesses } from "../store";
import type { AgentRun } from "../types";
import { applyAssistantResultText } from "./core";

// docs/memo.md「サポートするAIエージェントCLIにCursor CLIを追加する」対応。
// cursor-agentも複数モデルに対応するマルチモデルCLIで、汎用モデル名（コーディング特化で
// ない一般的なモデル）として"gpt-5.2"を使う。`--mode ask`は実機確認済みで
// 書き込み・シェル実行を拒否する（安全側）が、Glob/Read等の読み取り専用ツールは
// 承認無しで実行してしまうため、`--workspace`で空の専用ディレクトリに限定し、
// 万一読み取りツールが呼ばれてもこのアプリのソース・`.data`が見えないようにする。
const CURSOR_MODEL = "gpt-5.2";
const CURSOR_WORKSPACE_DIR = dataFilePath("cursor-sandbox");
mkdirSync(CURSOR_WORKSPACE_DIR, { recursive: true });

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
export function runCursorCliAttempt(run: AgentRun, prompt: string, systemPrompt: string, allowConsult: boolean): Promise<void> {
  return new Promise<void>((resolve) => {

    // ユーザー要望「エージェント種別ごとのモデル系統に関して、Cursor/agyについても調整
    // できるようにしたい」対応。設定でこのエージェント種別にモデルが指定されていれば
    // それを使い、未設定なら既定モデルのまま動く。
    const cursorModel = getRulesAndConstraints().agentCursorModels[run.agentName] || CURSOR_MODEL;
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
      cursorModel,
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
