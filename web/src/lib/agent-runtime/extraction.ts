import {
  CONFIRM_PRIORITIES,
  ISSUE_PRIORITIES,
  SUGGESTION_REVIEW_STATUSES,
  type IssuePriority,
  type YieldKind,
} from "@core/types";
import { dateStringToNoonTimestamp } from "@core/journal-date-parser";
import type { IssueCharter } from "@core/issue-store";
import type { GrowReference, GrowSuggestionDraft } from "@/lib/em-growth-store";
import type { SuggestedTheme } from "@/lib/theme-store";
import { EXEC_AGENT_NAME, SPECIALIST_AGENTS } from "./agent-catalog";
import type {
  AgentRun,
  ConsultRequest,
  IssueCandidate,
  Proposal,
  RejectedAlternative,
  SuggestedIssueNote,
  SuggestedSubIssue,
  SuggestionUpdate,
  YieldOption,
  YieldRequest,
} from "./types";

/** proposal から起票用タイトル候補を返す。issueCandidates があればそれを使い、無ければ issueTitle 1件。 */
export function listIssueCandidatesFromProposal(proposal?: Proposal | null): IssueCandidate[] {
  if (!proposal) return [];
  const fromArray = normalizeIssueCandidates(proposal.issueCandidates);
  if (fromArray && fromArray.length > 0) return fromArray;
  const single = proposal.issueTitle?.trim();
  return single ? [{ title: single }] : [];
}

