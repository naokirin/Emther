import { embedText } from "@/lib/embeddings";
import { getIssue, getIssueByRunId, issueEmbedSource } from "@/lib/issue-store";
import { listActiveFactsForPerson, listInterpretationsForPerson, searchSimilarEvents, type KnowledgeEvent } from "@/lib/knowledge-store";
import {
  getOrgStrategy,
  getTeam,
  listActiveOrgBackgrounds,
  listActiveTeams,
  listObjectives,
  type OrgBackgroundEntry,
  type Team,
} from "@/lib/org-context-store";
import { listPeople, maskNames } from "@/lib/people-directory";
import { buildRelatedBundleBlock } from "@/lib/related-context";
import { LOOKUP_MAX_QUERIES, LOOKUP_MAX_ROUNDS } from "@/lib/agent-knowledge-tools";
import { getRulesAndConstraints, getSelfPersonId } from "@/lib/settings-store";
import { listAdoptedThemes } from "@/lib/theme-store";
import { INTERVENTION_TYPES, teamDisplayName, teamPathSegments } from "@/lib/types";
import { CONSULT_ROUTING_TABLE, EXEC_AGENT_NAME, INTERVENTION_TYPE_AGENTS, QUADRANT_SPECIALISTS, ROLE_BLOCKS, SPECIALIST_AGENTS, SPECIALIST_ROLE_TAIL } from "./agent-catalog";
import {
  buildDistillationContextBlock,
  buildGrowContextBlock,
  buildJournalBatchContextBlock,
  buildMorningSummaryContextBlock,
} from "./batch-context-blocks";
import { extractJournalAutoAnalysisText } from "./extraction";
import { runs } from "./store";
import type { AgentRun } from "./types";

// 紐づくIssueのtagsに介入の型が含まれ、かつそのagentNameが主担当／副担当に該当する場合、
// 「この介入型を主軸に」という一文を足す。該当しない場合はブロック自体を省略する
// （無関係な介入型の指示で専門性をブレさせないため）。
// docs/usage_issues U3。専門AgentのrunはIssueに直接紐付かない（consultedByだけが親Leadを指す）。
// getIssueByRunId(そのrun)だとWhy/What/Howが空になり、「分からない」Yieldの原因になる。
export function resolveIssueForRun(runId: string) {
  const direct = getIssueByRunId(runId);
  if (direct) return direct;
  const seen = new Set<string>();
  let currentId: string | undefined = runId;
  while (currentId && !seen.has(currentId)) {
    seen.add(currentId);
    currentId = runs.get(currentId)?.consultedBy;
    if (currentId) {
      const viaParent = getIssueByRunId(currentId);
      if (viaParent) return viaParent;
    }
  }
  return undefined;
}

