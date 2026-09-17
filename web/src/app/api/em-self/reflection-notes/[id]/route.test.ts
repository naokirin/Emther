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

function params(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

describe("PATCH /api/em-self/reflection-notes/[id]", () => {
  it("archivedが無い／型不正なら400", async () => {
    const route = await import("./route");
    const res = await route.PATCH(jsonRequest("http://localhost/x", "PATCH", {}), params("x"));
    expect(res.status).toBe(400);
  });

  it("存在しないidなら404", async () => {
    const route = await import("./route");
    const res = await route.PATCH(
      jsonRequest("http://localhost/x", "PATCH", { archived: true }),
      params("no-such-id"),
    );
    expect(res.status).toBe(404);
  });

  it("archived=trueで完了にでき、falseで戻せる", async () => {
    const listRoute = await import("../route");
    const createRes = await listRoute.POST(
      jsonRequest("http://localhost/x", "POST", { type: "try", text: "割り込みを減らす" }),
    );
    const { note } = await createRes.json();

    const route = await import("./route");
    const archiveRes = await route.PATCH(
      jsonRequest("http://localhost/x", "PATCH", { archived: true }),
      params(note.id),
    );
    expect(archiveRes.status).toBe(200);
    const archived = await archiveRes.json();
    expect(archived.note.archivedAt).toEqual(expect.any(Number));

    const restoreRes = await route.PATCH(
      jsonRequest("http://localhost/x", "PATCH", { archived: false }),
      params(note.id),
    );
    expect(restoreRes.status).toBe(200);
    const restored = await restoreRes.json();
    expect(restored.note.archivedAt).toBeUndefined();
  });
});
