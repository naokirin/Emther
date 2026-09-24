import { describe, expect, it } from "vitest";
import { journalTextWithOptionalTitlePrefix } from "./observation-dump-actions";

describe("journalTextWithOptionalTitlePrefix", () => {
  it("prependがfalseなら本文のみ", () => {
    expect(journalTextWithOptionalTitlePrefix("決定: 延期する。", "週次", false)).toBe("決定: 延期する。");
  });

  it("タイトルが空なら本文のみ", () => {
    expect(journalTextWithOptionalTitlePrefix("決定: 延期する。", "  ", true)).toBe("決定: 延期する。");
    expect(journalTextWithOptionalTitlePrefix("決定: 延期する。", undefined, true)).toBe("決定: 延期する。");
  });

  it("prepend時は [タイトル] を先頭に付ける", () => {
    expect(journalTextWithOptionalTitlePrefix("決定: 延期する。", "9/10 週次", true)).toBe(
      "[9/10 週次] 決定: 延期する。",
    );
  });

  it("前後空白を整える", () => {
    expect(journalTextWithOptionalTitlePrefix("  本文  ", " タイトル ", true)).toBe("[タイトル] 本文");
  });
});
