import { describe, expect, it } from "vitest";
import { cosineSimilarity } from "@/lib/embeddings";

describe("cosineSimilarity", () => {
  it("同一ベクトルなら1になる", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
  });

  it("直交ベクトルなら0になる", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it("正反対のベクトルなら-1になる", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  it("次元数が異なる場合は0を返す", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0])).toBe(0);
  });

  it("空配列は0を返す", () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it("ゼロベクトルは0を返す（ゼロ除算を避ける）", () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});
