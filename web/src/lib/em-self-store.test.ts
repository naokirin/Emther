import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@/lib/test-helpers/store-env";

vi.mock("@/lib/local-model", () => ({
  runLocalChat: vi.fn(async () => JSON.stringify({ people: [] })),
  extractFirstJsonObject: (text: string) => text,
}));

let dir: string;

beforeEach(() => {
  dir = setupIsolatedStoreEnv();
  vi.resetModules();
});

afterEach(() => {
  teardownIsolatedStoreEnv(dir);
});

async function loadModule() {
  return import("@/lib/em-self-store");
}

describe("addCheckin", () => {
  it("mood/energy/stressを1〜5の範囲にクランプする", async () => {
    const store = await loadModule();
    const checkin = await store.addCheckin({ mood: 10, energy: -3, stress: 3.6, note: "" });
    expect(checkin.mood).toBe(5);
    expect(checkin.energy).toBe(1);
    expect(checkin.stress).toBe(4);
  });

  it("noteが空文字なら空のまま保存する", async () => {
    const store = await loadModule();
    const checkin = await store.addCheckin({ mood: 3, energy: 3, stress: 3, note: "   " });
    expect(checkin.note).toBe("");
  });

  it("listCheckinsは新しい順で返す", async () => {
    const store = await loadModule();
    await store.addCheckin({ mood: 1, energy: 1, stress: 1, note: "1件目" });
    await new Promise((r) => setTimeout(r, 2));
    await store.addCheckin({ mood: 2, energy: 2, stress: 2, note: "2件目" });
    const list = store.listCheckins();
    expect(list[0].note).toBe("2件目");
    expect(list[1].note).toBe("1件目");
  });
});

describe("addReflectionNote", () => {
  it("type/textを保存する", async () => {
    const store = await loadModule();
    const note = await store.addReflectionNote({ type: "keep", text: "1on1の頻度を維持する" });
    expect(note.type).toBe("keep");
    expect(note.text).toBe("1on1の頻度を維持する");
  });

  it("listReflectionNotesは新しい順で返す", async () => {
    const store = await loadModule();
    await store.addReflectionNote({ type: "problem", text: "1件目" });
    await new Promise((r) => setTimeout(r, 2));
    await store.addReflectionNote({ type: "try", text: "2件目" });
    const list = store.listReflectionNotes();
    expect(list.map((n) => n.text)).toEqual(["2件目", "1件目"]);
  });
});

describe("toCheckinView / toReflectionNoteView", () => {
  it("PERSON_n IDを実名に復元する", async () => {
    const peopleDirectory = await import("@/lib/people-directory");
    const store = await loadModule();
    peopleDirectory.registerName("Aさん");
    const checkin = await store.addCheckin({ mood: 3, energy: 3, stress: 3, note: "Aさんとの1on1で気づいたこと" });
    expect(store.toCheckinView(checkin).note).toBe("Aさんとの1on1で気づいたこと");

    const note = await store.addReflectionNote({ type: "keep", text: "Aさんへのフォロー" });
    expect(store.toReflectionNoteView(note).text).toBe("Aさんへのフォロー");
  });
});
