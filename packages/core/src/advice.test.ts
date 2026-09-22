import { describe, expect, it } from "vitest";
import {
  adviceGroupOutlineLabel,
  adviceStructuredHasDetails,
  effectiveAdviceText,
  flattenAdviceStructured,
  mergeAdviceFollowUps,
  normalizeAdviceStructured,
  shouldShowStructuredAdvice,
} from "./advice";

describe("normalizeAdviceStructured", () => {
  it("文字列を overview に昇格する", () => {
    expect(normalizeAdviceStructured("  進める  ")).toEqual({ overview: "進める", groups: [] });
  });

  it("groups 付きオブジェクトを正規化する", () => {
    const s = normalizeAdviceStructured({
      overview: "前置き",
      groups: [{ title: "A", nextActions: ["x", ""], watchOuts: ["y"] }],
      followUps: [{ label: "L", message: "M" }, { label: "", message: "x" }],
    });
    expect(s?.overview).toBe("前置き");
    expect(s?.groups).toEqual([{ title: "A", nextActions: ["x"], watchOuts: ["y"] }]);
    expect(s?.followUps).toEqual([{ label: "L", message: "M" }]);
  });

  it("フラットな nextActions を1グループにする", () => {
    const s = normalizeAdviceStructured({ nextActions: ["a"], verify: ["b"] });
    expect(s?.groups).toEqual([{ nextActions: ["a"], verify: ["b"] }]);
  });
});

describe("flatten / effective / shouldShow", () => {
  it("flatten は見出しとリストを含む", () => {
    const text = flattenAdviceStructured({
      overview: "全体",
      groups: [
        { title: "第一", summary: "背景", nextActions: ["動く"], watchOuts: ["急がない"] },
        { title: "第二", nextActions: ["見る"] },
      ],
    });
    expect(text).toContain("全体");
    expect(text).toContain("### 第一");
    expect(text).toContain("**やること**");
    expect(text).toContain("- 動く");
    expect(text).toContain("### 第二");
  });

  it("effectiveAdviceText は override → legacy → flatten の順", () => {
    expect(
      effectiveAdviceText({
        adviceOverride: "EM",
        advice: "旧",
        adviceStructured: { overview: "AI", groups: [] },
      }),
    ).toBe("EM");
    expect(effectiveAdviceText({ advice: "旧" })).toBe("旧");
    expect(effectiveAdviceText({ adviceStructured: { overview: "AI", groups: [] } })).toBe("AI");
  });

  it("shouldShowStructuredAdvice は override/legacy があると false", () => {
    expect(shouldShowStructuredAdvice({ adviceStructured: { overview: "a", groups: [] } })).toBe(true);
    expect(
      shouldShowStructuredAdvice({
        adviceOverride: "x",
        adviceStructured: { overview: "a", groups: [] },
      }),
    ).toBe(false);
    expect(
      shouldShowStructuredAdvice({
        advice: "x",
        adviceStructured: { overview: "a", groups: [] },
      }),
    ).toBe(false);
  });
  it("adviceStructuredHasDetails は groups の中身を見る", () => {
    expect(adviceStructuredHasDetails({ groups: [] })).toBe(false);
    expect(adviceStructuredHasDetails({ overview: "のみ", groups: [] })).toBe(false);
    expect(adviceStructuredHasDetails({ groups: [{ nextActions: ["a"] }] })).toBe(true);
  });

  it("adviceGroupOutlineLabel は title → summary → nextAction の順", () => {
    expect(adviceGroupOutlineLabel({ title: "見出し" }, 0)).toBe("見出し");
    expect(adviceGroupOutlineLabel({ summary: "背景の説明" }, 0)).toBe("背景の説明");
    expect(adviceGroupOutlineLabel({ nextActions: ["動く"] }, 0)).toBe("動く");
    expect(adviceGroupOutlineLabel({}, 2)).toBe("進め方 3");
  });
});

describe("mergeAdviceFollowUps", () => {
  it("AI を優先しつつ定型で埋める", () => {
    const merged = mergeAdviceFollowUps([{ label: "固有", message: "固有メッセージ" }], 3);
    expect(merged[0]?.label).toBe("固有");
    expect(merged.length).toBe(3);
  });
});
