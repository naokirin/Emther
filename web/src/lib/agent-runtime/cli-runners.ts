import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { LOOKUP_MAX_ROUNDS, executeLookup, extractLookup, type LookupRequest } from "@/lib/agent-knowledge-tools";
import { dataFilePath } from "@/lib/persistence";
import { assertNoRealNamesLeaked } from "@/lib/people-directory";
import { getRulesAndConstraints } from "@/lib/settings-store";
import { CLI_LABELS, type CliName } from "@/lib/types";
import { buildJournalContextBlock, buildRelatedContextForRun, buildSystemPrompt, perTurnBudgetUsdArg, selectRelatedSpecialists } from "./context-blocks";
import {
  consultQuestionFor,
  ensureRequiredConsult,
  extractActionItems,
  extractCharter,
  extractConsult,
  extractPriority,
  extractProposal,
  extractSubIssues,
  extractThemes,
  extractYield,
} from "./extraction";
import { appendLog, liveProcesses, runs, sanitizeForCloud, setRunTriageStatus } from "./store";
import type { AgentRun, AgentStatus, ConsultRequest } from "./types";

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
  // U19: lookup は consult / proposal / yield より優先（事実確認を先に済ませる）。
  const lookupRequest = extractLookup(resultText);
  if (lookupRequest) {
    if ((run.lookupRounds ?? 0) >= LOOKUP_MAX_ROUNDS) {
      // 上限後に再度 lookup しても再帰しない。EMへ inform で返す。
      run.status = "yield";
      run.yieldRequest = {
        reason:
          "追加照会の上限に達したため、これ以上の自動検索はできません。注入済みナレッジとこれまでの照会結果で判断できない点があれば、EMから情報を補ってください。",
        kind: "inform",
        options: [],
      };
      run.proposal = undefined;
      run.suggestedActionItems = undefined;
      run.suggestedSubIssues = undefined;
      run.suggestedCharter = undefined;
      run.suggestedPriority = undefined;
      run.suggestedThemes = undefined;
      appendLog(run, "system", `[追加照会] 上限（${LOOKUP_MAX_ROUNDS}回）到達のため拒否し、EMへ確認を求めました`);
      return;
    }
    run.pendingLookup = lookupRequest;
    const qSummary = lookupRequest.queries.map((q) => q.type).join("・");
    appendLog(
      run,
      "system",
      `[追加照会] ${lookupRequest.reason ? `${lookupRequest.reason} / ` : ""}${lookupRequest.queries.length}件（${qSummary}）`,
    );
    return;
  }

  const consultRequest = run.agentName === "Lead Agent" && allowConsult ? extractConsult(resultText) : undefined;
  // lookup は既に上で処理済み。必須consultが残っているときは proposal/yield より consult を優先する。
  const enforcedConsult = ensureRequiredConsult(run, consultRequest, allowConsult);
  if (enforcedConsult) {
    if (!consultRequest) {
      appendLog(
        run,
        "system",
        `[必須相談] EM指定により ${enforcedConsult.agents.join("・")} への相談を強制しました`,
      );
    } else if (enforcedConsult.agents.length > consultRequest.agents.length) {
      const added = enforcedConsult.agents.filter((a) => !consultRequest.agents.includes(a));
      appendLog(run, "system", `[必須相談] consultに ${added.join("・")} を追加しました`);
    }
    // まだ完了ではない。runClaudeTurn側でpendingConsultを見て相談処理へ進む。
    run.pendingConsult = enforcedConsult;
    const consultLog = enforcedConsult.questions
      ? enforcedConsult.agents.map((a) => `${a}へ: ${consultQuestionFor(enforcedConsult, a)}`).join(" / ")
      : `${enforcedConsult.agents.join("・")}に質問: ${enforcedConsult.question}`;
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
    run.suggestedPriority = undefined;
    run.suggestedThemes = undefined;
    appendLog(run, "system", `[YIELD] ${yieldRequest.reason}`);
  } else {
    run.status = "idle";
    run.yieldRequest = undefined;
    run.proposal = extractProposal(resultText);
    run.suggestedActionItems = run.proposal ? extractActionItems(resultText) : undefined;
    run.suggestedSubIssues = run.proposal ? extractSubIssues(resultText) : undefined;
    run.suggestedCharter = run.proposal ? extractCharter(resultText) : undefined;
    run.suggestedPriority = run.proposal ? extractPriority(resultText) : undefined;
    run.suggestedThemes = run.proposal ? extractThemes(resultText) : undefined;
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
    if (run.suggestedPriority) {
      appendLog(run, "system", `[優先度提案] ${run.suggestedPriority}`);
    }
    if (run.suggestedThemes) {
      appendLog(run, "system", `[テーマ解釈提案] ${run.suggestedThemes.length}件`);
    }
    // docs/usage_issues U2。Journal自動分析が追跡不要と明示したときだけ自動却下する。
    // 手動相談やIssue更新分析はEMのトリアージ対象のまま残す。
    if (run.origin === "auto-anomaly" && run.proposal?.recommendation === "dismiss") {
      setRunTriageStatus(run.id, "dismissed");
      appendLog(run, "system", "AIが追跡不要と判断したため、自動で却下しました。");
    }
  }
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
// 戻り値は呼び出し側では使わない（run.statusを見て次の候補へ進むかを判断するため）。
// runClaudeCliAttemptだけPromise<boolean>を返す非対称な型のため、Promise<unknown>にしている。
function runCliAttempt(cli: CliName, run: AgentRun, prompt: string, systemPrompt: string, allowConsult: boolean): Promise<unknown> {
  if (cli === "claude") return withRunSlot(run, () => runClaudeCliAttempt(run, prompt, systemPrompt, allowConsult));
  if (cli === "agy") return withRunSlot(run, () => runAgyCliAttempt(run, prompt, systemPrompt, allowConsult));
  return withRunSlot(run, () => runCursorCliAttempt(run, prompt, systemPrompt, allowConsult));
}

