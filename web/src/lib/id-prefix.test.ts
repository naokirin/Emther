import { describe, expect, it } from "vitest";
import {
  findByIdPrefix,
  goHrefForIdFragment,
  idMatchesPrefix,
  isFullUuid,
  isHexIdPrefix,
  linkifyIdFragmentsInMarkdown,
  normalizeIdKey,
  splitTextByIdFragments,
} from "./id-prefix";

describe("normalizeIdKey / idMatchesPrefix", () => {
  it("ハイフンを無視して先頭一致する", () => {
    const id = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    expect(normalizeIdKey(id)).toBe("a1b2c3d4e5f67890abcdef1234567890");
    expect(idMatchesPrefix(id, "a1b2c3d4")).toBe(true);
    expect(idMatchesPrefix(id, "A1B2C3D4")).toBe(true);
    expect(idMatchesPrefix(id, "a1b2c3d4-e5f6")).toBe(true);
    expect(idMatchesPrefix(id, "ffffffff")).toBe(false);
  });

  it("8桁未満は完全一致のみ", () => {
    expect(idMatchesPrefix("abcdef12-0000-4000-8000-000000000001", "abcdef")).toBe(false);
    expect(idMatchesPrefix("abcdef", "abcdef")).toBe(true);
  });
});

describe("isHexIdPrefix / isFullUuid", () => {
  it("8桁以上の hex をプレフィックスと認める", () => {
    expect(isHexIdPrefix("a1b2c3d4")).toBe(true);
    expect(isHexIdPrefix("a1b2c3d")).toBe(false);
    expect(isHexIdPrefix("not-a-uuid")).toBe(false);
  });

  it("フル UUID を判定する", () => {
    expect(isFullUuid("a1b2c3d4-e5f6-7890-abcd-ef1234567890")).toBe(true);
    expect(isFullUuid("a1b2c3d4")).toBe(false);
  });
});

describe("findByIdPrefix", () => {
  it("一致する要素だけ返す", () => {
    const items = [
      { id: "aaaaaaaa-1111-4111-8111-111111111111" },
      { id: "bbbbbbbb-2222-4222-8222-222222222222" },
      { id: "aaaaaaaa-3333-4333-8333-333333333333" },
    ];
    expect(findByIdPrefix(items, (i) => i.id, "aaaaaaaa").map((i) => i.id)).toEqual([
      "aaaaaaaa-1111-4111-8111-111111111111",
      "aaaaaaaa-3333-4333-8333-333333333333",
    ]);
    expect(findByIdPrefix(items, (i) => i.id, "bbbbbbbb")).toHaveLength(1);
  });
});

describe("splitTextByIdFragments / linkify", () => {
  it("短い ID とフル UUID を分割する", () => {
    const text = "関連は a1b2c3d4 と [ffffffff-1111-4111-8111-111111111111] です";
    const segs = splitTextByIdFragments(text);
    expect(segs.filter((s) => s.type === "id").map((s) => s.value)).toEqual([
      "a1b2c3d4",
      "ffffffff-1111-4111-8111-111111111111",
    ]);
  });

  it("Markdown に /go リンクを挿入する（コードは除外）", () => {
    const out = linkifyIdFragmentsInMarkdown("見る: a1b2c3d4\n\n`bbbbbbbb`\n\n```\ncccccccc\n```");
    expect(out).toContain("[a1b2c3d4](/go/a1b2c3d4)");
    expect(out).toContain("`bbbbbbbb`");
    expect(out).not.toContain("[bbbbbbbb](/go/");
    expect(out).toContain("```\ncccccccc\n```");
    expect(out).not.toContain("[cccccccc](/go/");
  });

  it("既存の Markdown リンク URL は二重化しない", () => {
    const out = linkifyIdFragmentsInMarkdown("[x](/go/a1b2c3d4)");
    expect(out).toBe("[x](/go/a1b2c3d4)");
  });

  it("goHrefForIdFragment はエンコードする", () => {
    expect(goHrefForIdFragment("a1b2c3d4-e5f6")).toBe("/go/a1b2c3d4-e5f6");
  });
});
