import { describe, expect, it } from "vitest";
import { coverageTone, healthTone, loadTone } from "./NowStatePanel";

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
