import { randomUUID } from "node:crypto";
import { LOOKUP_MAX_ROUNDS, executeLookup, extractLookup, type LookupRequest } from "../../agent-knowledge-tools";
import { createGrowSuggestions, enrichGrowSuggestionReferences } from "../../em-growth-store";
import { getRulesAndConstraints } from "../../settings-store";
import { CLI_LABELS, type CliName } from "../../types";
import { buildJournalContextBlock, buildRelatedContextForRun, buildSystemPrompt, selectRelatedSpecialists } from "../context-blocks";
import {
  consultQuestionFor,
  ensureRequiredConsult,
  extractConsult,
  extractGrowSuggestions,
  extractIssueNotes,
  extractPeriodReview,
  extractProposal,
  extractSuggestionUpdates,
  extractThemes,
  extractYield,
} from "../extraction";
import { appendLog, runs, sanitizeForCloud, setRunTriageStatus } from "../store";
import type { AgentRun, AgentStatus, ConsultRequest } from "../types";
import { runAgyCliAttempt } from "./agy";
import { runClaudeCliAttempt } from "./claude";
import { runCursorCliAttempt } from "./cursor";

// 個人情報の分離（ユーザー指摘対応）: クラウドが返すテキストは、渡したプロンプトが
// PERSON_n IDでマスクされている以上、常にPERSON_n IDのままである（クラウドが実名を
// 新たに生成することはあり得ない）。そのため、ここでは意図的にunmaskNamesを呼ばず、
// マスクされたままrun.log/yieldRequest/proposal等へ保存する。実名への復元は、EM向けの
// API応答を組み立てる境界（各APIルート）でだけ行う——保存経路には実名が一切乗らない。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function handleStreamEvent(run: AgentRun, event: any, allowConsult: boolean) {
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
export function applyAssistantResultText(run: AgentRun, resultText: string, allowConsult: boolean): void {
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
      run.suggestedIssueNotes = undefined;
      run.suggestedSuggestionUpdates = undefined;
      run.periodReview = undefined;
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
    run.suggestedIssueNotes = undefined;
    run.suggestedSuggestionUpdates = undefined;
    run.periodReview = undefined;
    appendLog(run, "system", `[YIELD] ${yieldRequest.reason}`);
  } else {
    run.status = "idle";
    run.yieldRequest = undefined;
    run.proposal = extractProposal(resultText);
    run.suggestedActionItems = undefined;
    run.suggestedSubIssues = undefined;
    run.suggestedCharter = undefined;
    // docs/2nd_pivot_version.md Phase 7: charter/sub_issues 提案は生成しない。
    run.suggestedPriority = undefined;
    run.suggestedThemes = run.proposal ? extractThemes(resultText) : undefined;
    run.suggestedIssueNotes = run.proposal ? extractIssueNotes(resultText) : undefined;
    run.suggestedSuggestionUpdates = run.proposal ? extractSuggestionUpdates(resultText) : undefined;
    // docs/new_reporting.md。週次・月次レビューの主出力。proposalの有無に関わらず、
    // このoriginのときだけ抽出する（他originのテキストにたまたまperiod_reviewブロック
    // 相当の文字列が混ざっても誤って拾わないようにする）。
    run.periodReview =
      run.origin === "auto-weekly-report" || run.origin === "auto-monthly-report"
        ? extractPeriodReview(resultText)
        : undefined;
    appendLog(
      run,
      "system",
      run.proposal ? "タスクが完了しました（人間の入力は不要です）。" : "タスクが完了しました（proposal形式には従いませんでした）。",
    );
    if (run.suggestedThemes) {
      appendLog(run, "system", `[テーマ解釈提案] ${run.suggestedThemes.length}件`);
    }
    if (run.suggestedIssueNotes) {
      appendLog(run, "system", `[他提案へのメモ追記提案] ${run.suggestedIssueNotes.length}件`);
    }
    if (run.suggestedSuggestionUpdates) {
      appendLog(run, "system", `[提案の整理差分] ${run.suggestedSuggestionUpdates.length}件`);
    }
    if (run.periodReview) {
      appendLog(run, "system", "[期間レビュー] period_reviewブロックを受け取りました");
    }
    // docs/2nd_pivot_version.md Phase 8。Growの提案は組織の前提を変更しない「EMへの
    // 参考情報」そのものなので、他のsuggested*と異なり採用/却下の中間段階を挟まず、
    // 生成された時点でem-growth-storeへ直接確定させる（朝サマリーのproposalと同じ扱い）。
    if (run.origin === "auto-grow") {
      const growDrafts = extractGrowSuggestions(resultText);
      if (growDrafts && growDrafts.length > 0) {
        const created = createGrowSuggestions(growDrafts, { sourceRunId: run.id });
        appendLog(run, "system", `[学びの提案] ${growDrafts.length}件`);
        // ユーザー要望「検索ばかりなので、もう少し直接知れるリンク先を探すようにしてほしい」
        // 対応。urlが無い参照をWikipediaで後追い補完する（fire-and-forget。run完了を
        // ブロックしない。失敗しても学びの提案自体は既に保存済みなので無視してよい）。
        void enrichGrowSuggestionReferences(created).catch(() => {});
      }
    }
    // docs/usage_issues U2。Journal分析（EM明示の個別分析／日次の集約解釈）が追跡不要と
    // 明示したときだけ自動却下する。手動相談やIssue更新分析はEMのトリアージ対象のまま残す。
    if (
      (run.origin === "auto-anomaly" || run.origin === "auto-journal-batch") &&
      run.proposal?.recommendation === "dismiss"
    ) {
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
export async function withRunSlot<T>(run: AgentRun, fn: () => Promise<T>): Promise<T> {
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

export async function runClaudeTurn(
  run: AgentRun,
  rawPrompt: string,
  allowConsult = true,
  precomputedPrompt?: string,
): Promise<void> {
  // 非同期のsanitizeForCloud()を待つ前に同期でactiveへ倒しておく。
  // でないとdecideRun()が呼び出し直後に返すrunの状態がまだ古いまま（yield/idle）になり、
  // 「実行中は入力を受け付けない」というdecideRunの多重実行ガードもすり抜けてしまう。
  run.status = "active";
  run.pendingConsult = undefined;
  run.pendingLookup = undefined;

  // 実名でのマッチングが必要なので、maskNamesで置換される前のrawPromptに対して行う。
  // 再開時に「続けて」だけの短い入力だと意味検索が枯れるため、元タスク文もクエリに含める。
  const contextQuery = rawPrompt.trim() === run.task.trim() ? rawPrompt : `${rawPrompt}\n${run.task}`;
  const journalContext = await buildJournalContextBlock(contextQuery, run.agentName, run.sourceJournalId);
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

function buildSpecialistKickoffQuestion(task: string): string {
  return [
    task,
    "",
    "【依頼】あなたの専門領域の観点だけで分析し、proposal（または情報不足ならyield）を出してください。",
    "他象限の本論には踏み込まないでください。",
  ].join("\n");
}

// 提案紐付きLead起動時のチーム先行並列: 関連specialistを先に並行実行し、
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
