import { randomUUID } from "node:crypto";
import { maskForStorage, unmaskNames } from "../people-directory";
import type { WorldModelRepository } from "./world-model-repository";
import {
  ELEMENT_LINK_TYPES,
  RELATIONSHIP_STANCES,
  WORLD_MODEL_KINDS,
  type ElementLink,
  type NewWorldModelElement,
  type WorldModelElement,
  type WorldModelEvidence,
  type WorldModelKind,
  type WorldModelStatus,
} from "./world-model-types";

const PERSON_ID = /^PERSON_\d+$/;

// 個人の能力・性格・性向の断定は載せない方針の最終防波堤。AI 由来のテキストにのみ適用する。
const EVALUATIVE_PATTERNS = [
  /無能|能力(が|は)?(低|不足|欠)/,
  /性格(が|は)?(悪|難|問題)/,
  /やる気(が|は)?(ない|無い|低)/,
  /(使えない|ダメな人|問題児|扱いにくい人)/,
];

export function containsEvaluativeAttribute(text: string): boolean {
  return EVALUATIVE_PATTERNS.some((p) => p.test(text));
}

function uniq(ids: string[] | undefined): string[] {
  if (!ids?.length) return [];
  return Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)));
}

function normalizeEvidence(e: Partial<WorldModelEvidence> | undefined): WorldModelEvidence {
  return {
    eventIds: uniq(e?.eventIds),
    journalIds: uniq(e?.journalIds),
    suggestionIds: uniq(e?.suggestionIds),
    themeIds: uniq(e?.themeIds),
  };
}

function validateInput(input: NewWorldModelElement): string | undefined {
  if (!WORLD_MODEL_KINDS.includes(input.kind)) return `unknown kind: ${input.kind}`;
  if (!input.title.trim() || !input.statement.trim()) return "title と statement は必須です";
  for (const id of input.personIds ?? []) {
    if (!PERSON_ID.test(id)) return `personIds は PERSON_n のみ: ${id}`;
  }
  for (const link of input.links ?? []) {
    if (!ELEMENT_LINK_TYPES.includes(link.type)) return `unknown link type: ${link.type}`;
  }
  if (input.kind === "relationship") {
    const rel = input.relationship;
    if (!rel) return "relationship には relationship 詳細が必須です";
    if (rel.parties.length !== 2) return "relationship の parties は 2 件必要です";
    for (const p of rel.parties) {
      if (!p.id) return "party.id は必須です";
      if (p.type === "person" && !PERSON_ID.test(p.id)) return `person party は PERSON_n のみ: ${p.id}`;
    }
    const stances = RELATIONSHIP_STANCES[rel.aspect] as readonly string[] | undefined;
    if (!stances?.includes(rel.stance)) return `stance が aspect と一致しません: ${rel.aspect}/${rel.stance}`;
  } else if (input.relationship) {
    return "relationship 詳細は kind=relationship のみ";
  }
  if (input.origin !== "user") {
    if (containsEvaluativeAttribute(`${input.title}\n${input.statement}`)) {
      return "個人の評価的な属性は載せられません";
    }
  }
  return undefined;
}

export class WorldModelValidationError extends Error {}

