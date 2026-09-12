import { describe, expect, it } from "vitest";
import {
  buildGapAnnotations,
  buildRankedRows,
  classifyScoreGap,
  deltaFromPrevious,
  detectHeavyTopSwapHint,
  expandFromCenter,
  layoutQuadrantBubbles,
  summarizeGaps,
  type RankedScoreRow,
} from "@/lib/issue-score-gaps";

describe("classifyScoreGap", () => {
  it("大きな差を崖、小さな差を高原にする", () => {
    expect(classifyScoreGap(0.4, 1)).toBe("cliff");
    expect(classifyScoreGap(0.02, 1)).toBe("plateau");
    expect(classifyScoreGap(0.1, 1)).toBe("normal");
  });

  it("スコア尺度が大きいとき閾値も上がる", () => {
    expect(classifyScoreGap(0.3, 3)).toBe("normal");
    expect(classifyScoreGap(0.8, 3)).toBe("cliff");
  });
});

describe("buildRankedRows", () => {
  it("スコア降順にし、未評価を分ける", () => {
    const { ranked, unscored } = buildRankedRows([
      { id: "a", title: "A", triage: { score: 0.2, costOfDelay: 0.2, effort: 0.4, blastRadius: 0.3, confidence: 0.5 } },
      { id: "b", title: "B", triage: { score: 0.9, costOfDelay: 0.8, effort: 0.3, blastRadius: 0.7, confidence: 0.8 } },
      { id: "c", title: "C" },
    ]);
    expect(ranked.map((r) => r.id)).toEqual(["b", "a"]);
    expect(unscored.map((u) => u.id)).toEqual(["c"]);
  });
});

describe("buildGapAnnotations / summarizeGaps", () => {
  it("1位突出を要約する", () => {
    const ranked = [
      { id: "1", title: "重要", priority: "focus", score: 1.2, costOfDelay: 0.9, effort: 0.3, blastRadius: 0.8, confidence: 0.8 },
      { id: "2", title: "次点", priority: "normal", score: 0.4, costOfDelay: 0.4, effort: 0.4, blastRadius: 0.4, confidence: 0.5 },
      { id: "3", title: "余裕", priority: "parked", score: 0.35, costOfDelay: 0.3, effort: 0.4, blastRadius: 0.3, confidence: 0.5 },
    ];
    const gaps = buildGapAnnotations(ranked);
    expect(gaps[0].kind).toBe("cliff");
    const lines = summarizeGaps(ranked, gaps);
    expect(lines.some((l) => l.includes("1位が突出"))).toBe(true);
  });
});

describe("detectHeavyTopSwapHint", () => {
  it("重い上位と軽い次点があるときヒントを出す", () => {
    const ranked = [
      { id: "1", title: "重い1", priority: "focus", score: 1.0, costOfDelay: 0.9, effort: 0.8, blastRadius: 0.8, confidence: 0.7 },
      { id: "2", title: "重い2", priority: "focus", score: 0.9, costOfDelay: 0.8, effort: 0.75, blastRadius: 0.7, confidence: 0.7 },
      { id: "3", title: "重い3", priority: "focus", score: 0.85, costOfDelay: 0.7, effort: 0.7, blastRadius: 0.7, confidence: 0.7 },
      { id: "4", title: "軽い次点", priority: "normal", score: 0.55, costOfDelay: 0.5, effort: 0.3, blastRadius: 0.5, confidence: 0.6 },
    ];
    const hint = detectHeavyTopSwapHint(ranked);
    expect(hint).toContain("軽い次点");
  });
});

describe("deltaFromPrevious", () => {
  it("1位は null、以降はひとつ上との差", () => {
    const ranked = [
      { id: "1", title: "A", priority: "focus", score: 1.0, costOfDelay: 0.9, effort: 0.3, blastRadius: 0.5, confidence: 0.8 },
      { id: "2", title: "B", priority: "normal", score: 0.7, costOfDelay: 0.5, effort: 0.4, blastRadius: 0.4, confidence: 0.6 },
    ];
    expect(deltaFromPrevious(ranked, 0)).toBeNull();
    expect(deltaFromPrevious(ranked, 1)).toBeCloseTo(0.3);
  });
});

describe("expandFromCenter / layoutQuadrantBubbles", () => {
  it("中心付近を外側へ広げ、端点は固定する", () => {
    expect(expandFromCenter(0)).toBeCloseTo(0);
    expect(expandFromCenter(1)).toBeCloseTo(1);
    expect(expandFromCenter(0.5)).toBeCloseTo(0.5);
    // 0.4 は中心寄り → 拡散後はより外側（より小さい）
    expect(expandFromCenter(0.4)).toBeLessThan(0.4);
    expect(expandFromCenter(0.6)).toBeGreaterThan(0.6);
  });

  it("同位置の点はホーム近傍に留め、完全分離はしない", () => {
    const base: RankedScoreRow = {
      id: "x",
      title: "X",
      priority: "normal",
      score: 0.5,
      costOfDelay: 0.7,
      effort: 0.4,
      blastRadius: 0.5,
      confidence: 0.6,
    };
    const rows = [
      { ...base, id: "a", title: "A", score: 0.9 },
      { ...base, id: "b", title: "B", score: 0.8 },
      { ...base, id: "c", title: "C", score: 0.7 },
    ];
    const layout = layoutQuadrantBubbles(rows, {
      padLeft: 40,
      padTop: 40,
      innerW: 400,
      innerH: 300,
    });
    expect(layout).toHaveLength(3);
    for (const p of layout) {
      const nudge = Math.hypot(p.cx - p.homeCx, p.cy - p.homeCy);
      expect(nudge).toBeLessThanOrEqual(8.01);
    }
    // 先頭はホーム据え置き、他は少しだけ離れるが重なりうる
    expect(Math.hypot(layout[0].cx - layout[0].homeCx, layout[0].cy - layout[0].homeCy)).toBe(0);
    const d01 = Math.hypot(layout[0].cx - layout[1].cx, layout[0].cy - layout[1].cy);
    expect(d01).toBeGreaterThan(0);
    expect(d01).toBeLessThan(layout[0].r + layout[1].r);
  });

  it("介入コストが低いほど右に寄る", () => {
    const mk = (id: string, effort: number): RankedScoreRow => ({
      id,
      title: id,
      priority: "normal",
      score: 0.5,
      costOfDelay: 0.5,
      effort,
      blastRadius: 0.3,
      confidence: 0.5,
    });
    const layout = layoutQuadrantBubbles([mk("heavy", 0.9), mk("light", 0.1)], {
      padLeft: 0,
      padTop: 0,
      innerW: 100,
      innerH: 100,
    });
    const heavy = layout.find((p) => p.id === "heavy")!;
    const light = layout.find((p) => p.id === "light")!;
    expect(light.homeCx).toBeGreaterThan(heavy.homeCx);
  });
});
