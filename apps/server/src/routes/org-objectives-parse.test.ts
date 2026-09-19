import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@emther/core/test-helpers/store-env";

vi.mock("@emther/core/cloud-chat", () => ({
  runCloudChat: vi.fn(async () => JSON.stringify({ objectives: [{ title: "AI目標", note: "理由", keyResults: ["KR-A"] }] })),
}));

vi.mock("@emther/core/local-model", () => ({
  extractFirstJsonObject: (text: string) => text,
}));

vi.mock("@emther/core/embeddings", () => ({
  embedText: vi.fn(async () => [1, 0, 0]),
  cosineSimilarity: () => 0,
}));

vi.mock("@emther/core/people-directory", async () => {
  const actual = await vi.importActual<typeof import("@emther/core/people-directory")>("@emther/core/people-directory");
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

function post(body: unknown) {
  return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

describe("POST /api/org/objectives/parse", () => {
  it("textが無ければ400", async () => {
    const { orgObjectivesParseRoute } = await import("./org-objectives-parse");
    const res = await orgObjectivesParseRoute.request("/", post({}));
    expect(res.status).toBe(400);
  });

  it("外部AI結果を返す", async () => {
    const { orgObjectivesParseRoute } = await import("./org-objectives-parse");
    const res = await orgObjectivesParseRoute.request("/", post({ text: "なにかOKR" }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.source).toBe("cloud");
    expect(data.objectives[0].title).toBe("AI目標");
  });
});