async function runClaudeTurn(run: AgentRun, rawPrompt: string, allowConsult = true, precomputedPrompt?: string): Promise<void> {
  // 非同期のsanitizeForCloud()を待つ前に同期でactiveへ倒しておく。
  // でないとdecideRun()が呼び出し直後に返すrunの状態がまだ古いまま（yield/idle）になり、
  // 「実行中は入力を受け付けない」というdecideRunの多重実行ガードもすり抜けてしまう。
  run.status = "active";
  run.pendingConsult = undefined;
  run.pendingLookup = undefined;

  // 実名でのマッチングが必要なので、maskNamesで置換される前のrawPromptに対して行う。
  // 再開時に「続けて」だけの短い入力だと意味検索が枯れるため、元タスク文もクエリに含める。
  const contextQuery = rawPrompt.trim() === run.task.trim() ? rawPrompt : `${rawPrompt}\n${run.task}`;
  const journalContext = await buildJournalContextBlock(contextQuery, run.agentName);
  const relatedContext = await buildRelatedContextForRun(run, contextQuery);
  const prompt = precomputedPrompt ?? (await sanitizeForCloud(run, rawPrompt));
  const systemPrompt = buildSystemPrompt(run.agentName, allowConsult, run.id, journalContext, contextQuery, relatedContext);

  // docs/memo.md TODO「Claude Codeが使えない場合にGemini CLIを使うようにする」・
  // 「サポートするAIエージェントCLIにCursor CLIを追加する」対応を、Settingsの
  // cliOrder（全エージェント共通のCLI優先順位リスト）で並び替え・除外可能にしたもの。
  // ユーザー指摘「優先度設定が増えたことでフォールバック設定との競合が発生している」
  // 「エージェントごとに設定できる必要はない、全体で1つで大丈夫」「claude codeが
  // 外せないようになっている」対応で、以前のcliPriorityOrder（全エージェント共通の
  // 並び順）とagyFallbackAgents/cursorFallbackAgents（エージェント種別ごとのON/OFF）
  // をこの1つの設定へ統合した——配列に含まれるCLIだけが候補（除外＝配列から外す）で、
  // claudeも他の2つと同様に除外できる（API側のバリデーションで空配列は弾く）。
  // 含まれる順に、失敗（run.statusが"error"）する限り次の候補へ進む。agyは
  // `--conversation`で会話継続できるため、run.agyConversationIdがあればそのまま
  // 引き継げる（claudeのsessionIdとは別のID空間で管理している）。
  const configuredOrder = getRulesAndConstraints().cliOrder;
  // 設定が万一壊れていても（本来はAPI側のバリデーションで防ぐ）runが何も試さず終わる
  // ことが無いようにする最後の砦。
  const clisToTry: CliName[] = configuredOrder && configuredOrder.length > 0 ? configuredOrder : ["claude"];

  for (let i = 0; i < clisToTry.length; i++) {
    const cli = clisToTry[i];
    if (i > 0) {
      appendLog(
        run,
        "system",
        `⚠️ ${CLI_LABELS[clisToTry[i - 1]]}が利用できなかったため、${CLI_LABELS[cli]}にこのターンをフォールバックします。`,
      );
    }
    await runCliAttempt(cli, run, prompt, systemPrompt, allowConsult);
    if ((run.status as AgentStatus) !== "error") break;
  }

  // U19: lookup を consult より先に処理（事実確認 → 必要なら専門相談）。
  if (run.pendingLookup) {
    const lookup = run.pendingLookup;
    run.pendingLookup = undefined;
    await handleLookup(run, lookup, allowConsult);
    return;
  }

  if (run.pendingConsult) {
    const consult = run.pendingConsult;
    run.pendingConsult = undefined;
    await handleConsult(run, consult);
  }
}

