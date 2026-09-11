import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@/lib/test-helpers/store-env";
import { jsonRequest } from "@/lib/test-helpers/api-route";

vi.mock("@/lib/local-model", () => ({
  runLocalChat: vi.fn(async () =>
    JSON.stringify({
      objectives: [{ title: "AI目標", note: "理由", keyResults: ["KR-A"] }],
    }),
  ),
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

describe("POST /api/org/objectives/parse", () => {
  it("textが無ければ400", async () => {
    const route = await import("./route");
    const res = await route.POST(jsonRequest("http://localhost/x", "POST", {}));
    expect(res.status).toBe(400);
  });

  it("モデル結果を返す", async () => {
    const route = await import("./route");
    const res = await route.POST(jsonRequest("http://localhost/x", "POST", { text: "なにかOKR" }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.source).toBe("model");
    expect(data.objectives[0].title).toBe("AI目標");
  });
});
