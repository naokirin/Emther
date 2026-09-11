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

describe("GET /api/org/background", () => {
  it("既定は空配列", async () => {
    const route = await import("./route");
    const res = await route.GET();
    expect(await res.json()).toEqual({ backgrounds: [] });
  });
});

describe("POST /api/org/background", () => {
  it("title/fact必須、既定scopeはalways", async () => {
    const route = await import("./route");
    const bad = await route.POST(jsonRequest("http://localhost/x", "POST", { title: "x" }));
    expect(bad.status).toBe(400);

    const res = await route.POST(
      jsonRequest("http://localhost/x", "POST", {
        title: "2024 個人情報漏洩",
        fact: "顧客データの一部が外部に流出した",
        implication: "セキュリティ投資を軽視しない",
        tags: ["security", "trust"],
      }),
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.background.title).toBe("2024 個人情報漏洩");
    expect(json.background.scope).toBe("always");
    expect(json.background.status).toBe("active");
    expect(json.background.tags).toEqual(["security", "trust"]);
  });
});
