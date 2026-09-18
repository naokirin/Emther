import { spawn } from "node:child_process";
import { getRulesAndConstraints } from "@/lib/settings-store";
import { appendLog, liveProcesses } from "../store";
import type { AgentRun } from "../types";
import { applyAssistantResultText } from "./core";

// agy（複数モデル対応CLI）経由でのGeminiフォールバックに使うモデル。agyのモデル一覧は
// バージョン付きの名前（例: gemini-3.6-flash-medium）でしか指定できず、汎用エイリアスは
// 無いことを実機で確認済み。将来モデルが更新されたら定数を差し替える想定
// （local-model.tsのLOCAL_CHAT_MODELと同じ考え方）。
const AGY_GEMINI_MODEL = "gemini-3.6-flash-medium";

// agy経由でのGeminiフォールバック実行。agyのstream-json出力はclaudeと同じ選択肢名を
// 持つが、実際のイベント構造は別物（{"event": "result", "result": {"status", "response",
// "conversation_id", ...}}等）であることを実機で確認済み。会話継続はagyの
// `--conversation <id>`（claudeの--resumeと違い実際のUUID指定に対応）を使い、
// run.agyConversationIdに保存して次回以降のフォールバックで引き継ぐ。
// 明示的なツール無効化フラグは無いが、非対話（-p）実行中のツール承認はヘッドレスでは
// 自動拒否される（実機で確認済み）ため、claudeの`--tools ""`ほど厳格ではないものの
// 実質的にツールが実行されることはない。--append-system-prompt相当のフラグも無いため、
// システムプロンプトをプロンプト本文の先頭に連結して渡す。
export function runAgyCliAttempt(run: AgentRun, prompt: string, systemPrompt: string, allowConsult: boolean): Promise<void> {
  return new Promise<void>((resolve) => {

    // ユーザー要望「エージェント種別ごとのモデル系統に関して、Cursor/agyについても調整
    // できるようにしたい」対応。設定でこのエージェント種別にモデルが指定されていれば
    // それを使い、未設定なら既定モデルのまま動く。
    const agyModel = getRulesAndConstraints().agentAgyModels[run.agentName] || AGY_GEMINI_MODEL;
    const combinedPrompt = `${systemPrompt}\n\n---\n\n${prompt}`;
    const args = ["-p", combinedPrompt, "--model", agyModel, "--output-format", "stream-json"];
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
