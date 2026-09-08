import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@/lib/test-helpers/store-env";

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

describe("GET /api/people", () => {
  it("登録済みの人物サマリーを返す", async () => {
    const peopleDirectory = await import("@/lib/people-directory");
    peopleDirectory.registerName("Aさん");
    const route = await import("./route");
    const res = await route.GET();
    const json = await res.json();
    expect(json.people).toHaveLength(1);
    expect(json.people[0].name).toBe("Aさん");
  });
});
