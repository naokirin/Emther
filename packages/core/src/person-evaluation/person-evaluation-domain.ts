import { randomUUID } from "node:crypto";
import { maskForStorage, unmaskNames } from "../people-directory";
import { getOrgStrategy } from "../org-context-store/index";
import { listActiveFactsForPerson } from "../knowledge-store";
import { cosineSimilarity, embedText } from "../embeddings";
import { RELATED_SIMILARITY_THRESHOLD } from "../related-context";
import type {
  EvaluationLens,
  EvaluationLogStatus,
  EvaluationPolarity,
  PersonEvaluationLog,
  PersonEvaluationRepository,
} from "./person-evaluation-types";

export type {
  EvaluationLens,
  EvaluationLogStatus,
  EvaluationPolarity,
  PersonEvaluationLog,
} from "./person-evaluation-types";

type ValueMatch = { text: string; embedding: number[] };

function splitValueItems(valuesText: string): string[] {
  return valuesText
    .split(/\r?\n/)
    .map((line) => line.replace(/^[\s\-*・•]+/, "").trim())
    .filter((line) => line.length > 0);
}

async function buildValueMatches(valuesText: string): Promise<ValueMatch[]> {
  const matches: ValueMatch[] = [];
  for (const text of splitValueItems(valuesText)) {
    try {
      matches.push({ text, embedding: await embedText(text) });
    } catch {
      // 埋め込み失敗時はこの価値観を照合対象から外す
    }
  }
  return matches;
}

function bestMatch<T extends { embedding: number[] }>(
  factEmbedding: number[],
  candidates: T[],
): (T & { similarity: number }) | undefined {
  return candidates
    .map((c) => ({ ...c, similarity: cosineSimilarity(factEmbedding, c.embedding) }))
    .sort((a, b) => b.similarity - a.similarity)[0];
}

