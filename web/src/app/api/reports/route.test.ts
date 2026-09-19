import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@core/test-helpers/store-env";
import { jsonRequest } from "@core/test-helpers/api-route";

vi.mock("@core/local-model", () => ({
  runLocalChat: vi.fn(async () => JSON.stringify({ people: [] })),
  extractFirstJsonObject: (text: string) => text,
}));

vi.mock("@core/embeddings", () => ({
  embedText: vi.fn(async () => [1, 0, 0]),
  cosineSimilarity: () => 0,
}));

let dir: string;

beforeEach(() => {
  dir = setupIsolatedStoreEnv();
  vi.resetModules();
});

afterEach(() => {
  teardownIsolatedStoreEnv(dir);
});

describe("GET /api/reports", () => {
  it("periodTypeで絞り込める", async () => {
    const reportStore = await import("@/lib/report-store");
    reportStore.generateReport("week");
    reportStore.generateReport("month");
    const route = await import("./route");

    const weekRes = await route.GET(new Request("http://localhost/x?periodType=week"));
    expect((await weekRes.json()).reports).toHaveLength(1);

    const allRes = await route.GET(new Request("http://localhost/x"));
    expect((await allRes.json()).reports).toHaveLength(2);
  });

  it("不正なperiodTypeは無視して全件返す", async () => {
    const reportStore = await import("@/lib/report-store");
    reportStore.generateReport("week");
    const route = await import("./route");
    const res = await route.GET(new Request("http://localhost/x?periodType=invalid"));
    expect((await res.json()).reports).toHaveLength(1);
  });
});

describe("POST /api/reports", () => {
  it("periodTypeが不正なら400", async () => {
    const route = await import("./route");
    const res = await route.POST(jsonRequest("http://localhost/x", "POST", { periodType: "year" }));
    expect(res.status).toBe(400);
  });

  it("生成できる（201）", async () => {
    const route = await import("./route");
    const res = await route.POST(jsonRequest("http://localhost/x", "POST", { periodType: "week" }));
    expect(res.status).toBe(201);
    expect((await res.json()).report.periodType).toBe("week");
  });

  it("periodsAgo=1なら1期間前を対象に生成する", async () => {
    vi.useFakeTimers();
    try {
      const fixedNow = new Date("2026-03-10T00:00:00.000Z").getTime();
      vi.setSystemTime(fixedNow);
      const route = await import("./route");
      const nowRes = await route.POST(jsonRequest("http://localhost/x", "POST", { periodType: "week" }));
      const now = (await nowRes.json()).report;
      const agoRes = await route.POST(jsonRequest("http://localhost/x", "POST", { periodType: "week", periodsAgo: 1 }));
      expect(agoRes.status).toBe(201);
      const ago = (await agoRes.json()).report;
      expect(ago.periodEnd).toBe(now.periodStart);
      expect(ago.periodEnd - ago.periodStart).toBe(now.periodEnd - now.periodStart);
    } finally {
      vi.useRealTimers();
    }
  });
});