export function normalizeIssueCandidates(parsed: unknown): IssueCandidate[] | undefined {
  if (!Array.isArray(parsed)) return undefined;
  const items: IssueCandidate[] = [];
  for (const entry of parsed) {
    if (typeof entry === "string" && entry.trim()) {
      items.push({ title: entry.trim() });
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    const title = (entry as { title?: unknown }).title;
    if (typeof title !== "string" || !title.trim()) continue;
    const rationaleRaw = (entry as { rationale?: unknown }).rationale;
    const rationale =
      typeof rationaleRaw === "string" && rationaleRaw.trim() ? rationaleRaw.trim() : undefined;
    items.push(rationale ? { title: title.trim(), rationale } : { title: title.trim() });
  }
  return items.length > 0 ? items : undefined;
}

const KNOWN_YIELD_KINDS: YieldKind[] = ["decide", "inform", "commit"];

// docs/em_ui_ux_issue.md 5節対応。kindはAIの自己申告のため、未知の値・欠落は
// options有無から機械的にフォールバック推定する（既存run・プロンプト非対応モデルとの後方互換）。
function normalizeYieldKind(value: unknown, options: YieldOption[]): YieldKind {
  if (typeof value === "string" && (KNOWN_YIELD_KINDS as string[]).includes(value)) {
    return value as YieldKind;
  }
  return options.length === 0 ? "inform" : "decide";
}

export function extractYield(resultText: string): YieldRequest | undefined {
  const match = resultText.match(/```yield\s*\n?([\s\S]*?)```/);
  if (!match) return undefined;
  try {
    const parsed = JSON.parse(match[1].trim());
    if (parsed && typeof parsed.reason === "string") {
      const options = Array.isArray(parsed.options) ? parsed.options : [];
      return {
        reason: parsed.reason,
        options,
        kind: normalizeYieldKind(parsed.kind, options),
      };
    }
  } catch {
    // 不正なyieldブロックは「yieldなし（通常完了）」として扱う
  }
  return undefined;
}

function normalizeStringList(parsed: unknown): string[] {
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((f: unknown): f is string => typeof f === "string" && f.trim().length > 0)
    .map((f) => f.trim());
}

// docs 3.5「構造化された提案」: 結論・参照ファクト・判断ロジック・棄却した代替案を
// 必ず含めさせる。docs/3rd_pivot_version/pivot.md で expansions / challenges を追加
// （欠落時は空配列＝旧run互換）。抽出できない（規約に従わなかった）場合はundefinedを返し、
// UI側は素のテキストログのみを表示する（無理に構造化して見せない）。
export function extractProposal(resultText: string): Proposal | undefined {
  const match = resultText.match(/```proposal\s*\n?([\s\S]*?)```/);
  if (!match) return undefined;
  try {
    const parsed = JSON.parse(match[1].trim());
    if (parsed && typeof parsed.conclusion === "string" && typeof parsed.logic === "string") {
      const recommendation =
        parsed.recommendation === "dismiss" || parsed.recommendation === "issue" || parsed.recommendation === "watch"
          ? parsed.recommendation
          : undefined;
      const issueTitle =
        typeof parsed.issueTitle === "string" && parsed.issueTitle.trim() ? parsed.issueTitle.trim() : undefined;
      const issueCandidates = normalizeIssueCandidates(parsed.issueCandidates);
      const advice = typeof parsed.advice === "string" && parsed.advice.trim() ? parsed.advice.trim() : undefined;
      return {
        conclusion: parsed.conclusion,
        facts: normalizeStringList(parsed.facts),
        logic: parsed.logic,
        rejectedAlternatives: Array.isArray(parsed.rejectedAlternatives)
          ? parsed.rejectedAlternatives.filter(
              (r: unknown): r is RejectedAlternative =>
                typeof r === "object" && r !== null && typeof (r as RejectedAlternative).option === "string",
            )
          : [],
        expansions: normalizeStringList(parsed.expansions),
        challenges: normalizeStringList(parsed.challenges),
        ...(recommendation ? { recommendation } : {}),
        ...(issueTitle ? { issueTitle } : {}),
        ...(issueCandidates ? { issueCandidates } : {}),
        ...(advice ? { advice } : {}),
      };
    }
  } catch {
    // 不正なproposalブロックは構造化なしとして扱う
  }
  return undefined;
}

// docs/memo.md「K. ズームイン／ズームアウトの協働計画」対応。AIが提案する子Issue分解案。
// extractYield/extractProposalと同じ壊れにくいパースの考え方（不正な形式は「提案なし」として扱う）。
// 要素は文字列、または { title, priority? }。旧DBの文字列配列も normalize で吸収する。
export function extractSubIssues(resultText: string): SuggestedSubIssue[] | undefined {
  const match = resultText.match(/```sub_issues\s*\n?([\s\S]*?)```/);
  if (!match) return undefined;
  try {
    const parsed = JSON.parse(match[1].trim());
    return normalizeSuggestedSubIssues(parsed);
  } catch {
    // 不正なsub_issuesブロックは「提案なし」として扱う
  }
  return undefined;
}

// docs/memo.md「Agentが相談などから他Issueなどへ記録することができない」対応。
// lookupで見つけた別Issueへの追記提案。extractSubIssuesと同じ
// 壊れにくいパースの考え方（不正な形式・issueId/text欠落の要素は捨てるだけで、
// ブロック自体は「提案なし」として扱う）。
export function extractIssueNotes(resultText: string): SuggestedIssueNote[] | undefined {
  const match = resultText.match(/```issue_note\s*\n?([\s\S]*?)```/);
  if (!match) return undefined;
  try {
    const parsed = JSON.parse(match[1].trim());
    if (!Array.isArray(parsed)) return undefined;
    const items = parsed.filter(
      (n: unknown): n is SuggestedIssueNote =>
        !!n &&
        typeof n === "object" &&
        typeof (n as SuggestedIssueNote).issueId === "string" &&
        (n as SuggestedIssueNote).issueId.trim().length > 0 &&
        typeof (n as SuggestedIssueNote).text === "string" &&
        (n as SuggestedIssueNote).text.trim().length > 0,
    );
    return items.length > 0 ? items : undefined;
  } catch {
    // 不正なissue_noteブロックは「提案なし」として扱う
  }
  return undefined;
}

// docs/suggestion_organize_via_consult.md。EMが相談で明示的に「提案を整理して」等と
// 依頼したときだけ、AIが提案する既存提案（実在ID）の状態変更下書き。extractIssueNotesと
// 同じ壊れにくいパースの考え方（要素単位で不正な値は捨て、有効な変更が1つも残らない
// 要素は捨てる。ブロック自体が不正なら「提案なし」として扱う）。reasonは必須（差分表示・
// 監査用の根拠を必ず持たせる方針のため）。
export function extractSuggestionUpdates(resultText: string): SuggestionUpdate[] | undefined {
  const match = resultText.match(/```suggestion_updates\s*\n?([\s\S]*?)```/);
  if (!match) return undefined;
  try {
    const parsed = JSON.parse(match[1].trim());
    if (!Array.isArray(parsed)) return undefined;
    const items: SuggestionUpdate[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") continue;
      const suggestionIdRaw = (entry as { suggestionId?: unknown }).suggestionId;
      const reasonRaw = (entry as { reason?: unknown }).reason;
      if (typeof suggestionIdRaw !== "string" || !suggestionIdRaw.trim()) continue;
      if (typeof reasonRaw !== "string" || !reasonRaw.trim()) continue;

      const reviewStatusRaw = (entry as { reviewStatus?: unknown }).reviewStatus;
      const reviewStatus =
        typeof reviewStatusRaw === "string" && (SUGGESTION_REVIEW_STATUSES as string[]).includes(reviewStatusRaw)
          ? (reviewStatusRaw as SuggestionUpdate["reviewStatus"])
          : undefined;

      const confirmPriorityRaw = (entry as { confirmPriority?: unknown }).confirmPriority;
      const confirmPriority =
        typeof confirmPriorityRaw === "string" && (CONFIRM_PRIORITIES as string[]).includes(confirmPriorityRaw)
          ? (confirmPriorityRaw as SuggestionUpdate["confirmPriority"])
          : undefined;

      const reviewDueAtRaw = (entry as { reviewDueAt?: unknown }).reviewDueAt;
      let reviewDueAt: number | null | undefined;
      if (reviewDueAtRaw === null) {
        reviewDueAt = null;
      } else if (typeof reviewDueAtRaw === "string" && reviewDueAtRaw.trim()) {
        const ts = dateStringToNoonTimestamp(reviewDueAtRaw.trim());
        if (ts !== undefined) reviewDueAt = ts;
      }

      const archivedRaw = (entry as { archived?: unknown }).archived;
      const archived = typeof archivedRaw === "boolean" ? archivedRaw : undefined;

      const noteRaw = (entry as { note?: unknown }).note;
      const note = typeof noteRaw === "string" && noteRaw.trim() ? noteRaw.trim() : undefined;

      // reason以外に何も変更が無い要素は「整理差分」として意味を持たないため捨てる。
      if (
        reviewStatus === undefined &&
        confirmPriority === undefined &&
        reviewDueAt === undefined &&
        archived === undefined &&
        note === undefined
      ) {
        continue;
      }

      items.push({
        suggestionId: suggestionIdRaw.trim(),
        reason: reasonRaw.trim(),
        ...(reviewStatus !== undefined ? { reviewStatus } : {}),
        ...(confirmPriority !== undefined ? { confirmPriority } : {}),
        ...(reviewDueAt !== undefined ? { reviewDueAt } : {}),
        ...(archived !== undefined ? { archived } : {}),
        ...(note !== undefined ? { note } : {}),
      });
    }
    return items.length > 0 ? items : undefined;
  } catch {
    // 不正なsuggestion_updatesブロックは「提案なし」として扱う
  }
  return undefined;
}

export function parseSuggestedPriority(value: unknown): IssuePriority | undefined {
  return typeof value === "string" && (ISSUE_PRIORITIES as string[]).includes(value)
    ? (value as IssuePriority)
    : undefined;
}

export function normalizeSuggestedSubIssues(parsed: unknown): SuggestedSubIssue[] | undefined {
  if (!Array.isArray(parsed)) return undefined;
  const items: SuggestedSubIssue[] = [];
  for (const entry of parsed) {
    if (typeof entry === "string" && entry.trim()) {
      items.push({ title: entry.trim() });
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    const title = (entry as { title?: unknown }).title;
    if (typeof title !== "string" || !title.trim()) continue;
    const priority = parseSuggestedPriority((entry as { priority?: unknown }).priority);
    items.push(priority ? { title: title.trim(), priority } : { title: title.trim() });
  }
  return items.length > 0 ? items : undefined;
}

// docs/knowledge_distillation.md。状況蒸留のテーマ候補。
export function extractThemes(resultText: string): SuggestedTheme[] | undefined {
  const match = resultText.match(/```themes\s*\n?([\s\S]*?)```/);
  if (!match) return undefined;
  try {
    const parsed = JSON.parse(match[1].trim());
    if (!Array.isArray(parsed)) return undefined;
    const items: SuggestedTheme[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") continue;
      const title = (entry as { title?: unknown }).title;
      const summary = (entry as { summary?: unknown }).summary;
      const rationale = (entry as { rationale?: unknown }).rationale;
      if (typeof title !== "string" || !title.trim()) continue;
      if (typeof summary !== "string" || !summary.trim()) continue;
      if (typeof rationale !== "string" || !rationale.trim()) continue;
      const factsRaw = (entry as { facts?: unknown }).facts;
      const facts = Array.isArray(factsRaw)
        ? factsRaw.filter((f): f is string => typeof f === "string" && f.trim().length > 0)
        : [];
      const rootCause =
        typeof (entry as { rootCause?: unknown }).rootCause === "string"
          ? (entry as { rootCause: string }).rootCause.trim() || undefined
          : undefined;
      const suggestedDirection =
        typeof (entry as { suggestedDirection?: unknown }).suggestedDirection === "string"
          ? (entry as { suggestedDirection: string }).suggestedDirection.trim() || undefined
          : undefined;
      const evidenceJournalIds = Array.isArray((entry as { evidenceJournalIds?: unknown }).evidenceJournalIds)
        ? ((entry as { evidenceJournalIds: unknown[] }).evidenceJournalIds.filter(
            (id): id is string => typeof id === "string",
          ) as string[])
        : undefined;
      const evidenceIssueIds = Array.isArray((entry as { evidenceIssueIds?: unknown }).evidenceIssueIds)
        ? ((entry as { evidenceIssueIds: unknown[] }).evidenceIssueIds.filter(
            (id): id is string => typeof id === "string",
          ) as string[])
        : undefined;
      items.push({
        title: title.trim(),
        summary: summary.trim(),
        rationale: rationale.trim(),
        facts,
        ...(rootCause ? { rootCause } : {}),
        ...(suggestedDirection ? { suggestedDirection } : {}),
        ...(evidenceJournalIds ? { evidenceJournalIds } : {}),
        ...(evidenceIssueIds ? { evidenceIssueIds } : {}),
      });
    }
    return items.length > 0 ? items : undefined;
  } catch {
    return undefined;
  }
}

// ユーザー依頼「Journal等からIssueを生成する際、AIエージェントチームに内容を埋めさせる」
// 対応。AIが提案するWhy/What/Howの埋め合わせ案。extractActionItems/extractSubIssuesと
// 同じ壊れにくいパースの考え方（不正な形式は「提案なし」として扱う）。why/what/how以外の
// キー・空文字列の値は無視し、1つも有効な値が残らなければ「提案なし」とする。
export function extractCharter(resultText: string): Partial<IssueCharter> | undefined {
  const match = resultText.match(/```charter\s*\n?([\s\S]*?)```/);
  if (!match) return undefined;
  try {
    const parsed = JSON.parse(match[1].trim());
    if (!parsed || typeof parsed !== "object") return undefined;
    const result: Partial<IssueCharter> = {};
    for (const key of ["why", "what", "how"] as const) {
      const value = (parsed as Record<string, unknown>)[key];
      if (typeof value === "string" && value.trim()) result[key] = value.trim();
    }
    return Object.keys(result).length > 0 ? result : undefined;
  } catch {
    // 不正なcharterブロックは「提案なし」として扱う
  }
  return undefined;
}

// docs 3.3「階層型マルチエージェント」/ docs/memo.md「M」: Lead Agentが1体以上の
// 専門エージェントに並行相談したい場合の合図。agentsは重複除去し、SPECIALIST_AGENTSに
// 含まれない値・空配列は不正なブロックとして扱う（相談なしにフォールバック）。
// docs/agent_specialization.md 段階5対応。questionsはagentName→個別質問の任意マップ。
// キーがagentsに含まれない・SPECIALIST_AGENTS外・値が文字列でない場合はそのエントリだけ
// 無視する（consultブロック全体を不正扱いにはしない）。
export function extractConsult(resultText: string): ConsultRequest | undefined {
  const match = resultText.match(/```consult\s*\n?([\s\S]*?)```/);
  if (!match) return undefined;
  try {
    const parsed = JSON.parse(match[1].trim());
    if (!parsed || typeof parsed.question !== "string") return undefined;
    const rawAgents: unknown[] = Array.isArray(parsed.agents) ? parsed.agents : typeof parsed.agent === "string" ? [parsed.agent] : [];
    const agents = Array.from(new Set(rawAgents.filter((a): a is string => typeof a === "string" && SPECIALIST_AGENTS.includes(a))));
    if (agents.length === 0) return undefined;

    let questions: Record<string, string> | undefined;
    if (parsed.questions && typeof parsed.questions === "object") {
      const entries = Object.entries(parsed.questions as Record<string, unknown>).filter(
        (entry): entry is [string, string] =>
          typeof entry[1] === "string" && entry[1].trim().length > 0 && agents.includes(entry[0]),
      );
      if (entries.length > 0) questions = Object.fromEntries(entries);
    }

    return { agents, question: parsed.question, questions };
  } catch {
    // 不正なconsultブロックは相談なしとして扱う
  }
  return undefined;
}

// docs/agent_specialization.md 段階5対応。指定agentへの個別質問があればそれを、
// 無ければ共通questionにフォールバックする（後方互換）。
export function consultQuestionFor(consult: ConsultRequest, agentName: string): string {
  return consult.questions?.[agentName] ?? consult.question;
}

// 何でも相談でEMが必須consultを指定したとき、Leadがproposal/yieldで終える／必須先を
// agentsから落とすのを防ぐ。lookupはそのまま通し、consultがある場合は欠けた必須先を
// 合流、consultが無い場合は必須先だけのconsultへ強制変換する。
export function ensureRequiredConsult(
  run: Pick<AgentRun, "agentName" | "task" | "requiredConsultAgents">,
  consultRequest: ConsultRequest | undefined,
  allowConsult: boolean,
): ConsultRequest | undefined {
  if (!allowConsult || run.agentName !== "Lead Agent") return consultRequest;
  const required = (run.requiredConsultAgents ?? []).filter((a) => SPECIALIST_AGENTS.includes(a));
  if (required.length === 0) return consultRequest;

  if (consultRequest) {
    const missing = required.filter((a) => !consultRequest.agents.includes(a));
    if (missing.length === 0) return consultRequest;
    const agents = [...consultRequest.agents, ...missing];
    const questions = { ...(consultRequest.questions ?? {}) };
    for (const agent of missing) {
      if (!questions[agent]) {
        questions[agent] =
          agent === EXEC_AGENT_NAME
            ? "組織のMVV・中長期目標・説明責任に照らし、この相談内容への経営／役員目線の厳しい見解を出してください。"
            : `必須相談先として指定されています。専門領域の観点で見解を出してください（元タスク: ${run.task}）`;
      }
    }
    return { ...consultRequest, agents, questions };
  }

  return {
    agents: required,
    question: `EMが必須の専門レビューを指定しています。次の観点で見解を出してください。\n\n元タスク: ${run.task}`,
    questions: Object.fromEntries(
      required.map((agent) => [
        agent,
        agent === EXEC_AGENT_NAME
          ? "組織のMVV・中長期目標・説明責任に照らし、この相談内容への経営／役員目線の厳しい見解を出してください。"
          : `必須相談先として指定されています。専門領域の観点で見解を出してください（元タスク: ${run.task}）`,
      ]),
    ),
  };
}

// docs/2nd_pivot_version.md Phase 8。Growth（EM自身の学びの提示）の提案候補。
// extractThemesと同じ壊れにくいパースの考え方（不正な形式・必須フィールド欠落の要素は
// 捨てるだけで、ブロック自体は「提案なし」として扱う）。
export function extractGrowSuggestions(resultText: string): GrowSuggestionDraft[] | undefined {
  const match = resultText.match(/```grow_suggestions\s*\n?([\s\S]*?)```/);
  if (!match) return undefined;
  try {
    const parsed = JSON.parse(match[1].trim());
    if (!Array.isArray(parsed)) return undefined;
    const items: GrowSuggestionDraft[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") continue;
      const title = (entry as { title?: unknown }).title;
      const rationale = (entry as { rationale?: unknown }).rationale;
      if (typeof title !== "string" || !title.trim()) continue;
      if (typeof rationale !== "string" || !rationale.trim()) continue;
      const evidenceSummaryRaw = (entry as { evidenceSummary?: unknown }).evidenceSummary;
      const evidenceSummary =
        typeof evidenceSummaryRaw === "string" && evidenceSummaryRaw.trim() ? evidenceSummaryRaw.trim() : undefined;
      const referencesRaw = (entry as { references?: unknown }).references;
      const references: GrowReference[] = Array.isArray(referencesRaw)
        ? (referencesRaw
            .map((r): GrowReference | undefined => {
              if (!r || typeof r !== "object") return undefined;
              const topic = (r as { topic?: unknown }).topic;
              if (typeof topic !== "string" || !topic.trim()) return undefined;
              const noteRaw = (r as { note?: unknown }).note;
              const note = typeof noteRaw === "string" && noteRaw.trim() ? noteRaw.trim() : undefined;
              // ユーザー要望「参考文献やWeb記事、書籍のリンクを乗せてほしい」対応。
              // http(s)で始まる文字列のみ受け付ける（不正な形式・javascript:等は破棄し、
              // UI側の検索リンクフォールバックに委ねる）。存在確認はしない（LLMが
              // 実在すると確信できる場合のみ出力する前提。詳細はGrowReferenceの型注釈参照）。
              const urlRaw = (r as { url?: unknown }).url;
              const url = typeof urlRaw === "string" && /^https?:\/\/\S+$/i.test(urlRaw.trim()) ? urlRaw.trim() : undefined;
              return {
                topic: topic.trim(),
                isPrimarySource: (r as { isPrimarySource?: unknown }).isPrimarySource === true,
                ...(note ? { note } : {}),
                ...(url ? { url } : {}),
              };
            })
            .filter((r): r is GrowReference => !!r))
        : [];
      items.push({
        title: title.trim(),
        rationale: rationale.trim(),
        ...(evidenceSummary ? { evidenceSummary } : {}),
        references,
      });
    }
    return items.length > 0 ? items : undefined;
  } catch {
    // 不正なgrow_suggestionsブロックは「提案なし」として扱う
  }
  return undefined;
}

/** Journal自動分析の task から対象エントリ本文を取り出す。取れなければ task 全体。 */
export function extractJournalAutoAnalysisText(task: string): string {
  const match = task.match(/対象のJournalエントリ:\s*"([\s\S]*)"\s*$/);
  return match ? match[1] : task;
}
