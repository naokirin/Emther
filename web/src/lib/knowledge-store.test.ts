import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@/lib/test-helpers/store-env";

let dir: string;

beforeEach(() => {
  dir = setupIsolatedStoreEnv();
  vi.resetModules();
});

afterEach(() => {
  teardownIsolatedStoreEnv(dir);
});

async function loadModules() {
  const knowledgeStore = await import("@/lib/knowledge-store");
  const peopleDirectory = await import("@/lib/people-directory");
  return { knowledgeStore, peopleDirectory };
}

describe("recordEvent / getEventById / listEvents", () => {
  it("記録したイベントをIDで取得できる", async () => {
    const { knowledgeStore } = await loadModules();
    const event = knowledgeStore.recordEvent({
      kind: "fact",
      context: "observation",
      entityType: "journal",
      people: [],
      text: "hello",
      tags: ["tag1"],
      occurredAt: 1000,
    });
    expect(event.id).toBeDefined();
    expect(event.recordedAt).toBeDefined();
    const fetched = knowledgeStore.getEventById(event.id);
    expect(fetched).toEqual(event);
  });

  it("存在しないIDはundefinedを返す", async () => {
    const { knowledgeStore } = await loadModules();
    expect(knowledgeStore.getEventById("nope")).toBeUndefined();
  });

  it("entityType/kindでフィルタできる", async () => {
    const { knowledgeStore } = await loadModules();
    knowledgeStore.recordEvent({ kind: "fact", context: "observation", entityType: "journal", people: [], text: "a", tags: [], occurredAt: 1 });
    knowledgeStore.recordEvent({ kind: "fact", context: "official", entityType: "issue", people: [], text: "b", tags: [], occurredAt: 2 });
    knowledgeStore.recordEvent({ kind: "interpretation", context: "profile", entityType: "person", people: [], text: "c", tags: [], occurredAt: 3 });

    expect(knowledgeStore.listEvents({ entityType: "journal" })).toHaveLength(1);
    expect(knowledgeStore.listEvents({ kind: "interpretation" })).toHaveLength(1);
    expect(knowledgeStore.listEvents()).toHaveLength(3);
  });

  it("occurredAtの新しい順で返す", async () => {
    const { knowledgeStore } = await loadModules();
    knowledgeStore.recordEvent({ kind: "fact", context: "observation", entityType: "journal", people: [], text: "old", tags: [], occurredAt: 1 });
    knowledgeStore.recordEvent({ kind: "fact", context: "observation", entityType: "journal", people: [], text: "new", tags: [], occurredAt: 100 });
    const events = knowledgeStore.listEvents();
    expect(events.map((e) => e.text)).toEqual(["new", "old"]);
  });

  it("id/recordedAtを明示的に渡した場合はそれを使う", async () => {
    const { knowledgeStore } = await loadModules();
    const event = knowledgeStore.recordEvent({
      id: "fixed-id",
      recordedAt: 42,
      kind: "fact",
      context: "observation",
      entityType: "journal",
      people: [],
      text: "x",
      tags: [],
      occurredAt: 1,
    });
    expect(event.id).toBe("fixed-id");
    expect(event.recordedAt).toBe(42);
  });
});

describe("isEventExpired", () => {
  it("ttlDaysが無ければ常に有効", async () => {
    const { knowledgeStore } = await loadModules();
    const event = knowledgeStore.recordEvent({ kind: "interpretation", context: "profile", entityType: "person", people: [], text: "x", tags: [], occurredAt: 0 });
    expect(knowledgeStore.isEventExpired(event, Date.now() + 1_000_000_000)).toBe(false);
  });

  it("ttlDays経過後はtrue", async () => {
    const { knowledgeStore } = await loadModules();
    const now = 1_000_000_000_000;
    const event = knowledgeStore.recordEvent({
      kind: "fact",
      context: "observation",
      entityType: "journal",
      people: [],
      text: "x",
      tags: [],
      occurredAt: now,
      ttlDays: 1,
    });
    const oneDayMs = 24 * 60 * 60 * 1000;
    expect(knowledgeStore.isEventExpired(event, now + oneDayMs - 1)).toBe(false);
    expect(knowledgeStore.isEventExpired(event, now + oneDayMs + 1)).toBe(true);
  });
});