// 戻り値はこの試行が失敗した（run.statusが"error"で終わった）かどうか。
// 相談待ち（pendingConsult）・追加照会待ち（pendingLookup）は失敗ではない。
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
      perTurnBudgetUsdArg(),
      "--append-system-prompt",
      systemPrompt,
    ];
    if (run.sessionId) {
      args.push("--resume", run.sessionId);
    }
    // ユーザー要望「エージェントが使うモデルを設定で事前に決めたい」対応。設定で
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

// agy（複数モデル対応CLI）経由でのGeminiフォールバックに使うモデル。agyのモデル一覧は
// バージョン付きの名前（例: gemini-3.6-flash-medium）でしか指定できず、汎用エイリアスは
// 無いことを実機で確認済み。将来モデルが更新されたら定数を差し替える想定
// （local-model.tsのLOCAL_CHAT_MODELと同じ考え方）。
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

function buildSpecialistKickoffQuestion(task: string): string {
  return [
    task,
    "",
    "【依頼】あなたの専門領域の観点だけで分析し、proposal（または情報不足ならyield）を出してください。",
    "他象限の本論には踏み込まないでください。",
  ].join("\n");
}

// Issue紐付きLead起動時のチーム先行並列: 関連specialistを先に並行実行し、
// その回答をLeadが統合する。統合ターンでは再consultを禁止する（allowConsult=false）。
export async function runTeamParallelKickoff(
  leadRun: AgentRun,
  rawTask: string,
  maskedTask: string,
  issueId: string,
): Promise<void> {
  const agents = selectRelatedSpecialists(issueId);
  appendLog(
    leadRun,
    "system",
    `[チーム先行並列] ${agents.join("・")} に分析を依頼し、その後Leadが統合判断します`,
  );

  const specialistMasked = buildSpecialistKickoffQuestion(maskedTask);
  const specialistRaw = buildSpecialistKickoffQuestion(rawTask);

  const specialistRuns = agents.map((agentName) => {
    const specialistRun: AgentRun = {
      id: randomUUID(),
      agentName,
      task: specialistMasked,
      status: "active",
      log: [],
      totalCostUsd: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      consultedBy: leadRun.id,
      origin: leadRun.origin,
      reviewed: leadRun.reviewed,
      sourceJournalId: leadRun.sourceJournalId,
    };
    runs.set(specialistRun.id, specialistRun);
    appendLog(specialistRun, "meta", `${leadRun.agentName}からのチーム先行分析依頼`);
    return specialistRun;
  });

  await Promise.all(specialistRuns.map((r) => runClaudeTurn(r, specialistRaw, false, specialistMasked)));

  const answers = specialistRuns.map((r) => {
    const lastAgentLine = [...r.log].reverse().find((l) => l.channel === "agent");
    return {
      agentName: r.agentName,
      answerText: lastAgentLine?.text ?? "(専門エージェントから回答を取得できませんでした)",
    };
  });

  for (const { agentName, answerText } of answers) {
    appendLog(leadRun, "agent", `[${agentName}からの回答]\n${answerText}`);
  }

  const followUp = [
    "元のタスク:",
    maskedTask,
    "",
    `${agents.join("・")}による先行分析の結果は以下の通りです。`,
    "",
    ...answers.map(({ agentName, answerText }) => `【${agentName}】\n${answerText}`),
    "",
    agents.length > 1
      ? "これらを踏まえて、最終的な結論をproposalブロック（追加でEMの判断が必要ならyieldブロック）として出力してください。追加の専門エージェントへの相談はできません。回答の間で見解が割れている場合は、判断ロジックの中でどちらを重視したか・なぜかを明記してください。"
      : "これを踏まえて、最終的な結論をproposalブロック（追加でEMの判断が必要ならyieldブロック）として出力してください。追加の専門エージェントへの相談はできません。",
  ].join("\n");

  await runClaudeTurn(leadRun, followUp, false, followUp);
}

