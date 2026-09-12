import { describe, expect, it } from "vitest";
import { parseObservationHeuristic } from "@/lib/observation-dump-parse";

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
