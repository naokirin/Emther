import { describe, expect, it } from "vitest";
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