// docs/usage_issues U19。エージェントが ```lookup``` で要求した読み取り専用照会を
// アプリ側で実行し、結果を同一 run の次ターンへ返す（consult と同型のオーケストレーション）。
// CLI ネイティブツールは無効のままなので、secure ディレクトリや書き込み API には触れない。
async function handleLookup(run: AgentRun, lookup: LookupRequest, allowConsult: boolean): Promise<void> {
  const used = run.lookupRounds ?? 0;
  // 上限チェックは applyAssistantResultText 側でも行う。ここは防御的に。
  if (used >= LOOKUP_MAX_ROUNDS) {
    run.status = "yield";
    run.yieldRequest = {
      reason:
        "追加照会の上限に達したため、これ以上の自動検索はできません。注入済みナレッジとこれまでの照会結果で判断できない点があれば、EMから情報を補ってください。",
      kind: "inform",
      options: [],
    };
    appendLog(run, "system", `[追加照会] 上限（${LOOKUP_MAX_ROUNDS}回）に達したため拒否しました`);
    return;
  }

  run.lookupRounds = used + 1;
  const remaining = LOOKUP_MAX_ROUNDS - run.lookupRounds;
  const resultBlock = await executeLookup(lookup);
  appendLog(run, "system", `[追加照会] 結果を返しました（この会話での残り照会回数: ${remaining}）`);

  const followUp = [
    "追加照会の結果は以下のとおりです。",
    "",
    resultBlock,
    "",
    remaining > 0
      ? `さらに確認が必要なら再度 lookup できます（残り ${remaining} 回）。十分なら proposal または yield（Lead なら必要時 consult）を出力してください。`
      : "これ以上の lookup はできません。上記と注入済みナレッジだけで proposal または yield を出力してください。",
    "関連が無いことは、照会結果に『なし』と出ている範囲では断言して構いません。",
  ].join("\n");

  // resultBlock はマスク済みストア由来。実名を含まない。
  await runClaudeTurn(run, followUp, allowConsult, followUp);
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
      sourceJournalId: leadRun.sourceJournalId,
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

export { runClaudeTurn };
