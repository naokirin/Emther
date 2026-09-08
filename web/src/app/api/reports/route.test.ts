import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@/lib/test-helpers/store-env";
import { jsonRequest } from "@/lib/test-helpers/api-route";

vi.mock("@/lib/local-model", () => ({
  runLocalChat: vi.fn(async () => JSON.stringify({ people: [] })),
  extractFirstJsonObject: (text: string) => text,
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
});
