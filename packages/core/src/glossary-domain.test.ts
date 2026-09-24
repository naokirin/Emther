import { describe, expect, it } from "vitest";
import { createGlossaryService } from "./glossary/glossary-domain";
import type { GlossaryRepository } from "./glossary/glossary-repository";
import type { GlossaryEntry } from "./glossary/glossary-types";

function createMemoryGlossaryRepository(initial: GlossaryEntry[] = []): GlossaryRepository {
  let stored = [...initial];
  return {
    load: () => [...stored],
    save: (entries) => {
      stored = [...entries];
    },
  };
}

describe("glossary-domain (in-memory repository)", () => {
  it("ファイル I/O なしで用語の追加・一覧・更新・削除とコンテキスト生成ができる", () => {
    const repo = createMemoryGlossaryRepository();
    const service = createGlossaryService(repo);

    const entry = service.addGlossaryEntry({
      term: "PRD",
      reading: "ピーアールディー",
      meaning: "製品要求仕様書",
      category: "プロジェクト",
    });
    expect(entry.term).toBe("PRD");
    expect(repo.load()).toHaveLength(1);

    expect(service.listGlossaryEntries().some((e) => e.id === entry.id)).toBe(true);

    const updated = service.updateGlossaryEntry(entry.id, { meaning: "プロダクト要求仕様書" });
    expect(updated?.meaning).toBe("プロダクト要求仕様書");
    expect(repo.load()[0]?.meaning).toBe("プロダクト要求仕様書");

    const block = service.buildGlossaryContextBlock();
    expect(block).toContain("PRD");
    expect(block).toContain("プロダクト要求仕様書");

    expect(service.deleteGlossaryEntry(entry.id)).toBe(true);
    expect(service.listGlossaryEntries()).toHaveLength(0);
    expect(repo.load()).toHaveLength(0);
  });

  it("空のときコンテキストブロックは空文字", () => {
    const service = createGlossaryService(createMemoryGlossaryRepository());
    expect(service.buildGlossaryContextBlock()).toBe("");
  });
});
