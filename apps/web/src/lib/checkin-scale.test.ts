import { describe, expect, it } from "vitest";
import { scaleLabel, toChartValue } from "./checkin-scale";

describe("scaleLabel", () => {
  it("1〜5を定性ラベルに変換する", () => {
    expect(scaleLabel(1)).toBe("低");
    expect(scaleLabel(2)).toBe("やや低");
    expect(scaleLabel(3)).toBe("中");
    expect(scaleLabel(4)).toBe("やや高");
    expect(scaleLabel(5)).toBe("高");
  });

  it("欠損はダッシュ", () => {
    expect(scaleLabel(undefined)).toBe("—");
    expect(scaleLabel(null)).toBe("—");
  });
});

describe("toChartValue", () => {
  it("ストレスだけ反転し、他はそのまま", () => {
    expect(toChartValue("mood", 2)).toBe(2);
    expect(toChartValue("energy", 4)).toBe(4);
    expect(toChartValue("headroom", 5)).toBe(5);
    expect(toChartValue("stress", 1)).toBe(5);
    expect(toChartValue("stress", 5)).toBe(1);
    expect(toChartValue("stress", 3)).toBe(3);
  });

  it("nullはそのまま", () => {
    expect(toChartValue("stress", null)).toBeNull();
  });
});
