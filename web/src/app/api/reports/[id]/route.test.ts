import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@/lib/test-helpers/store-env";
import { jsonRequest, routeCtx } from "@/lib/test-helpers/api-route";

vi.mock("@/lib/local-model", () => ({
  runLocalChat: vi.fn(async () => JSON.stringify({ people: [] })),
  extractFirstJsonObject: (text: string) => text,
}));

vi.mock("@/lib/embeddings", () => ({
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

describe("PATCH /api/reports/[id]", () => {
  it("noteが無ければ400", async () => {
    const route = await import("./route");
    const res = await route.PATCH(jsonRequest("http://localhost/x", "PATCH", {}), routeCtx({ id: "missing" }));
    expect(res.status).toBe(400);
  });

  it("存在しないIDは404", async () => {
    const route = await import("./route");
    const res = await route.PATCH(jsonRequest("http://localhost/x", "PATCH", { note: "所感" }), routeCtx({ id: "missing" }));
    expect(res.status).toBe(404);
  });

  it("noteを更新できる（実名復元済みで返す）", async () => {
    const peopleDirectory = await import("@/lib/people-directory");
    const reportStore = await import("@/lib/report-store");
    peopleDirectory.registerName("Aさん");
    const report = reportStore.generateReport("week");
    const route = await import("./route");
    const res = await route.PATCH(
      jsonRequest("http://localhost/x", "PATCH", { note: "Aさんとの1on1で確認" }),
      routeCtx({ id: report.id }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).report.note).toBe("Aさんとの1on1で確認");
  });
});
