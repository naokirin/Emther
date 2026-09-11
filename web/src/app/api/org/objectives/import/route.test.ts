import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@/lib/test-helpers/store-env";
import { jsonRequest } from "@/lib/test-helpers/api-route";

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

describe("POST /api/org/objectives/import", () => {
  it("mode不正は400", async () => {
    const route = await import("./route");
    const res = await route.POST(
      jsonRequest("http://localhost/x", "POST", { mode: "merge", objectives: [{ title: "x", keyResults: [] }] }),
    );
    expect(res.status).toBe(400);
  });

  it("追記できる", async () => {
    const orgStore = await import("@/lib/org-context-store");
    await orgStore.addObjective("既存");
    const route = await import("./route");
    const res = await route.POST(
      jsonRequest("http://localhost/x", "POST", {
        mode: "append",
        objectives: [{ title: "新規", note: "理由", keyResults: ["KR1"] }],
      }),
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.objectives).toHaveLength(1);
    expect(data.objectives[0].title).toBe("新規");
    expect(data.objectives[0].note).toBe("理由");
    expect(orgStore.listObjectives()).toHaveLength(2);
  });

  it("差し替えは同一スコープのみ消す", async () => {
    const orgStore = await import("@/lib/org-context-store");
    const team = orgStore.addTeam("Team A", []);
    await orgStore.addObjective("組織");
    await orgStore.addObjective("チーム旧", team.id);
    const route = await import("./route");
    const res = await route.POST(
      jsonRequest("http://localhost/x", "POST", {
        mode: "replace",
        teamId: team.id,
        objectives: [{ title: "チーム新", keyResults: [] }],
      }),
    );
    expect(res.status).toBe(201);
    const titles = orgStore.listObjectives().map((o) => o.title);
    expect(titles).toContain("組織");
    expect(titles).toContain("チーム新");
    expect(titles).not.toContain("チーム旧");
  });
});
