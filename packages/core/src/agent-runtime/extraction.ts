import {
  CONFIRM_PRIORITIES,
  SUGGESTION_REVIEW_STATUSES,
  type ConfirmPriority,
  type YieldKind,
} from "../types";
import { normalizeAdviceStructured } from "../advice";
import { dateStringToNoonTimestamp } from "../journal-date-parser";
import type { GrowReference, GrowSuggestionDraft } from "../em-growth-store";
import type { SuggestedTheme } from "../theme-store";
import { EXEC_AGENT_NAME, SPECIALIST_AGENTS } from "./agent-catalog";
import type {
  AgentRun,
  ConsultRequest,
  SuggestionCandidate,
  LensUsage,
  PeriodReview,
  PeriodReviewBlindSpot,
  PeriodReviewComparisonItem,
  Proposal,
  RejectedAlternative,
  SuggestedSuggestionNote,
  SuggestionUpdate,
  YieldOption,
  YieldRequest,
} from "./types";

const PERIOD_REVIEW_ASSESSMENTS = ["improved", "worsened", "changed", "uncertain"] as const;

/** proposal から起票用タイトル候補を返す。suggestionCandidates があればそれを使い、無ければ suggestionTitle 1件。 */
export function listSuggestionCandidatesFromProposal(proposal?: Proposal | null): SuggestionCandidate[] {
  if (!proposal) return [];
  const fromArray = normalizeSuggestionCandidates(proposal.suggestionCandidates);
  if (fromArray && fromArray.length > 0) return fromArray;
  const single = proposal.suggestionTitle?.trim();
  return single ? [{ title: single }] : [];
}

export function normalizeSuggestionCandidates(parsed: unknown): SuggestionCandidate[] | undefined {
  if (!Array.isArray(parsed)) return undefined;
  const items: SuggestionCandidate[] = [];
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

// Expand/Challengeの過程で使った哲学レンズ（任意）。壊れにくい
// パースの考え方はnormalizeSuggestionCandidatesと同じ：不正な形式の要素は黙って除外する。
export function normalizeLensUsage(parsed: unknown): LensUsage[] | undefined {
  if (!Array.isArray(parsed)) return undefined;
  const items: LensUsage[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const lens = (entry as { lens?: unknown }).lens;
    const insight = (entry as { insight?: unknown }).insight;
    if (typeof lens !== "string" || !lens.trim()) continue;
    if (typeof insight !== "string" || !insight.trim()) continue;
    items.push({ lens: lens.trim(), insight: insight.trim() });
  }
  return items.length > 0 ? items : undefined;
}

const KNOWN_YIELD_KINDS: YieldKind[] = ["decide", "inform", "commit"];

// kindはAIの自己申告のため、未知の値・欠落は
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

// 結論・参照ファクト・判断ロジック・棄却した代替案を
// 必ず含めさせる。 で expansions / challenges を追加
// （欠落時は空配列＝旧run互換）。抽出できない（規約に従わなかった）場合はundefinedを返し、
// UI側は素のテキストログのみを表示する（無理に構造化して見せない）。
export function extractProposal(resultText: string): Proposal | undefined {
  const match = resultText.match(/```proposal\s*\n?([\s\S]*?)```/);
  if (!match) return undefined;
  try {
    const parsed = JSON.parse(match[1].trim());
    if (parsed && typeof parsed.conclusion === "string" && typeof parsed.logic === "string") {
      const recommendation =
        parsed.recommendation === "dismiss" || parsed.recommendation === "issue" || parsed.recommendation === "suggestion" || parsed.recommendation === "watch"
          ? (parsed.recommendation === "issue" ? "suggestion" : parsed.recommendation)
          : undefined;
      const suggestionTitle =
        typeof parsed.suggestionTitle === "string" && parsed.suggestionTitle.trim() ? parsed.suggestionTitle.trim() : undefined;
      const suggestionCandidates = normalizeSuggestionCandidates(parsed.suggestionCandidates);
      // 新形式（オブジェクト）・旧形式（string）どちらも adviceStructured に正規化。
      const adviceStructured = normalizeAdviceStructured(
        parsed.advice !== undefined ? parsed.advice : parsed.adviceStructured,
      );
      const lensesUsed = normalizeLensUsage(parsed.lensesUsed);
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
        ...(suggestionTitle ? { suggestionTitle } : {}),
        ...(suggestionCandidates ? { suggestionCandidates } : {}),
        ...(adviceStructured ? { adviceStructured } : {}),
        ...(lensesUsed ? { lensesUsed } : {}),
      };
    }
  } catch {
    // 不正なproposalブロックは構造化なしとして扱う
  }
  return undefined;
}

// lookupで見つけた別提案への追記提案。extractYield/extractProposalと同じ
// 壊れにくいパースの考え方（不正な形式・suggestionId/text欠落の要素は捨てるだけで、
// ブロック自体は「提案なし」として扱う）。
export function extractSuggestionNotes(resultText: string): SuggestedSuggestionNote[] | undefined {
  // 旧AI出力の ```issue_note``` / issueId も読み取り時に吸収する（プロンプトは suggestion_note へ移行済み）。
  const match = resultText.match(/```(?:suggestion_note|issue_note)\s*\n?([\s\S]*?)```/);
  if (!match) return undefined;
  try {
    const parsed = JSON.parse(match[1].trim());
    if (!Array.isArray(parsed)) return undefined;
    const items: SuggestedSuggestionNote[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") continue;
      const raw = entry as { suggestionId?: unknown; issueId?: unknown; text?: unknown };
      const suggestionId =
        typeof raw.suggestionId === "string" && raw.suggestionId.trim()
          ? raw.suggestionId.trim()
          : typeof raw.issueId === "string" && raw.issueId.trim()
            ? raw.issueId.trim()
            : "";
      if (!suggestionId || typeof raw.text !== "string" || !raw.text.trim()) continue;
      items.push({ suggestionId, text: raw.text.trim() });
    }
    return items.length > 0 ? items : undefined;
  } catch {
    // 不正なsuggestion_noteブロックは「提案なし」として扱う
  }
  return undefined;
}

