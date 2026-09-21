import { describe, expect, it, vi, beforeEach } from "vitest";
import { heuristicWhyNow, suggestWhyNow, type WhyNowActionInput } from "./why-now-suggest";

vi.mock("./cloud-chat", () => ({
  runCloudChat: vi.fn(),
}));

import { runCloudChat } from "./cloud-chat";

const runCloudChatMock = vi.mocked(runCloudChat);

function action(overrides: Partial<WhyNowActionInput> & { id: string }): WhyNowActionInput {
  return {
    text: "Aさんの負荷が続いている",
    lane: "decision",
    severity: "urgent",
    kindLabel: "判断待ち",
    elapsedDays: 14,
    ...overrides,
  };
}

describe("heuristicWhyNow", () => {
  it("緊急の判断待ちは放置リスクを示す", () => {
    expect(heuristicWhyNow(action({ id: "a1" }))).toContain("14日続いている");
    expect(heuristicWhyNow(action({ id: "a1" }))).toContain("今決める");
  });

  it("観測不足は材料不足を示す", () => {
    expect(heuristicWhyNow(action({ id: "a2", lane: "observation", severity: "warn", elapsedDays: 3 }))).toContain(
      "材料を足す",
    );
  });
});

describe("suggestWhyNow", () => {
  beforeEach(() => {
    runCloudChatMock.mockReset();
  });

  it("空入力は heuristic + no_actions", async () => {
    const result = await suggestWhyNow([]);
    expect(result).toEqual({ items: [], source: "heuristic", fallbackReason: "no_actions" });
    expect(runCloudChatMock).not.toHaveBeenCalled();
  });

  it("cloud成功時はAIのwhyNowを返す", async () => {
    runCloudChatMock.mockResolvedValueOnce(
      JSON.stringify({ items: [{ actionId: "a1", whyNow: "先週と同パターンで離職リスクが強まる" }] }),
    );
    const result = await suggestWhyNow([action({ id: "a1" })]);
    expect(result.source).toBe("cloud");
    expect(result.items).toEqual([{ actionId: "a1", whyNow: "先週と同パターンで離職リスクが強まる" }]);
  });

  it("cloud失敗時はheuristicに落ちる", async () => {
    runCloudChatMock.mockRejectedValueOnce(new Error("timeout"));
    const result = await suggestWhyNow([action({ id: "a1" })]);
    expect(result.source).toBe("heuristic");
    expect(result.fallbackReason).toMatch(/cloud_error/);
    expect(result.items[0]?.whyNow).toContain("14日続いている");
  });

  it("cloudが一部欠ける場合は欠け分をheuristicで埋める", async () => {
    runCloudChatMock.mockResolvedValueOnce(
      JSON.stringify({ items: [{ actionId: "a1", whyNow: "クラウド文" }] }),
    );
    const result = await suggestWhyNow([action({ id: "a1" }), action({ id: "a2", elapsedDays: 2 })]);
    expect(result.source).toBe("cloud");
    expect(result.items.find((i) => i.actionId === "a1")?.whyNow).toBe("クラウド文");
    expect(result.items.find((i) => i.actionId === "a2")?.whyNow).toContain("2日続いている");
  });
});