export function buildInterventionTypeGuidance(runId: string | undefined, agentName: string): string {
  if (!runId) return "";
  const issue = resolveIssueForRun(runId);
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

/** Standing Background（tagged）が現在の手がかりにヒットするか。 */
function backgroundMatchesContext(entry: OrgBackgroundEntry, haystack: string, issueTags: string[]): boolean {
  const lowerHay = haystack.toLowerCase();
  const entryTags = entry.tags.map((t) => t.toLowerCase()).filter(Boolean);
  if (issueTags.some((t) => entryTags.includes(t.toLowerCase()))) return true;
  if (entryTags.some((t) => lowerHay.includes(t))) return true;
  const title = entry.title.trim().toLowerCase();
  if (title && lowerHay.includes(title)) return true;
  return false;
}

/**
 * Standing Background: 組織の長期背景事実＋判断への含意。
 * scope=always は常時、tagged は Issue タグ／タスク文などの手がかりがあるときだけ注入する。
 */
export function buildOrgBackgroundBlock(runId?: string, rawText?: string): string {
  const active = listActiveOrgBackgrounds();
  if (active.length === 0) return "";

  const issue = runId ? (getIssueByRunId(runId) ?? resolveIssueForRun(runId)) : undefined;
  const runTask = runId ? runs.get(runId)?.task ?? "" : "";
  const haystack = [
    rawText ?? "",
    runTask,
    issue?.title ?? "",
    issue?.charter.why ?? "",
    issue?.charter.what ?? "",
    issue?.charter.how ?? "",
    ...(issue?.tags ?? []),
  ]
    .join("\n")
    .toLowerCase();
  const issueTags = issue?.tags ?? [];

  const selected = active.filter((e) => {
    if (e.scope === "always") return true;
    return backgroundMatchesContext(e, haystack, issueTags);
  });
  if (selected.length === 0) return "";

  const lines = selected.map((e) => {
    const when = e.occurredOn ? `[${e.occurredOn}] ` : "";
    const parts = [`- ${when}${e.title}`, `  事実: ${e.fact}`];
    if (e.implication.trim()) parts.push(`  含意: ${e.implication}`);
    if (e.tags.length > 0) parts.push(`  tags: ${e.tags.join(", ")}`);
    return parts.join("\n");
  });
  return [
    "組織の背景事実（Standing Background、絶対の前提として扱うこと。事実と含意を混同しないこと。含意は現時点の判断拘束であり、事実そのものの拡大解釈はしない）:",
    ...lines,
  ].join("\n");
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
  if (agentName === "Product Agent" || agentName === "Lead Agent" || agentName === EXEC_AGENT_NAME) {
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
    // docs/usage_issues U18: 判断理由などの補足も絶対の前提として渡す。
    const note = o.note?.trim() ? `\n  メモ: ${o.note}` : "";
    return `- ${o.title} — ${krs}${note}`;
  });
  return [objectivesBlockIntro(agentName), ...lines].join("\n");
}

// docs/knowledge_distillation.md。採用済みテーマ解釈のみを絶対の前提として注入する。
// 候補・却下は載せない（EM未承認の見立てで推論を汚さない）。
export function buildThemesContextBlock(): string {
  const themes = listAdoptedThemes();
  if (themes.length === 0) return "";
  const lines = themes.map((t) => {
    const parts = [`- ${t.title}: ${t.summary}`];
    if (t.rootCause) parts.push(`  根本原因の見立て: ${t.rootCause}`);
    if (t.suggestedDirection) parts.push(`  解決の方向性: ${t.suggestedDirection}`);
    parts.push(`  なぜこの解釈か: ${t.rationale}`);
    return parts.join("\n");
  });
  return [
    "組織の採用済みテーマ解釈（状況蒸留の成果、絶対の前提として扱うこと。個別Issueはこれらの具体化・矛盾・例外として読め）:",
    ...lines,
  ].join("\n");
}

