import { describe, expect, it } from "vitest";
import { coverageTone, healthTone, loadTone } from "./dialTones";
import { formatHealthBucketLine } from "./formatHealthBucketLine";

describe("dial tones", () => {
  it("EM負荷は高いほど bad", () => {
    expect(loadTone(0.2)).toBe("good");
    expect(loadTone(0.5)).toBe("warn");
    expect(loadTone(0.8)).toBe("bad");
  });

  it("健全度は高いほど good", () => {
    expect(healthTone(0.8)).toBe("good");
    expect(healthTone(0.5)).toBe("warn");
    expect(healthTone(0.2)).toBe("bad");
    expect(healthTone(null)).toBe("unknown");
  });

  it("カバレッジは高いとき accent", () => {
    expect(coverageTone(0.8)).toBe("accent");
    expect(coverageTone(0.5)).toBe("warn");
    expect(coverageTone(0.2)).toBe("bad");
  });
});

describe("formatHealthBucketLine", () => {
  it("代表名が件数より少ないとき末尾に…を付ける", () => {
    expect(
      formatHealthBucketLine({
        status: "good",
        count: 5,
        examples: ["田中", "佐藤"],
      }),
    ).toBe("良い 5 · 田中、佐藤…");
  });

  it("代表名で件数を尽くしているときは…を付けない", () => {
    expect(
      formatHealthBucketLine({
        status: "warn",
        count: 2,
        examples: ["鈴木", "高橋"],
      }),
    ).toBe("要注意 2 · 鈴木、高橋");
  });
});
