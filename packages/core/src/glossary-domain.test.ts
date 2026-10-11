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
    expect(entry.maskEnabled).toBe(false);

    const masked = service.updateGlossaryEntry(entry.id, { maskEnabled: true });
    expect(masked?.maskEnabled).toBe(true);
    const maskedBlock = service.buildGlossaryContextBlock();
    expect(maskedBlock).toContain(entry.maskId);
    expect(maskedBlock).not.toMatch(/PRD:/);

    expect(service.deleteGlossaryEntry(entry.id)).toBe(true);
    expect(service.listGlossaryEntries()).toHaveLength(0);
    expect(repo.load()).toHaveLength(0);
  });

  it("マスク対象は meaning を送らず externalHint だけを TERM_n と組で出す", () => {
    const service = createGlossaryService(createMemoryGlossaryRepository());
    const hinted = service.addGlossaryEntry({
      term: "鳳凰",
      meaning: "来期の機密新規事業",
      maskEnabled: true,
      externalHint: "鳳凰は社内の新規プロジェクト名",
    });
    const bare = service.addGlossaryEntry({ term: "麒麟", meaning: "機密の提携先", maskEnabled: true });

    const block = service.buildGlossaryContextBlock();
    expect(block).toContain(`${hinted.maskId}: {{${hinted.maskId}}}は社内の新規プロジェクト名`);
    expect(block).toContain(`- ${bare.maskId}`);
    expect(block).not.toContain("機密");
    expect(block).not.toContain("鳳凰");
    expect(block).not.toContain("麒麟");

    const local = service.buildGlossaryContextBlock({ audience: "local" });
    expect(local).toContain("来期の機密新規事業");
  });

  it("externalHint は空文字で解除できる", () => {
    const service = createGlossaryService(createMemoryGlossaryRepository());
    const entry = service.addGlossaryEntry({ term: "鳳凰", meaning: "m", maskEnabled: true, externalHint: "補足" });
    expect(service.updateGlossaryEntry(entry.id, { externalHint: "  " })?.externalHint).toBeUndefined();
  });

  it("空のときコンテキストブロックは空文字", () => {
    const service = createGlossaryService(createMemoryGlossaryRepository());
    expect(service.buildGlossaryContextBlock()).toBe("");
  });
});