export function createPersonEvaluationService(repo: PersonEvaluationRepository) {
  function toEvaluationLogView(log: PersonEvaluationLog): PersonEvaluationLog {
    return {
      ...log,
      snapshotText: unmaskNames(log.snapshotText),
      rationale: unmaskNames(log.rationale),
      valueSnapshot: log.valueSnapshot !== undefined ? unmaskNames(log.valueSnapshot) : undefined,
      noActionNeededNote:
        log.noActionNeededNote !== undefined ? unmaskNames(log.noActionNeededNote) : undefined,
    };
  }

  async function createEvaluationLog(input: {
    personId: string;
    lens: EvaluationLens;
    polarity?: EvaluationPolarity;
    sourceJournalId: string;
    valueSnapshot?: string;
    snapshotText: string;
    rationale: string;
    status?: EvaluationLogStatus;
  }): Promise<PersonEvaluationLog> {
    const now = Date.now();
    const log: PersonEvaluationLog = {
      id: randomUUID(),
      personId: input.personId,
      lens: input.lens,
      status: input.status ?? "provisional",
      polarity: input.polarity ?? "positive",
      sourceJournalId: input.sourceJournalId,
      valueSnapshot: input.valueSnapshot?.trim()
        ? await maskForStorage(input.valueSnapshot.trim())
        : undefined,
      snapshotText: await maskForStorage(input.snapshotText.trim()),
      rationale: await maskForStorage(input.rationale.trim()),
      createdAt: now,
      updatedAt: now,
    };
    repo.insert(log);
    return log;
  }

  function listEvaluationLogsForPerson(
    personId: string,
    filter?: { lens?: EvaluationLens; status?: EvaluationLogStatus; since?: number; until?: number },
  ): PersonEvaluationLog[] {
    return repo.listByPerson(personId).filter((log) => {
      if (filter?.lens && log.lens !== filter.lens) return false;
      if (filter?.status && log.status !== filter.status) return false;
      if (filter?.since !== undefined && log.createdAt < filter.since) return false;
      if (filter?.until !== undefined && log.createdAt > filter.until) return false;
      return true;
    });
  }

  function getEvaluationLog(id: string): PersonEvaluationLog | undefined {
    return repo.get(id);
  }

  function setEvaluationLogStatus(id: string, status: EvaluationLogStatus): PersonEvaluationLog | undefined {
    const log = getEvaluationLog(id);
    if (!log) return undefined;
    if (log.status === status) return log;
    const now = Date.now();
    repo.updateStatus(id, status, now);
    return { ...log, status, updatedAt: now };
  }

  async function setEvaluationLogNoActionNeeded(
    id: string,
    note?: string,
  ): Promise<PersonEvaluationLog | undefined> {
    const log = getEvaluationLog(id);
    if (!log) return undefined;
    const now = Date.now();
    const trimmed = note?.trim();
    const masked = trimmed ? await maskForStorage(trimmed) : undefined;
    repo.updateNoActionNeeded(id, now, masked ?? null);
    return { ...log, noActionNeededAt: now, noActionNeededNote: masked };
  }

  function clearEvaluationLogNoActionNeeded(id: string): PersonEvaluationLog | undefined {
    const log = getEvaluationLog(id);
    if (!log) return undefined;
    repo.updateNoActionNeeded(id, null, null);
    return { ...log, noActionNeededAt: undefined, noActionNeededNote: undefined };
  }

  async function suggestEvaluationLogsFromRecentJournals(
    personId: string,
    _personName: string,
    opts: { limit?: number } = {},
  ): Promise<PersonEvaluationLog[]> {
    const limit = opts.limit ?? 20;
    const facts = listActiveFactsForPerson(personId, limit);

    const valuesText = getOrgStrategy().values?.trim() || undefined;
    const valueMatches = valuesText ? await buildValueMatches(valuesText) : [];

    const created: PersonEvaluationLog[] = [];

    for (const fact of facts) {
      const journalId = fact.sourceJournalId ?? fact.id;
      const excerpt = (fact.summary || fact.text || "").trim().slice(0, 280);
      if (!excerpt || !fact.embedding) continue;

      const concern =
        /懸念|不安|乖離|問題|炎上|離職|バーン|遅延|対立|ミス/.test(excerpt) || fact.sentiment === "negative";

      if (!repo.existsActive(personId, journalId, "value")) {
        const match = bestMatch(fact.embedding, valueMatches);
        if (match && match.similarity >= RELATED_SIMILARITY_THRESHOLD) {
          const log = await createEvaluationLog({
            personId,
            lens: "value",
            polarity: concern ? "concern" : "positive",
            sourceJournalId: journalId,
            valueSnapshot: match.text,
            snapshotText: excerpt,
            rationale: `Journal の言動を Values「${match.text.slice(0, 40)}」適合の候補として仮置き（意味的関連度 ${match.similarity.toFixed(2)}・要レビュー。監視チェックリスト化しない）`,
          });
          created.push(log);
        }
      }
    }

    return created;
  }

  function bundleEvaluationLogs(
    personId: string,
    opts: { since?: number; until?: number } = {},
  ): {
    outcome: PersonEvaluationLog[];
    value: PersonEvaluationLog[];
    missing: string[];
  } {
    const logs = listEvaluationLogsForPerson(personId, {
      since: opts.since,
      until: opts.until,
    }).filter((l) => l.status !== "discarded");

    const outcome = logs.filter((l) => l.lens === "outcome");
    const value = logs.filter((l) => l.lens === "value");
    const missing: string[] = [];
    if (outcome.length === 0) missing.push("目標貢献ログが不足");
    if (value.length === 0) missing.push("Value 体現ログが不足");
    return { outcome, value, missing };
  }

  return {
    toEvaluationLogView,
    createEvaluationLog,
    listEvaluationLogsForPerson,
    getEvaluationLog,
    setEvaluationLogStatus,
    setEvaluationLogNoActionNeeded,
    clearEvaluationLogNoActionNeeded,
    suggestEvaluationLogsFromRecentJournals,
    bundleEvaluationLogs,
  };
}