export function createWorldModelService(repo: WorldModelRepository) {
  const elements = repo.load();

  function persist(): void {
    repo.save(elements);
  }

  function get(id: string): WorldModelElement | undefined {
    return elements.find((e) => e.id === id);
  }

  function supersededIds(): Set<string> {
    return new Set(elements.map((e) => e.supersedes).filter((id): id is string => !!id));
  }

  function listCurrent(filter?: { status?: WorldModelStatus; kind?: WorldModelKind }): WorldModelElement[] {
    const superseded = supersededIds();
    return elements
      .filter((e) => !superseded.has(e.id))
      .filter((e) => !filter?.status || e.status === filter.status)
      .filter((e) => !filter?.kind || e.kind === filter.kind)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  function listActive(): WorldModelElement[] {
    return listCurrent().filter((e) => e.status === "adopted" || e.status === "pinned");
  }

  function toView(e: WorldModelElement): WorldModelElement {
    return {
      ...e,
      title: unmaskNames(e.title),
      statement: unmaskNames(e.statement),
      userNote: e.userNote !== undefined ? unmaskNames(e.userNote) : undefined,
    };
  }

  async function create(input: NewWorldModelElement): Promise<WorldModelElement> {
    const err = validateInput(input);
    if (err) throw new WorldModelValidationError(err);
    const origin = input.origin ?? "ai";
    const status = input.status ?? (origin === "user" ? "adopted" : "candidate");
    const now = Date.now();
    const element: WorldModelElement = {
      id: randomUUID(),
      kind: input.kind,
      title: await maskForStorage(input.title.trim()),
      statement: await maskForStorage(input.statement.trim()),
      teamIds: uniq(input.teamIds),
      personIds: uniq(input.personIds),
      relationship: input.relationship,
      intentRefs: uniq(input.intentRefs),
      links: (input.links ?? []) as ElementLink[],
      evidence: normalizeEvidence(input.evidence),
      confidence: input.confidence ?? "mid",
      status,
      origin,
      sourceRunId: input.sourceRunId,
      firstObservedAt: input.firstObservedAt ?? now,
      lastConfirmedAt: now,
      createdAt: now,
      updatedAt: now,
      adoptedAt: status === "adopted" || status === "pinned" ? now : undefined,
    };
    elements.push(element);
    persist();
    return element;
  }

  function setStatus(id: string, status: WorldModelStatus): WorldModelElement | undefined {
    const e = get(id);
    if (!e) return undefined;
    e.status = status;
    e.updatedAt = Date.now();
    if ((status === "adopted" || status === "pinned") && e.adoptedAt === undefined) {
      e.adoptedAt = e.updatedAt;
    }
    persist();
    return e;
  }

  const adopt = (id: string) => {
    const e = get(id);
    if (e?.status === "pinned") return e;
    return setStatus(id, "adopted");
  };
  const dismiss = (id: string) => setStatus(id, "dismissed");
  const pin = (id: string) => setStatus(id, "pinned");
  const unpin = (id: string) => {
    const e = get(id);
    if (!e || e.status !== "pinned") return e;
    return setStatus(id, "adopted");
  };

  async function annotate(id: string, note: string | null): Promise<WorldModelElement | undefined> {
    const e = get(id);
    if (!e) return undefined;
    const trimmed = note?.trim();
    e.userNote = trimmed ? await maskForStorage(trimmed) : undefined;
    e.updatedAt = Date.now();
    persist();
    return e;
  }

  // 訂正版は旧版を supersedes で置き換え、EM の判断なので pinned で作る（AI は直接上書きしない）。
  async function revise(
    id: string,
    patch: { title?: string; statement?: string },
  ): Promise<WorldModelElement | undefined> {
    const original = get(id);
    if (!original || original.status === "dismissed") return undefined;
    if (supersededIds().has(id)) return undefined;
    const title = patch.title?.trim() ?? unmaskNames(original.title);
    const statement = patch.statement?.trim() ?? unmaskNames(original.statement);
    if (!title || !statement) throw new WorldModelValidationError("title と statement は必須です");
    const now = Date.now();
    const revised: WorldModelElement = {
      ...original,
      id: randomUUID(),
      title: await maskForStorage(title),
      statement: await maskForStorage(statement),
      status: "pinned",
      origin: "user",
      supersedes: original.id,
      lastConfirmedAt: now,
      createdAt: now,
      updatedAt: now,
      adoptedAt: now,
    };
    elements.push(revised);
    persist();
    return revised;
  }

  function confirm(id: string): WorldModelElement | undefined {
    const e = get(id);
    if (!e) return undefined;
    e.lastConfirmedAt = Date.now();
    if (e.status === "stale") e.status = "adopted";
    e.updatedAt = e.lastConfirmedAt;
    persist();
    return e;
  }

  function addEvidence(id: string, evidence: Partial<WorldModelEvidence>): WorldModelElement | undefined {
    const e = get(id);
    if (!e) return undefined;
    const add = normalizeEvidence(evidence);
    e.evidence = {
      eventIds: uniq([...e.evidence.eventIds, ...add.eventIds]),
      journalIds: uniq([...e.evidence.journalIds, ...add.journalIds]),
      suggestionIds: uniq([...e.evidence.suggestionIds, ...add.suggestionIds]),
      themeIds: uniq([...e.evidence.themeIds, ...add.themeIds]),
    };
    e.updatedAt = Date.now();
    persist();
    return e;
  }

  function markStale(id: string): WorldModelElement | undefined {
    const e = get(id);
    if (!e || e.status === "dismissed" || e.status === "candidate") return e;
    return setStatus(id, "stale");
  }

  function markStaleOlderThan(days: number, now = Date.now()): string[] {
    const cutoff = now - days * 24 * 60 * 60 * 1000;
    const touched: string[] = [];
    for (const e of listCurrent()) {
      if (e.status === "adopted" && e.lastConfirmedAt < cutoff) {
        e.status = "stale";
        e.updatedAt = now;
        touched.push(e.id);
      }
    }
    if (touched.length) persist();
    return touched;
  }

  return {
    get,
    listCurrent,
    listActive,
    toView,
    create,
    adopt,
    dismiss,
    pin,
    unpin,
    annotate,
    revise,
    confirm,
    addEvidence,
    markStale,
    markStaleOlderThan,
  };
}
