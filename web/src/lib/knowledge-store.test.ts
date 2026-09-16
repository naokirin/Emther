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

describe("listEventsPage", () => {
  it("LIMIT/OFFSETでページングし、totalはフィルタ後の全件数を返す", async () => {
    const { knowledgeStore } = await loadModules();
    for (let i = 0; i < 5; i++) {
      knowledgeStore.recordEvent({
        kind: "fact",
        context: "observation",
        entityType: "journal",
        people: [],
        text: `entry-${i}`,
        tags: [],
        occurredAt: i,
      });
    }
    const page1 = knowledgeStore.listEventsPage({ entityType: "journal" }, { limit: 2, offset: 0 });
    expect(page1.events.map((e) => e.text)).toEqual(["entry-4", "entry-3"]);
    expect(page1.total).toBe(5);

    const page2 = knowledgeStore.listEventsPage({ entityType: "journal" }, { limit: 2, offset: 2 });
    expect(page2.events.map((e) => e.text)).toEqual(["entry-2", "entry-1"]);
  });

  it("textQueryは部分一致（text/summary/tags_json/people_json）でフィルタする", async () => {
    const { knowledgeStore } = await loadModules();
    knowledgeStore.recordEvent({ kind: "fact", context: "observation", entityType: "journal", people: [], text: "リファクタリングの話", tags: [], occurredAt: 1 });
    knowledgeStore.recordEvent({ kind: "fact", context: "observation", entityType: "journal", people: [], text: "無関係な話", tags: ["リファクタリング"], occurredAt: 2 });
    knowledgeStore.recordEvent({ kind: "fact", context: "observation", entityType: "journal", people: [], text: "全く別件", tags: [], occurredAt: 3 });

    const { events, total } = knowledgeStore.listEventsPage({ textQuery: "リファクタリング" }, { limit: 10, offset: 0 });
    expect(total).toBe(2);
    expect(events.map((e) => e.text).sort()).toEqual(["リファクタリングの話", "無関係な話"].sort());
  });

  it("tagExact/personExactは完全一致で絞り込む（部分文字列を誤って一致させない）", async () => {
    const { knowledgeStore } = await loadModules();
    knowledgeStore.recordEvent({ kind: "fact", context: "observation", entityType: "journal", people: ["P1"], text: "a", tags: ["1on1"], occurredAt: 1 });
    knowledgeStore.recordEvent({ kind: "fact", context: "observation", entityType: "journal", people: ["P2"], text: "b", tags: ["1on1計画"], occurredAt: 2 });

    const byTag = knowledgeStore.listEventsPage({ tagExact: "1on1" }, { limit: 10, offset: 0 });
    expect(byTag.total).toBe(1);
    expect(byTag.events[0].tags).toEqual(["1on1"]);

    const byPerson = knowledgeStore.listEventsPage({ personExact: "P1" }, { limit: 10, offset: 0 });
    expect(byPerson.total).toBe(1);
    expect(byPerson.events[0].people).toEqual(["P1"]);
  });

  it("excludeResolvedはresolved_issue_id/resolution_noteが無いものだけ返す", async () => {
    const { knowledgeStore } = await loadModules();
    knowledgeStore.recordEvent({ kind: "fact", context: "observation", entityType: "journal", people: [], text: "未解決", tags: [], occurredAt: 1 });
    knowledgeStore.recordEvent({
      kind: "fact",
      context: "observation",
      entityType: "journal",
      people: [],
      text: "解決済み",
      tags: [],
      occurredAt: 2,
      resolvedIssueId: "issue-1",
    });

    const { events, total } = knowledgeStore.listEventsPage({ excludeResolved: true }, { limit: 10, offset: 0 });
    expect(total).toBe(1);
    expect(events[0].text).toBe("未解決");
  });

  it("excludeSupersededはsupersedesで置き換えられた版を除外する", async () => {
    const { knowledgeStore } = await loadModules();
    const original = knowledgeStore.recordEvent({ kind: "fact", context: "observation", entityType: "journal", people: [], text: "旧版", tags: [], occurredAt: 1 });
    knowledgeStore.recordEvent({
      kind: "fact",
      context: "observation",
      entityType: "journal",
      people: [],
      text: "新版",
      tags: [],
      occurredAt: 1,
      supersedes: original.id,
    });

    const { events, total } = knowledgeStore.listEventsPage({ excludeSuperseded: true }, { limit: 10, offset: 0 });
    expect(total).toBe(1);
    expect(events[0].text).toBe("新版");
  });

  it("getEventHeadByIdはsupersedesチェーンの先頭を返す", async () => {
    const { knowledgeStore } = await loadModules();
    const original = knowledgeStore.recordEvent({
      kind: "fact",
      context: "observation",
      entityType: "journal",
      people: [],
      text: "旧版",
      tags: [],
      occurredAt: 1,
    });
    const head = knowledgeStore.recordEvent({
      kind: "fact",
      context: "observation",
      entityType: "journal",
      people: [],
      text: "新版",
      tags: [],
      occurredAt: 1,
      supersedes: original.id,
    });
    expect(knowledgeStore.getEventHeadById(original.id)?.id).toBe(head.id);
    expect(knowledgeStore.getEventHeadById(head.id)?.id).toBe(head.id);
    expect(knowledgeStore.getEventHeadById("missing")).toBeUndefined();
  });

  it("listEventLineageIdsはsupersedesチェーン上の全IDを返す", async () => {
    const { knowledgeStore } = await loadModules();
    const original = knowledgeStore.recordEvent({
      kind: "fact",
      context: "observation",
      entityType: "journal",
      people: [],
      text: "旧版",
      tags: [],
      occurredAt: 1,
    });
    const head = knowledgeStore.recordEvent({
      kind: "fact",
      context: "observation",
      entityType: "journal",
      people: [],
      text: "新版",
      tags: [],
      occurredAt: 1,
      supersedes: original.id,
    });
    expect(knowledgeStore.listEventLineageIds(original.id)).toEqual([original.id, head.id]);
    expect(knowledgeStore.listEventLineageIds(head.id)).toEqual([original.id, head.id]);
    expect(knowledgeStore.listEventLineageIds("missing")).toEqual([]);
  });
});

