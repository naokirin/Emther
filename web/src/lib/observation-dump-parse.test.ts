import { describe, expect, it } from "vitest";
import { parseObservationHeuristic, splitMaskedTextIntoWindows } from "@/lib/observation-dump-parse";

describe("parseObservationHeuristic", () => {
  it("空行区切りで複数チャンクにする", () => {
    const text = ["Aさんと引き継ぎの話をした。", "", "Bチームのリリースが遅延している。"].join("\n");
    const { chunks } = parseObservationHeuristic(text);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0].textMasked).toContain("引き継ぎ");
    expect(chunks[1].textMasked).toContain("リリース");
  });

  it("分割できないときは全文1チャンクにフォールバックする", () => {
    const text = "短い一文だけのログです。";
    const { chunks } = parseObservationHeuristic(text);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].textMasked).toBe(text);
    expect(chunks[0].confidence).toBeLessThan(0.5);
  });
});

describe("splitMaskedTextIntoWindows", () => {
  it("短い本文は1窓のまま", () => {
    expect(splitMaskedTextIntoWindows("hello", 100)).toEqual(["hello"]);
  });

  it("空行境界を優先して複数窓に切る", () => {
    const a = "A".repeat(40);
    const b = "B".repeat(40);
    const text = `${a}\n\n${b}`;
    const windows = splitMaskedTextIntoWindows(text, 50);
    expect(windows.length).toBe(2);
    expect(windows[0]).toBe(a);
    expect(windows[1]).toBe(b);
  });

  it("極端に長い1行は硬くスライスする", () => {
    const line = "X".repeat(120);
    const windows = splitMaskedTextIntoWindows(line, 50);
    expect(windows.length).toBe(3);
    expect(windows.every((w) => w.length <= 50)).toBe(true);
    expect(windows.join("")).toBe(line);
  });
});