// EMが相談で明示的に「提案を整理して」等と
// したときだけ、AIが提案する既存提案（実在ID）の状態変更下書き。extractSuggestionNotesと
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

export function parseSuggestedPriority(value: unknown): ConfirmPriority | undefined {
  return typeof value === "string" && (CONFIRM_PRIORITIES as string[]).includes(value)
    ? (value as ConfirmPriority)
    : undefined;
}

// 状況蒸留のテーマ候補。
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
      const evidenceSuggestionIdsRaw =
        (entry as { evidenceSuggestionIds?: unknown }).evidenceSuggestionIds ??
        (entry as { evidenceIssueIds?: unknown }).evidenceIssueIds;
      const evidenceSuggestionIds = Array.isArray(evidenceSuggestionIdsRaw)
        ? (evidenceSuggestionIdsRaw.filter((id): id is string => typeof id === "string") as string[])
        : undefined;
      items.push({
        title: title.trim(),
        summary: summary.trim(),
        rationale: rationale.trim(),
        facts,
        ...(rootCause ? { rootCause } : {}),
        ...(suggestedDirection ? { suggestedDirection } : {}),
        ...(evidenceJournalIds ? { evidenceJournalIds } : {}),
        ...(evidenceSuggestionIds ? { evidenceSuggestionIds } : {}),
      });
    }
    return items.length > 0 ? items : undefined;
  } catch {
    return undefined;
  }
}

// 週次・月次レビューの構造化出力。extractThemesと同じ壊れにくい
// パースの考え方——必須フィールド欠落の配列要素はスキップし、1つも残らなければその配列は
// 空のまま返す（ブロック自体は「提案なし」にしない。overview/interpretationが無い場合のみ
// レビュー全体を無効とする）。
export function extractPeriodReview(resultText: string): PeriodReview | undefined {
  const match = resultText.match(/```period_review\s*\n?([\s\S]*?)```/);
  if (!match) return undefined;
  try {
    const parsed = JSON.parse(match[1].trim());
    if (!parsed || typeof parsed !== "object") return undefined;
    const overview = (parsed as { overview?: unknown }).overview;
    const interpretation = (parsed as { interpretation?: unknown }).interpretation;
    if (typeof overview !== "string" || !overview.trim()) return undefined;
    if (typeof interpretation !== "string" || !interpretation.trim()) return undefined;

    const observationsRaw = (parsed as { observations?: unknown }).observations;
    const observations = Array.isArray(observationsRaw)
      ? observationsRaw.filter((o): o is string => typeof o === "string" && o.trim().length > 0)
      : [];

    const comparisonsRaw = (parsed as { comparisons?: unknown }).comparisons;
    const comparisons: PeriodReviewComparisonItem[] = [];
    if (Array.isArray(comparisonsRaw)) {
      for (const entry of comparisonsRaw) {
        if (!entry || typeof entry !== "object") continue;
        const area = (entry as { area?: unknown }).area;
        const before = (entry as { before?: unknown }).before;
        const after = (entry as { after?: unknown }).after;
        const assessment = (entry as { assessment?: unknown }).assessment;
        if (typeof area !== "string" || !area.trim()) continue;
        if (typeof before !== "string" || !before.trim()) continue;
        if (typeof after !== "string" || !after.trim()) continue;
        if (typeof assessment !== "string" || !PERIOD_REVIEW_ASSESSMENTS.includes(assessment as never)) continue;
        comparisons.push({
          area: area.trim(),
          before: before.trim(),
          after: after.trim(),
          assessment: assessment as PeriodReviewComparisonItem["assessment"],
        });
      }
    }

    const blindSpotsRaw = (parsed as { blindSpots?: unknown }).blindSpots;
    const blindSpots: PeriodReviewBlindSpot[] = [];
    if (Array.isArray(blindSpotsRaw)) {
      for (const entry of blindSpotsRaw) {
        if (!entry || typeof entry !== "object") continue;
        const question = (entry as { question?: unknown }).question;
        const reason = (entry as { reason?: unknown }).reason;
        if (typeof question !== "string" || !question.trim()) continue;
        if (typeof reason !== "string" || !reason.trim()) continue;
        blindSpots.push({ question: question.trim(), reason: reason.trim() });
      }
    }

    const learningsRaw = (parsed as { learnings?: unknown }).learnings;
    const learnings = Array.isArray(learningsRaw)
      ? learningsRaw.filter((l): l is string => typeof l === "string" && l.trim().length > 0)
      : [];

    const nextQuestionsRaw = (parsed as { nextQuestions?: unknown }).nextQuestions;
    const nextQuestions = Array.isArray(nextQuestionsRaw)
      ? nextQuestionsRaw.filter((q): q is string => typeof q === "string" && q.trim().length > 0)
      : [];

    return {
      overview: overview.trim(),
      observations,
      interpretation: interpretation.trim(),
      comparisons,
      blindSpots,
      learnings,
      nextQuestions,
    };
  } catch {
    return undefined;
  }
}

// 「M」: Lead Agentが1体以上の
// 専門エージェントに並行相談したい場合の合図。agentsは重複除去し、SPECIALIST_AGENTSに
// 含まれない値・空配列は不正なブロックとして扱う（相談なしにフォールバック）。
// questionsはagentName→個別質問の任意マップ。
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

// 指定agentへの個別質問があればそれを、
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

// Growth（EM自身の学びの提示）の提案候補。
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
