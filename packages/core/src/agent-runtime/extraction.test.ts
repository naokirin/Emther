import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "../test-helpers/store-env";
import { extractWorldModelChanges } from "./extraction";

describe("extractWorldModelChanges", () => {
  it("差分を取り出し、形式不正の項目だけを捨てる", () => {
    const text = [
      "```world-model",
      JSON.stringify([
        { action: "confirm", targetId: "e1", reason: "再観測", evidenceJournalIds: ["j1"] },
        { action: "bogus", reason: "x" },
        { action: "refine", targetId: "e2" },
        { action: "new", kind: "flow", title: "t", statement: "s", reason: "r", personIds: ["PERSON_1"] },
        { action: "new", kind: "unknown-kind", title: "t", statement: "s", reason: "r" },
      ]),
      "```",
    ].join("\n");
    const changes = extractWorldModelChanges(text)!;
    expect(changes).toHaveLength(3);
    expect(changes[0]).toMatchObject({ action: "confirm", targetId: "e1", evidence: { journalIds: ["j1"] } });
    expect(changes[1]?.personIds).toEqual(["PERSON_1"]);
    expect(changes[2]?.kind).toBeUndefined();
  });

  it("ブロックが無い・壊れている場合は undefined", () => {
    expect(extractWorldModelChanges("本文のみ")).toBeUndefined();
    expect(extractWorldModelChanges("```world-model\n{not json\n```")).toBeUndefined();
  });
});

describe("extractProposal の worldModelRefs", () => {
  let dir: string;

  beforeEach(() => {
    dir = setupIsolatedStoreEnv();
    vi.resetModules();
  });

  afterEach(() => {
    teardownIsolatedStoreEnv(dir);
  });

  it("実在する要素 ID だけを残す", async () => {
    const store = await import("../world-model-store");
    const { extractProposal } = await import("./extraction");
    const el = await store.createWorldModelElement({
      kind: "flow",
      title: "判断の所在",
      statement: "テックリードが判断する",
      origin: "user",
    });
    const text =
      "```proposal\n" +
      JSON.stringify({ conclusion: "c", logic: "l", facts: [], worldModelRefs: [el.id, "ghost"] }) +
      "\n```";
    expect(extractProposal(text)?.worldModelRefs).toEqual([el.id]);
    const none = "```proposal\n" + JSON.stringify({ conclusion: "c", logic: "l", worldModelRefs: ["ghost"] }) + "\n```";
    expect(extractProposal(none)?.worldModelRefs).toBeUndefined();
  });
});
