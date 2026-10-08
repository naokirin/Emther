import { describe, expect, it } from "vitest";
import { maskForStorage, unmaskNames } from "./people-directory";
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
    expect(entry.maskEnabled).toBe(false);

    const deleted = deleteGlossaryEntry(entry.id);
    expect(deleted).toBe(true);
    expect(listGlossaryEntries().some((e) => e.id === entry.id)).toBe(false);
  });

  it("maskEnabled の用語だけ保存時マスク・表示時に戻る", async () => {
    const plain = addGlossaryEntry({
      term: "通常用語",
      meaning: "マスクしない",
    });
    const secret = addGlossaryEntry({
      term: "内部コードネーム鳳凰",
      meaning: "機密プロジェクト",
      maskEnabled: true,
    });
    const text = "通常用語と内部コードネーム鳳凰の話";
    const masked = await maskForStorage(text);
    expect(masked).toContain("通常用語");
    expect(masked).toContain(`{{${secret.maskId}}}`);
    expect(masked).not.toContain("内部コードネーム鳳凰");
    expect(unmaskNames(masked)).toContain("内部コードネーム鳳凰");

    const block = buildGlossaryContextBlock();
    expect(block).toContain("通常用語");
    expect(block).toContain(secret.maskId);
    expect(block).not.toMatch(/内部コードネーム鳳凰:/);

    deleteGlossaryEntry(plain.id);
    deleteGlossaryEntry(secret.id);
  });
});
