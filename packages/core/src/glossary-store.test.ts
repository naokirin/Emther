import { describe, expect, it } from "vitest";
import {
  addGlossaryEntry,
  buildGlossaryContextBlock,
  deleteGlossaryEntry,
  listGlossaryEntries,
  updateGlossaryEntry,
} from "./glossary-store";

describe("glossary-store", () => {
  it("用語を追加・一覧取得・更新・削除できる", () => {
    const entry = addGlossaryEntry({
      term: "PRD",
      reading: "ピーアールディー",
      meaning: "製品要求仕様書",
      category: "プロジェクト",
    });
    expect(entry.term).toBe("PRD");
    expect(entry.meaning).toBe("製品要求仕様書");

    const list = listGlossaryEntries();
    expect(list.some((e) => e.id === entry.id)).toBe(true);

    const updated = updateGlossaryEntry(entry.id, { meaning: "プロダクト要求仕様書" });
    expect(updated?.meaning).toBe("プロダクト要求仕様書");

    const block = buildGlossaryContextBlock();
    expect(block).toContain("PRD");
    expect(block).toContain("プロダクト要求仕様書");

    const deleted = deleteGlossaryEntry(entry.id);
    expect(deleted).toBe(true);
    expect(listGlossaryEntries().some((e) => e.id === entry.id)).toBe(false);
  });
});