// docs/knowledge_distillation.md 後続 1・2。
// Issue 壁打ち・Journal 自動分析向けに関連 Journal/Issue 束をシステムプロンプトへ載せる。
// run.task には載せない（U13）。
export async function buildRelatedContextForRun(run: AgentRun, rawText?: string): Promise<string> {
  try {
    if (run.origin === "auto-anomaly") {
      const queryText = extractJournalAutoAnalysisText(rawText ?? run.task);
      return await buildRelatedBundleBlock({ queryText, mode: "journal-analysis" });
    }
    const issue = getIssueByRunId(run.id) ?? (run.id ? resolveIssueForRun(run.id) : undefined);
    if (!issue) return "";
    return await buildRelatedBundleBlock({
      queryText: issueEmbedSource(issue),
      excludeIssueId: issue.id,
      mode: "issue-wallbash",
    });
  } catch {
    return "";
  }
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

  const linkedTeamId = runId ? resolveIssueForRun(runId)?.teamId : undefined;
  if (linkedTeamId) relevantIds.add(linkedTeamId);

  if (rawText) {
    for (const t of teams) {
      // ユーザー要望「チーム名についても表記揺れ対応できると嬉しい」対応。正式名・
      // 階層セグメントに加え、登録済みの別名（略称・旧名等）も照合対象にする。
      const segments = [t.name, ...teamPathSegments(t.name), ...t.aliases];
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
  const selfPersonId = getSelfPersonId();

  const lines = scoped.map((t) => {
    if (t.members.length === 0) return `- ${teamDisplayName(t.name)}: (メンバー未登録)`;
    const labeled = t.members.map((m) => (selfPersonId && m === selfPersonId ? `${m}（利用者本人）` : m));
    return `- ${teamDisplayName(t.name)}: ${labeled.join(", ")}`;
  });
  if (selfPersonId) {
    lines.unshift(`利用者本人（このアプリを使うEM）: ${selfPersonId}`);
  }
  // メンバーは PERSON_n 済みだが、チーム名が人物名と一致／部分一致するケース
  // （NER誤登録や、人名チーム）がある。送信直前 assert で落ちないよう maskNames する。
  return maskNames(["組織のチーム構成（Organization Context、絶対の前提として扱うこと）:", ...lines].join("\n"));
}

// docs 3.1「動的ロード」: そのrunが提案（Suggestion）に紐づいている場合、タイトルとメモを
// 「絶対の前提」としてエージェントに渡す。docs/2nd_pivot_version.md Phase 7。
export function buildIssueContextBlock(runId: string): string {
  const issue = resolveIssueForRun(runId);
  if (!issue) return "";

  const lines = ["このタスクが紐づく提案の前提（絶対の前提として扱うこと）:", `タイトル: ${issue.title}`];
  const recentMemos = issue.logEntries.slice(-5);
  if (recentMemos.length > 0) {
    lines.push("最近のメモ:");
    for (const m of recentMemos) {
      lines.push(`- ${m.text}`);
    }
  }
  return lines.join("\n");
}

// docs/memo.md「I. チーム単位の憲法（ミッション／制約）」対応。buildOrgContextBlockが
// 全チームの名簿を常時注入するのに対し、こちらは「そのIssueが紐づくチーム」1つだけの
// Mission/制約を動的にロードする（docs/memo.md TODO「Organization Contextの動的ロードを
// 対象Issueに関連するチームのみに絞る」に対応する部分）。Mission/制約が両方未設定なら
// 渡す情報が無いのでブロック自体を省略する。
export function buildTeamCharterBlock(runId: string): string {
  const issue = resolveIssueForRun(runId);
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
// docs/memo.md「Journalから分析をするときに、分析元のJournalを検索等で検出して
// 『複数回報告されている』と誤って判定されてしまう」対応。excludeEventIdは、いま分析中の
// Journal自身のイベントID（run.sourceJournalId）。渡された場合、ファクト一覧・意味的類似
// 検索の両方から自分自身を除外する（自分自身を「過去の類似事例」として見せてしまうと、
// 単発の新規報告なのにAIが「既出・繰り返し報告されている」と誤解する）。
export async function buildJournalContextBlock(
  rawText: string,
  agentName: string,
  excludeEventId?: string,
): Promise<string> {
  const mentioned = listPeople().filter((p) => rawText.includes(p.name) || rawText.includes(p.id));
  const isPeopleAgent = agentName === "People Agent";
  const factLimit = isPeopleAgent ? PERSON_FACT_LIMIT_PEOPLE : PERSON_FACT_LIMIT_DEFAULT;

  const factLines: string[] = [];
  const interpretationLines: string[] = [];
  let omittedInterpretationCount = 0;
  const seenIds = new Set<string>();
  for (const person of mentioned) {
    for (const e of listActiveFactsForPerson(person.id, factLimit, excludeEventId)) {
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
    const similarFacts = searchSimilarEvents(queryEmbedding, { kind: "fact", limit: 3, excludeId: excludeEventId });
    const similarInterpretations = searchSimilarEvents(queryEmbedding, {
      kind: "interpretation",
      limit: 3,
      excludeId: excludeEventId,
    });
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

// 朝のサマリー・週次の状況蒸留の材料組み立て（buildMorningSummaryContextBlock/
// buildDistillationContextBlock）は./batch-context-blocksへ切り出した。

export function buildSystemPrompt(
  agentName: string,
  allowConsult: boolean,
  runId?: string,
  journalContext?: string,
  rawText?: string,
  relatedContext?: string,
): string {
  const requiredConsultAgents = (runId ? runs.get(runId)?.requiredConsultAgents : undefined)?.filter((a) =>
    SPECIALIST_AGENTS.includes(a),
  );
  const requiredConsultRule =
    agentName === "Lead Agent" && allowConsult && requiredConsultAgents && requiredConsultAgents.length > 0
      ? [
          `- 【必須】この相談では、結論（proposal/yield）を出す前に必ず ${requiredConsultAgents.map((a) => `「${a}」`).join("・")} をconsultのagentsに含めてください。当該エージェントへの相談なしにproposal/yieldしてはなりません。他の専門エージェントと同時に並行consultして構いません。lookupによる追加照会は先に行っても構いません。`,
          "",
        ]
      : [];

  const consultRule =
    agentName === "Lead Agent" && allowConsult
      ? [
          `- あなたはリードエージェントとして、必要なら専門エージェント（People Agent / Process Agent / Tech Agent / Product Agent / ${EXEC_AGENT_NAME}）のうち1つ以上に、1ターンにつき1回だけ相談できます。複数の専門性にまたがる論点なら、複数の専門エージェントに同時に（並行して）相談し、それぞれの回答を踏まえて結論を出してください。`,
          ...CONSULT_ROUTING_TABLE,
          "  自分（たち）の専門外の知識が結論の質を左右すると判断した場合、proposal/yieldの代わりに以下の形式でconsultブロックを1つだけ出力してください（相談は1回のみ。2回目以降は使えません）。",
          "  ```consult",
          '  { "agents": ["People Agent", "Tech Agent"], "question": "相談内容の要約（ログ用。questionsを省略したagentにはこの文面がそのまま送られます）", "questions": { "People Agent": "People Agent宛の質問（人物面だけを聞く）", "Tech Agent": "Tech Agent宛の質問（技術要因だけを聞く）" } }',
          "  ```",
          `  agentsには "People Agent" / "Process Agent" / "Tech Agent" / "Product Agent" / "${EXEC_AGENT_NAME}" のうち1つ以上を、本当に必要な専門性だけに絞って指定してください（無関係なエージェントを含めるとコストが無駄に増えます）。`,
          '  questionsは任意ですが、同じ長文タスクを丸投げしないため強く推奨します。agentsに含まれるエージェントごとに「その専門性だけで答えられる問い」を1文で書き分けてください（例: 「Peopleには人物面だけ、Processには流れの詰まりだけ」）。questionsで指定しなかったagentにはquestionがそのまま使われます。',
          "",
          ...requiredConsultRule,
        ]
      : [];

  // docs/2nd_pivot_version.md Phase 7。サブIssue分解・Charter埋め提案は廃止。
  // 他提案へのメモ追記のみ残す。
  const issueNoteRule = [
    "- 相談やlookupの過程で、このタスクとは別の提案に関わる重要な事実・懸念を見つけた場合は、その提案への一言メモを提案できます。proposalブロックに続けて以下の形式でissue_noteブロックを追加してください（無ければ省略して構いません。yieldする場合は出力しないこと。issueIdはlookup結果で得た実在の提案IDのみを使い、推測や新規作成はしないこと）。",
    "```issue_note",
    '[{ "issueId": "lookupで見つけた提案ID", "text": "その提案に追記する短い一言（1〜2文）" }]',
    "```",
    "",
  ];

  // docs/suggestion_organize_via_consult.md。EMが「提案を整理して」等と明示的に依頼した
  // ときだけ、Leadが既存提案（実在ID）の状態変更をまとめて提案できる。裏での自動書き換えは
  // 禁止のため、この出力自体もEMからの明示依頼が入口。入口を相談（Lead Agent）に限定する。
  const suggestionUpdatesRule =
    agentName === "Lead Agent"
      ? [
          "- EMがこの相談で「提案を整理して」「未確認の提案を圧縮して」「重複をまとめて」など、既存提案のポートフォリオ整理を明示的に依頼した場合に限り、proposalブロックに続けて以下の形式でsuggestion_updatesブロックを1つ追加できます（依頼されていないのに自発的に出力してはならない。yieldする場合は出力しないこと。suggestionIdはlookupで確認した実在の提案IDのみを使い、推測や新規作成はしないこと）。",
          "```suggestion_updates",
          "[",
          "  {",
          '    "suggestionId": "lookupで見つけた実在の提案ID",',
          '    "reviewStatus": "unreviewed | in_review | deferred | done のいずれか（任意）",',
          '    "confirmPriority": "focus | normal | parked のいずれか（任意）",',
          '    "reviewDueAt": "YYYY-MM-DD（確認期日を設定/延長する場合。解除する場合はnull）（任意）",',
          '    "archived": "true（重複・誤起票をアーカイブ）/ false（アーカイブ解除）（任意）",',
          '    "note": "整理理由の一言メモ（採用時にその提案へ追記される。任意）",',
          '    "reason": "なぜこの変更が妥当か（必須。差分一覧・監査用にEMへ表示される）"',
          "  }",
          "]",
          "```",
          "  変更してよいフィールドの種類は制限しません（reviewStatus/confirmPriority/reviewDueAt/archived/noteのいずれも、必要な範囲で自由に組み合わせてよい）。reasonは各要素に必ず含めてください。",
          "  典型的な整理: 重複は1件に寄せて他をarchived、もう追わないものはreviewStatus: \"done\"、残すが今ではないものはconfirmPriority: \"parked\"やreviewStatus: \"deferred\"（必要ならreviewDueAtも）、今日見るべき少数だけをconfirmPriority: \"focus\"（目安3件程度まで）にしてください。",
          "  このブロックは「まとめて反映」でEMが一括承認するまでSuggestion本体には反映されません。個々の要素を採用させるための説明を、proposalの本文側にも簡潔に書いてください。",
          "",
        ]
      : [];

  // docs/2nd_pivot_version.md Phase 2.4対応。優先度（focus/normal/parked）の提案は、
  // 採用/却下UIを廃止したため出力させても宙に浮くだけになった。プロンプトからも外す。

  const roleBlockLines = ROLE_BLOCKS[agentName] ?? [];
  const roleBlock =
    roleBlockLines.length > 0
      ? [...roleBlockLines, ...(agentName === "Lead Agent" ? [] : [SPECIALIST_ROLE_TAIL]), ""]
      : [];

  const base = [
    `あなたはEM(エンジニアリングマネージャー)支援システムの一部として動作する「${agentName}」です。`,
    "判断材料は、(1) このターンで渡されたタスク文と、(2) このシステムプロンプト末尾にシステムが注入した組織ナレッジ（提案・Journal・Team Vitals・戦略・テーマ等のスナップショット）と、(3) 必要に応じてあなたが発行する追加照会（lookup）の結果です。",
    "任意のファイル・データベース・外部システムへの直接アクセスや、書き込み・破壊的操作はできません（CLIネイティブツールは無効化されています）。一方で、注入済みのナレッジブロックはすでに渡されている判断材料です。それを無視して「前提情報が無い」「課題テキストが提示されていない」と述べないでください。",
    "注入される関連提案/Journalはベクトル類似の上位最大5件です。『関連に無いのは意図的か』『キーワードで全件確認したい』『確認済みも含めたい』など、注入だけでは確証が取れないときは、提案やyieldの前にlookupで追加照会してください。本当にlookup結果にも無い情報だけが不足している場合に限り yield（inform）してください。",
    "",
    ...roleBlock,
    "回答のルール:",
    ...consultRule,
    "- 注入された関連束だけでは足りない／『無いこと』を確認したい場合は、proposal/yield/consultの代わりに以下の形式でlookupブロックを1つだけ出力してください（1回の応答につき最大1ブロック。クエリは最大" +
      String(LOOKUP_MAX_QUERIES) +
      "件。同一会話で追加照会できるのは合計" +
      String(LOOKUP_MAX_ROUNDS) +
      "回まで）。",
    "  ```lookup",
    '  { "reason": "なぜ追加で確認したいか（任意）", "queries": [',
    '    { "type": "issues", "query": "キーワード", "includeDone": true, "includeArchived": false, "limit": 10 },',
    '    { "type": "issue", "id": "suggestion-id" },',
    '    { "type": "journals", "query": "キーワード", "limit": 10 },',
    '    { "type": "similar", "query": "意味検索したい文", "limit": 10 }',
    "  ] }",
    "  ```",
    '  type "issues" はタイトル・メモのキーワード部分一致（既定は未確認・確認保留のみ。includeDone/includeArchivedで確認済みも含める）。',
    '  type "issue" はID指定の1件詳細。type "journals" はJournalのキーワード検索。type "similar" は埋め込み類似。',
    "  結果は次のターンで渡されます。lookupとproposal/yield/consultを同時に出さないこと。",
    "",
    "- タスクを完結できる場合（yieldしない場合）は、通常の文章で説明したうえで、回答の最後に必ず以下の形式でproposalブロックを1つだけ出力してください。",
    "",
    "proposalブロックのフォーマット（このとおりのfenced code blockにすること）:",
    "```proposal",
    "{",
    '  "conclusion": "結論（一文で）",',
    '  "facts": ["判断の根拠にした参照ファクト（与えられた情報の中から）"],',
    '  "logic": "その結論に至った判断ロジック",',
    '  "rejectedAlternatives": [ { "option": "検討したが採用しなかった案", "reason": "棄却理由" } ],',
    '  "recommendation": "issue | dismiss | watch  （任意。EMが提案として残すべきかのときだけ。不要なら dismiss）",',
    '  "issueTitle": "短い提案タイトル（単一のとき。40文字以内・結論文ではなく題名）",',
    '  "issueCandidates": [ { "title": "独立した提案案1", "rationale": "なぜ別提案か（任意）" }, { "title": "独立した提案案2" } ]',
    "}",
    "```",
    "棄却した代替案が無い場合は rejectedAlternatives: [] としてください。ブラックボックスの提案は禁止です。",
    '提案として残すことを勧める場合（recommendation: "issue"）は、短いタイトルを付けてください。',
    "- 論点が1つなら issueTitle のみ。別チーム・別KR・別の観測に分かれるなら issueCandidates に最大5件まで列挙すること。",
    "- issueCandidates を出すときは recommendation は \"issue\" とし、issueTitle は代表の1件を書いても省略してもよい。",
    ...issueNoteRule,
    ...suggestionUpdatesRule,
    "",
    "- 次のいずれかに該当し、人間(EM)の判断や情報がなければ先に進めない場合は、proposalブロックの代わりに、回答の最後に必ず以下の形式でyieldブロックを1つだけ出力してください（yieldとproposalを同時に出さないこと）。",
    "  1. 複数の妥当な選択肢があり、組織の泥臭い文脈に基づく判断が必要なとき（kind: \"decide\"）",
    "  2. 判断に必須の前提情報が不足しているとき（kind: \"inform\"）",
    "  3. 介入の実行・人への働きかけ・優先順位の変更など、組織への働きかけの最終決定が必要なとき（kind: \"commit\"。これは常に人間EMが決める）",
    "",
    "yieldブロックのフォーマット（このとおりのfenced code blockにすること。前後に他の文章を混ぜないこと）:",
    "```yield",
    "{",
    '  "reason": "なぜ人間の判断が必要かの説明",',
    '  "kind": "decide | inform | commit のいずれか",',
    '  "options": [',
    '    { "id": "A", "label": "選択肢Aの短い名前", "detail": "説明", "risk": "懸念点" }',
    "  ]",
    "}",
    "```",
    '情報が単に不足しているだけで具体的な選択肢を提示できない場合は "options": [] としてください（この場合は通常kind: "inform"）。',
  ].join("\n");

  const issueContext = runId ? buildIssueContextBlock(runId) : "";
  const interventionTypeGuidance = buildInterventionTypeGuidance(runId, agentName);
  const teamCharterContext = runId ? buildTeamCharterBlock(runId) : "";
  const orgContext = buildOrgContextBlock(runId, rawText);
  const strategyContext = buildStrategyBlock();
  const backgroundContext = buildOrgBackgroundBlock(runId, rawText);
  const objectivesContext = buildObjectivesBlock(agentName);
  const themesContext = buildThemesContextBlock();
  // 状況蒸留・朝サマリー: 材料は task ではなくここで注入（task を短く保ち相談履歴に載せるため）。
  // 再開（decideRun）でも origin 判定だけで再注入する。
  const runOrigin = runId ? runs.get(runId)?.origin : undefined;
  const distillContext = runOrigin === "auto-distill" ? buildDistillationContextBlock() : "";
  const morningContext = runOrigin === "auto-summary" ? buildMorningSummaryContextBlock() : "";
  const growContext = runOrigin === "auto-grow" ? buildGrowContextBlock() : "";
  const journalBatchContext = runOrigin === "auto-journal-batch" ? buildJournalBatchContextBlock() : "";
  return [
    base,
    morningContext,
    distillContext,
    growContext,
    journalBatchContext,
    issueContext,
    relatedContext,
    interventionTypeGuidance,
    teamCharterContext,
    journalContext,
    orgContext,
    strategyContext,
    backgroundContext,
    objectivesContext,
    themesContext,
  ]
    .filter(Boolean)
    .join("\n\n");
}

// claude CLIの1ターン予算。SettingsのperTurnBudgetUsdを使い、未設定・不正時は0.5に落とす。
// Opus既定環境では0.5だと起動直後に予算超過しやすいため、/settingsから調整可能。
export function perTurnBudgetUsdArg(): string {
  const n = getRulesAndConstraints().perTurnBudgetUsd;
  const usd = typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0.5;
  return String(Math.max(0.01, usd));
}

// Issueの介入型タグから関連specialistを選ぶ。タグが無い／介入型に該当しない場合は
// 4象限（People/Process/Tech/Product）を返す。Exec Agentはオプトイン専用のため含めない。
export function selectRelatedSpecialists(issueId: string): string[] {
  const issue = getIssue(issueId);
  if (!issue || issue.tags.length === 0) return [...QUADRANT_SPECIALISTS];

  const selected = new Set<string>();
  for (const tag of issue.tags) {
    const mapping = INTERVENTION_TYPE_AGENTS[tag];
    if (!mapping) continue;
    for (const agent of mapping.primary) {
      if (QUADRANT_SPECIALISTS.includes(agent)) selected.add(agent);
    }
    for (const agent of mapping.secondary) {
      if (QUADRANT_SPECIALISTS.includes(agent)) selected.add(agent);
    }
  }
  if (selected.size === 0) return [...QUADRANT_SPECIALISTS];
  return QUADRANT_SPECIALISTS.filter((a) => selected.has(a));
}
