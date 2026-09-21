import { describe, expect, it, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { dashboardWhyNowRoute } from "./dashboard-why-now";

vi.mock("@emther/core/why-now-suggest", () => ({
  suggestWhyNow: vi.fn(),
}));

import { suggestWhyNow } from "@emther/core/why-now-suggest";

const suggestWhyNowMock = vi.mocked(suggestWhyNow);

function createApp() {
  return new Hono().route("/api/dashboard/why-now", dashboardWhyNowRoute);
}

describe("POST /api/dashboard/why-now", () => {
  beforeEach(() => {
    suggestWhyNowMock.mockReset();
  });

  it("actions を渡して why-now を返す", async () => {
    suggestWhyNowMock.mockResolvedValueOnce({
      items: [{ actionId: "a1", whyNow: "今決めるべき" }],
      source: "cloud",
    });
    const app = createApp();
    const res = await app.request("/api/dashboard/why-now", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actions: [{ id: "a1", text: "負荷", lane: "decision", severity: "urgent", kindLabel: "判断", elapsedDays: 3 }],
      }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      items: [{ actionId: "a1", whyNow: "今決めるべき" }],
      source: "cloud",
      fallbackReason: undefined,
    });
    expect(suggestWhyNowMock).toHaveBeenCalledWith([
      expect.objectContaining({ id: "a1", elapsedDays: 3 }),
    ]);
  });
});
