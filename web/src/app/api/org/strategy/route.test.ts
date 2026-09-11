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

describe("GET /api/org/strategy", () => {
  it("既定は空文字列", async () => {
    const route = await import("./route");
    const res = await route.GET();
    expect(await res.json()).toEqual({ strategy: { mission: "", vision: "", values: "" } });
  });
});

describe("PATCH /api/org/strategy", () => {
  it("指定フィールドだけ更新し、実名復元済みで返す", async () => {
    const peopleDirectory = await import("@/lib/people-directory");
    peopleDirectory.registerName("Aさん");
    const route = await import("./route");
    const res = await route.PATCH(jsonRequest("http://localhost/x", "PATCH", { mission: "Aさんを中心に価値を届ける" }));
    const json = await res.json();
    expect(json.strategy.mission).toBe("Aさんを中心に価値を届ける");
    expect(json.strategy.vision).toBe("");
  });
});
