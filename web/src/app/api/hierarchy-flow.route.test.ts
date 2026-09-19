import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@core/test-helpers/store-env";
import { jsonRequest } from "@core/test-helpers/api-route";

vi.mock("@core/embeddings", () => ({
  embedText: vi.fn(async () => [1, 0, 0]),
}));

vi.mock("@/lib/cloud-chat", () => ({
  runCloudChat: vi.fn(async () => {
    throw new Error("cloud disabled in hierarchy-flow tests");
  }),
}));

vi.mock("@core/local-model", () => ({
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

describe("POST /api/themes/from-okr", () => {
  it("Objective から候補テーマを生成する", async () => {
    const org = await import("@core/org-context-store/index");
    const objective = await org.addObjective("デリバリー速度を上げる", undefined, "リードタイム短縮");
    await org.addKeyResult(objective.id, "デプロイ頻度を週2回に");

    const route = await import("@/app/api/themes/from-okr/route");
    const res = await route.POST(
      jsonRequest("http://localhost/api/themes/from-okr", "POST", { objectiveIds: [objective.id] }),
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.themes).toHaveLength(1);
    expect(data.themes[0].objectiveIds).toEqual([objective.id]);
    expect(data.themes[0].status).toBe("candidate");
  });
});