describe("listActiveFactsForPerson / listInterpretationsForPerson", () => {
  it("対象人物が含まれkindがfactかつ未失効のものだけを返す", async () => {
    const { knowledgeStore } = await loadModules();
    const now = 1_000_000_000_000;
    knowledgeStore.recordEvent({ kind: "fact", context: "observation", entityType: "journal", people: ["PERSON_1"], text: "active", tags: [], occurredAt: now });
    knowledgeStore.recordEvent({
      kind: "fact",
      context: "observation",
      entityType: "journal",
      people: ["PERSON_1"],
      text: "expired",
      tags: [],
      occurredAt: now - 200 * 24 * 60 * 60 * 1000,
      ttlDays: 90,
    });
    knowledgeStore.recordEvent({ kind: "fact", context: "observation", entityType: "journal", people: ["PERSON_2"], text: "other person", tags: [], occurredAt: now });

    const facts = knowledgeStore.listActiveFactsForPerson("PERSON_1").filter((f) => !knowledgeStore.isEventExpired(f, now));
    expect(facts.map((f) => f.text)).toEqual(["active"]);
  });

  it("limitで件数を制限する", async () => {
    const { knowledgeStore } = await loadModules();
    for (let i = 0; i < 10; i++) {
      knowledgeStore.recordEvent({ kind: "fact", context: "observation", entityType: "journal", people: ["PERSON_1"], text: `f${i}`, tags: [], occurredAt: i });
    }
    expect(knowledgeStore.listActiveFactsForPerson("PERSON_1", 3)).toHaveLength(3);
  });

  it("interpretationはkindがinterpretationのものだけ", async () => {
    const { knowledgeStore } = await loadModules();
    knowledgeStore.recordEvent({ kind: "interpretation", context: "profile", entityType: "person", people: ["PERSON_1"], text: "profile-note", tags: [], occurredAt: 1 });
    knowledgeStore.recordEvent({ kind: "fact", context: "observation", entityType: "journal", people: ["PERSON_1"], text: "fact-note", tags: [], occurredAt: 2 });
    const interpretations = knowledgeStore.listInterpretationsForPerson("PERSON_1");
    expect(interpretations.map((i) => i.text)).toEqual(["profile-note"]);
  });
});

describe("toEventView", () => {
  it("PERSON_n IDを実名に復元する", async () => {
    const { knowledgeStore, peopleDirectory } = await loadModules();
    const id = peopleDirectory.registerName("Aさん");
    const event = knowledgeStore.recordEvent({
      kind: "fact",
      context: "observation",
      entityType: "journal",
      people: [id],
      text: `${id}と1on1した`,
      summary: `${id}の近況`,
      tags: [],
      occurredAt: 1,
    });
    const view = knowledgeStore.toEventView(event);
    expect(view.text).toBe("Aさんと1on1した");
    expect(view.summary).toBe("Aさんの近況");
    expect(view.people).toEqual(["Aさん"]);
  });
});

describe("listEventsForEntity / recordChangeEvent / listRecentChangeEvents", () => {
  it("recordChangeEventはkind:fact context:officialで記録する", async () => {
    const { knowledgeStore } = await loadModules();
    knowledgeStore.recordChangeEvent("issue", "issue-1", "起票しました");
    const events = knowledgeStore.listEventsForEntity("issue", "issue-1");
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("fact");
    expect(events[0].context).toBe("official");
    expect(events[0].text).toBe("起票しました");
  });

  it("listRecentChangeEventsはcontext:officialのみを返しJournal(observation)は含まない", async () => {
    const { knowledgeStore } = await loadModules();
    knowledgeStore.recordChangeEvent("issue", "issue-1", "変更履歴");
    knowledgeStore.recordEvent({ kind: "fact", context: "observation", entityType: "journal", people: [], text: "journal entry", tags: [], occurredAt: 2 });
    const events = knowledgeStore.listRecentChangeEvents();
    expect(events.map((e) => e.text)).toEqual(["変更履歴"]);
  });

  it("limitで件数を制限する", async () => {
    const { knowledgeStore } = await loadModules();
    for (let i = 0; i < 5; i++) knowledgeStore.recordChangeEvent("issue", "issue-1", `change-${i}`);
    expect(knowledgeStore.listRecentChangeEvents(2)).toHaveLength(2);
  });
});

describe("searchSimilarEvents", () => {
  it("埋め込みを持つイベントだけを対象に類似度順で返す", async () => {
    const { knowledgeStore } = await loadModules();
    knowledgeStore.recordEvent({ kind: "fact", context: "observation", entityType: "journal", people: [], text: "close", tags: [], occurredAt: 1, embedding: [1, 0] });
    knowledgeStore.recordEvent({ kind: "fact", context: "observation", entityType: "journal", people: [], text: "far", tags: [], occurredAt: 2, embedding: [0, 1] });
    knowledgeStore.recordEvent({ kind: "fact", context: "observation", entityType: "journal", people: [], text: "no-embedding", tags: [], occurredAt: 3 });

    const results = knowledgeStore.searchSimilarEvents([1, 0]);
    expect(results.map((r) => r.text)).toEqual(["close", "far"]);
    expect(results[0].similarity).toBeCloseTo(1);
    expect(results[1].similarity).toBeCloseTo(0);
  });

  it("excludeExpired(既定true)でTTL切れのfactを除外する", async () => {
    const { knowledgeStore } = await loadModules();
    const now = 1_000_000_000_000;
    knowledgeStore.recordEvent({
      kind: "fact",
      context: "observation",
      entityType: "journal",
      people: [],
      text: "expired",
      tags: [],
      occurredAt: now - 200 * 24 * 60 * 60 * 1000,
      ttlDays: 90,
      embedding: [1, 0],
    });
    vi.setSystemTime(now);
    const results = knowledgeStore.searchSimilarEvents([1, 0]);
    expect(results).toHaveLength(0);
    vi.useRealTimers();
  });
});