describe("findEventOffset", () => {
  it("同じfilter・並び順で対象イベントが何件目（0-indexed）に位置するかを返す", async () => {
    const { knowledgeStore } = await loadModules();
    knowledgeStore.recordEvent({ id: "e0", kind: "fact", context: "observation", entityType: "journal", people: [], text: "a", tags: [], occurredAt: 3 });
    const target = knowledgeStore.recordEvent({ id: "e1", kind: "fact", context: "observation", entityType: "journal", people: [], text: "b", tags: [], occurredAt: 2 });
    knowledgeStore.recordEvent({ id: "e2", kind: "fact", context: "observation", entityType: "journal", people: [], text: "c", tags: [], occurredAt: 1 });

    const offset = knowledgeStore.findEventOffset(
      { occurredAt: target.occurredAt, recordedAt: target.recordedAt },
      { entityType: "journal" },
    );
    expect(offset).toBe(1);
  });
});

describe("listEventFacets", () => {
  it("tags_json/people_jsonから重複排除した一覧を返す", async () => {
    const { knowledgeStore } = await loadModules();
    knowledgeStore.recordEvent({ kind: "fact", context: "observation", entityType: "journal", people: ["P1"], text: "a", tags: ["t1", "t2"], occurredAt: 1 });
    knowledgeStore.recordEvent({ kind: "fact", context: "observation", entityType: "journal", people: ["P1", "P2"], text: "b", tags: ["t2"], occurredAt: 2 });

    const facets = knowledgeStore.listEventFacets({ entityType: "journal" });
    expect(facets.tags.sort()).toEqual(["t1", "t2"]);
    expect(facets.people.sort()).toEqual(["P1", "P2"]);
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

  it("supersedesで置き換えられた旧版は除外する（Journal一覧と同じ）", async () => {
    const { knowledgeStore } = await loadModules();
    const original = knowledgeStore.recordEvent({
      kind: "fact",
      context: "observation",
      entityType: "journal",
      people: ["PERSON_1"],
      text: "旧版",
      tags: [],
      occurredAt: 1,
    });
    knowledgeStore.recordEvent({
      kind: "fact",
      context: "observation",
      entityType: "journal",
      people: ["PERSON_1"],
      text: "新版",
      tags: [],
      occurredAt: 1,
      supersedes: original.id,
    });

    expect(knowledgeStore.listActiveFactsForPerson("PERSON_1").map((f) => f.text)).toEqual(["新版"]);
  });

  it("interpretationはkindがinterpretationのものだけ", async () => {
    const { knowledgeStore } = await loadModules();
    knowledgeStore.recordEvent({ kind: "interpretation", context: "profile", entityType: "person", people: ["PERSON_1"], text: "profile-note", tags: [], occurredAt: 1 });
    knowledgeStore.recordEvent({ kind: "fact", context: "observation", entityType: "journal", people: ["PERSON_1"], text: "fact-note", tags: [], occurredAt: 2 });
    const interpretations = knowledgeStore.listInterpretationsForPerson("PERSON_1");
    expect(interpretations.map((i) => i.text)).toEqual(["profile-note"]);
  });

  it("アーカイブ済みのfactは除外する（実名リーク隔離がこの経路でも効くように）", async () => {
    const { knowledgeStore } = await loadModules();
    const archived = knowledgeStore.recordEvent({
      kind: "fact",
      context: "observation",
      entityType: "journal",
      people: ["PERSON_1"],
      text: "leaked-name-version",
      tags: [],
      occurredAt: 1,
    });
    knowledgeStore.setEventArchived(archived.id);
    knowledgeStore.recordEvent({ kind: "fact", context: "observation", entityType: "journal", people: ["PERSON_1"], text: "clean-version", tags: [], occurredAt: 2 });

    expect(knowledgeStore.listActiveFactsForPerson("PERSON_1").map((f) => f.text)).toEqual(["clean-version"]);
  });

  it("アーカイブ済みのinterpretationは除外する", async () => {
    const { knowledgeStore } = await loadModules();
    const archived = knowledgeStore.recordEvent({ kind: "interpretation", context: "profile", entityType: "person", people: ["PERSON_1"], text: "leaked-name-version", tags: [], occurredAt: 1 });
    knowledgeStore.setEventArchived(archived.id);
    knowledgeStore.recordEvent({ kind: "interpretation", context: "profile", entityType: "person", people: ["PERSON_1"], text: "clean-version", tags: [], occurredAt: 2 });

    expect(knowledgeStore.listInterpretationsForPerson("PERSON_1").map((i) => i.text)).toEqual(["clean-version"]);
  });
});

describe("quarantineEventsContainingNames", () => {
  it("指定した名前を本文・要約・タグ・対応メモに含む未アーカイブのイベントをアーカイブし、IDを返す", async () => {
    const { knowledgeStore } = await loadModules();
    const byText = knowledgeStore.recordEvent({ kind: "fact", context: "observation", entityType: "journal", people: [], text: "本文に山田太郎が混入", tags: [], occurredAt: 1 });
    const bySummary = knowledgeStore.recordEvent({ kind: "fact", context: "observation", entityType: "journal", people: [], text: "clean", summary: "要約に山田太郎", tags: [], occurredAt: 2 });
    const clean = knowledgeStore.recordEvent({ kind: "fact", context: "observation", entityType: "journal", people: [], text: "clean", tags: [], occurredAt: 3 });

    const quarantined = knowledgeStore.quarantineEventsContainingNames(["山田太郎"]);

    expect(quarantined.sort()).toEqual([byText.id, bySummary.id].sort());
    expect(knowledgeStore.getEventById(byText.id)?.archivedAt).toBeDefined();
    expect(knowledgeStore.getEventById(bySummary.id)?.archivedAt).toBeDefined();
    expect(knowledgeStore.getEventById(clean.id)?.archivedAt).toBeUndefined();
  });

  // docs/memo.md「実名を含んでしまっていた場合に自動で隔離されたJournalをユーザーが
  // 確認できるようにしたい」対応。手動アーカイブと区別するため、自動隔離だけ
  // archivedReasonが"name_leak"になり、archivedReasonExactで絞り込める。
  it("自動隔離だけarchivedReasonが'name_leak'になり、手動アーカイブと区別できる", async () => {
    const { knowledgeStore } = await loadModules();
    const leaked = knowledgeStore.recordEvent({ kind: "fact", context: "observation", entityType: "journal", people: [], text: "山田太郎が混入", tags: [], occurredAt: 1 });
    const manuallyArchived = knowledgeStore.recordEvent({ kind: "fact", context: "observation", entityType: "journal", people: [], text: "重複して記録した", tags: [], occurredAt: 2 });
    knowledgeStore.setEventArchived(manuallyArchived.id);

    knowledgeStore.quarantineEventsContainingNames(["山田太郎"]);

    expect(knowledgeStore.getEventById(leaked.id)?.archivedReason).toBe("name_leak");
    expect(knowledgeStore.getEventById(manuallyArchived.id)?.archivedReason).toBeUndefined();

    const { total, events } = knowledgeStore.listEventsPage(
      { entityType: "journal", excludeArchived: false, archivedReasonExact: "name_leak" },
      { limit: 10, offset: 0 },
    );
    expect(total).toBe(1);
    expect(events[0].id).toBe(leaked.id);
  });

  it("名前が指定されなければ何もしない", async () => {
    const { knowledgeStore } = await loadModules();
    expect(knowledgeStore.quarantineEventsContainingNames([])).toEqual([]);
  });

  it("既にアーカイブ済みのイベントは再度対象にしない", async () => {
    const { knowledgeStore } = await loadModules();
    const already = knowledgeStore.recordEvent({ kind: "fact", context: "observation", entityType: "journal", people: [], text: "山田太郎", tags: [], occurredAt: 1 });
    knowledgeStore.setEventArchived(already.id);

    expect(knowledgeStore.quarantineEventsContainingNames(["山田太郎"])).toEqual([]);
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

// ユーザー指摘「確認したが対応不要だった、を示せず強調を減らせない」対応。
describe("setEventNoActionNeeded / clearEventNoActionNeeded", () => {
  it("sentiment等は変えずno_action_needed系だけをin-placeで更新する", async () => {
    const { knowledgeStore } = await loadModules();
    const event = knowledgeStore.recordEvent({
      kind: "fact",
      context: "observation",
      entityType: "journal",
      people: [],
      text: "つらい",
      sentiment: "negative",
      tags: [],
      occurredAt: 1,
    });
    const acked = knowledgeStore.setEventNoActionNeeded(event.id, "確認済み・対応不要");
    expect(acked?.id).toBe(event.id);
    expect(acked?.sentiment).toBe("negative");
    expect(acked?.noActionNeededAt).toBeDefined();
    expect(acked?.noActionNeededNote).toBe("確認済み・対応不要");

    const fetched = knowledgeStore.getEventById(event.id);
    expect(fetched?.noActionNeededAt).toBe(acked?.noActionNeededAt);
    expect(fetched?.noActionNeededNote).toBe("確認済み・対応不要");

    const cleared = knowledgeStore.clearEventNoActionNeeded(event.id);
    expect(cleared?.noActionNeededAt).toBeUndefined();
    expect(cleared?.noActionNeededNote).toBeUndefined();
    expect(knowledgeStore.getEventById(event.id)?.noActionNeededAt).toBeUndefined();
  });

  it("存在しないIDはundefinedを返す", async () => {
    const { knowledgeStore } = await loadModules();
    expect(knowledgeStore.setEventNoActionNeeded("nope", undefined)).toBeUndefined();
    expect(knowledgeStore.clearEventNoActionNeeded("nope")).toBeUndefined();
  });
});

// docs/memo.md「相談、Journal、提案を削除（アーカイブ）したい」対応。
describe("setEventArchived / clearEventArchived", () => {
  it("in-placeでarchived_atだけを更新し、excludeArchivedで絞り込める", async () => {
    const { knowledgeStore } = await loadModules();
    const event = knowledgeStore.recordEvent({
      kind: "fact",
      context: "observation",
      entityType: "journal",
      people: [],
      text: "重複して記録してしまった",
      tags: [],
      occurredAt: 1,
    });
    const archived = knowledgeStore.setEventArchived(event.id);
    expect(archived?.id).toBe(event.id);
    expect(archived?.archivedAt).toBeDefined();
    expect(knowledgeStore.getEventById(event.id)?.archivedAt).toBe(archived?.archivedAt);

    const { total } = knowledgeStore.listEventsPage(
      { entityType: "journal", excludeArchived: true },
      { limit: 10, offset: 0 },
    );
    expect(total).toBe(0);

    const cleared = knowledgeStore.clearEventArchived(event.id);
    expect(cleared?.archivedAt).toBeUndefined();
    const { total: totalAfter } = knowledgeStore.listEventsPage(
      { entityType: "journal", excludeArchived: true },
      { limit: 10, offset: 0 },
    );
    expect(totalAfter).toBe(1);
  });

  it("存在しないIDはundefinedを返す", async () => {
    const { knowledgeStore } = await loadModules();
    expect(knowledgeStore.setEventArchived("nope")).toBeUndefined();
    expect(knowledgeStore.clearEventArchived("nope")).toBeUndefined();
  });

  it("clearEventArchivedはarchivedReasonも一緒に消す", async () => {
    const { knowledgeStore } = await loadModules();
    const event = knowledgeStore.recordEvent({ kind: "fact", context: "observation", entityType: "journal", people: [], text: "山田太郎", tags: [], occurredAt: 1 });
    knowledgeStore.setEventArchived(event.id, "name_leak");
    expect(knowledgeStore.getEventById(event.id)?.archivedReason).toBe("name_leak");

    const cleared = knowledgeStore.clearEventArchived(event.id);
    expect(cleared?.archivedReason).toBeUndefined();
    expect(knowledgeStore.getEventById(event.id)?.archivedReason).toBeUndefined();
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

// ユーザー要望「誤って複数登録されてしまったメンバーを統合する機能が欲しい」対応。
describe("reassignPersonId", () => {
  it("text/summary/resolution_note内の埋め込みIDを置換する", async () => {
    const { knowledgeStore } = await loadModules();
    knowledgeStore.recordEvent({
      id: "e1",
      kind: "fact",
      context: "observation",
      entityType: "journal",
      people: ["PERSON_2"],
      text: "PERSON_2と話した",
      summary: "PERSON_2の件",
      tags: [],
      occurredAt: 1,
      resolvedIssueId: undefined,
      resolutionNote: "PERSON_2が対応した",
    });
    const updated = knowledgeStore.reassignPersonId("PERSON_2", "PERSON_1");
    expect(updated).toBe(1);
    const event = knowledgeStore.getEventById("e1")!;
    expect(event.text).toBe("PERSON_1と話した");
    expect(event.summary).toBe("PERSON_1の件");
    expect(event.resolutionNote).toBe("PERSON_1が対応した");
    expect(event.people).toEqual(["PERSON_1"]);
  });

  it("people_json/tags_jsonにtoIdが既に含まれていれば重複させず1件にまとめる", async () => {
    const { knowledgeStore } = await loadModules();
    knowledgeStore.recordEvent({
      id: "e1",
      kind: "fact",
      context: "observation",
      entityType: "journal",
      people: ["PERSON_1", "PERSON_2"],
      text: "2人で話した",
      tags: [],
      occurredAt: 1,
    });
    knowledgeStore.reassignPersonId("PERSON_2", "PERSON_1");
    const event = knowledgeStore.getEventById("e1")!;
    expect(event.people).toEqual(["PERSON_1"]);
  });

  it("番号の異なる似たIDを誤って置換しない（PERSON_2とPERSON_20の混同防止）", async () => {
    const { knowledgeStore } = await loadModules();
    knowledgeStore.recordEvent({
      id: "e1",
      kind: "fact",
      context: "observation",
      entityType: "journal",
      people: ["PERSON_20"],
      text: "PERSON_20と話した",
      tags: [],
      occurredAt: 1,
    });
    knowledgeStore.reassignPersonId("PERSON_2", "PERSON_1");
    const event = knowledgeStore.getEventById("e1")!;
    expect(event.text).toBe("PERSON_20と話した");
    expect(event.people).toEqual(["PERSON_20"]);
  });

  it("該当が無ければ何も更新しない（戻り値0）", async () => {
    const { knowledgeStore } = await loadModules();
    knowledgeStore.recordEvent({ kind: "fact", context: "observation", entityType: "journal", people: [], text: "無関係", tags: [], occurredAt: 1 });
    expect(knowledgeStore.reassignPersonId("PERSON_99", "PERSON_1")).toBe(0);
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

  it("既定でアーカイブ済みイベントを除外する（実名リーク等でアーカイブした旧Journalが再分析に混入しないように）", async () => {
    const { knowledgeStore } = await loadModules();
    const archived = knowledgeStore.recordEvent({
      kind: "fact",
      context: "observation",
      entityType: "journal",
      people: [],
      text: "leaked-name-version",
      tags: [],
      occurredAt: 1,
      embedding: [1, 0],
    });
    knowledgeStore.setEventArchived(archived.id);
    knowledgeStore.recordEvent({
      kind: "fact",
      context: "observation",
      entityType: "journal",
      people: [],
      text: "clean-version",
      tags: [],
      occurredAt: 2,
      embedding: [1, 0],
    });

    const results = knowledgeStore.searchSimilarEvents([1, 0]);
    expect(results.map((r) => r.text)).toEqual(["clean-version"]);

    const withArchived = knowledgeStore.searchSimilarEvents([1, 0], { excludeArchived: false });
    expect(withArchived.map((r) => r.text).sort()).toEqual(["clean-version", "leaked-name-version"]);
  });

  it("既定でsupersedesされた旧版を除外する（修正前の実名入り本文が再分析に混入しないように）", async () => {
    const { knowledgeStore } = await loadModules();
    const original = knowledgeStore.recordEvent({
      kind: "fact",
      context: "observation",
      entityType: "journal",
      people: [],
      text: "leaked-name-version",
      tags: [],
      occurredAt: 1,
      embedding: [1, 0],
    });
    knowledgeStore.recordEvent({
      kind: "fact",
      context: "observation",
      entityType: "journal",
      people: [],
      text: "clean-version",
      tags: [],
      occurredAt: 2,
      embedding: [1, 0],
      supersedes: original.id,
    });

    const results = knowledgeStore.searchSimilarEvents([1, 0]);
    expect(results.map((r) => r.text)).toEqual(["clean-version"]);

    const withSuperseded = knowledgeStore.searchSimilarEvents([1, 0], { excludeSuperseded: false });
    expect(withSuperseded.map((r) => r.text).sort()).toEqual(["clean-version", "leaked-name-version"]);
  });
});
