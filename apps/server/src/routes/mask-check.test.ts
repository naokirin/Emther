import { describe, expect, it, vi } from "vitest";

vi.mock("@emther/core/local-model", () => ({
  runLocalChat: vi.fn(async () => JSON.stringify({ findings: [], people: [] })),
  extractFirstJsonObject: (text: string) => text,
}));

function post(body: unknown) {
  return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

describe("POST /api/mask-check", () => {
  it("JSONボディでなければ400", async () => {
    const { maskCheckRoute } = await import("./mask-check");
    const res = await maskCheckRoute.request("/", { method: "POST", body: "not json" });
    expect(res.status).toBe(400);
  });

  it("textが文字列でなければ400", async () => {
    const { maskCheckRoute } = await import("./mask-check");
    const res = await maskCheckRoute.request("/", post({ text: 123 }));
    expect(res.status).toBe(400);
  });

  it("textが空なら400", async () => {
    const { maskCheckRoute } = await import("./mask-check");
    const res = await maskCheckRoute.request("/", post({ text: "   " }));
    expect(res.status).toBe(400);
  });

  it("phase未指定はquickとして実行できる", async () => {
    const { maskCheckRoute } = await import("./mask-check");
    const res = await maskCheckRoute.request("/", post({ text: "Aさんと1on1した" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.phase).toBe("quick");
  });

  it("phase:aiでローカルAIチェックを実行できる", async () => {
    const { maskCheckRoute } = await import("./mask-check");
    const res = await maskCheckRoute.request("/", post({ text: "普通のメモ", phase: "ai" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.phase).toBe("ai");
  });
});
