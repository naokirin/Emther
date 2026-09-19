import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@core/test-helpers/store-env";
import { jsonRequest } from "@core/test-helpers/api-route";

vi.mock("@core/cloud-chat", () => ({
  runCloudChat: vi.fn(async () =>
    JSON.stringify({
      objectives: [{ title: "AI目標", note: "理由", keyResults: ["KR-A"] }],
    }),
  ),
}));

vi.mock("@core/local-model", () => ({
  extractFirstJsonObject: (text: string) => text,
}));

vi.mock("@core/embeddings", () => ({
  embedText: vi.fn(async () => [1, 0, 0]),
  cosineSimilarity: () => 0,
}));

vi.mock("@core/people-directory", async () => {
  const actual = await vi.importActual<typeof import("@core/people-directory")>("@core/people-directory");
  return {
    ...actual,
    ensureNameCandidatesAllowed: vi.fn(async () => undefined),
    maskForStorage: vi.fn(async (t: string) => t),
    unmaskNames: (t: string) => t,
    assertNoRealNamesLeaked: vi.fn(),
  };
});

let dir: string;

beforeEach(() => {
  dir = setupIsolatedStoreEnv();
  vi.resetModules();
});

afterEach(() => {
  teardownIsolatedStoreEnv(dir);
});

describe("POST /api/org/objectives/parse", () => {
  it("textが無ければ400", async () => {
    const route = await import("./route");
    const res = await route.POST(jsonRequest("http://localhost/x", "POST", {}));
    expect(res.status).toBe(400);
  });

  it("外部AI結果を返す", async () => {
    const route = await import("./route");
    const res = await route.POST(jsonRequest("http://localhost/x", "POST", { text: "なにかOKR" }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.source).toBe("cloud");
    expect(data.objectives[0].title).toBe("AI目標");
  });
});
