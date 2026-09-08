import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@/lib/test-helpers/store-env";
import { jsonRequest } from "@/lib/test-helpers/api-route";

// このルートはstartRunを呼ぶため、実CLIを起動しないようnode:child_processのspawnを
// モックする（web/src/lib/agent-runtime.test.tsと同じパターン）。
vi.mock("@/lib/local-model", () => ({
  runLocalChat: vi.fn(async () => JSON.stringify({ people: [] })),
  extractFirstJsonObject: (text: string) => text,
}));
vi.mock("@/lib/embeddings", () => ({
  embedText: vi.fn(async () => [1, 0, 0]),
  cosineSimilarity: () => 0,
}));

const spawnRef = vi.hoisted(() => ({
  impl: (() => {
    throw new Error("spawn is not mocked for this test");
  }) as (command: string, args: string[]) => unknown,
}));
vi.mock("node:child_process", () => ({
  spawn: (command: string, args: string[]) => spawnRef.impl(command, args),
}));

class FakeChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();
}

let dir: string;

beforeEach(() => {
  dir = setupIsolatedStoreEnv();
  vi.resetModules();
  spawnRef.impl = () => new FakeChildProcess();
});

afterEach(() => {
  teardownIsolatedStoreEnv(dir);
});

describe("GET /api/agents", () => {
  it("空なら空配列", async () => {
    const route = await import("./route");
    const res = await route.GET();
    expect(await res.json()).toEqual({ runs: [] });
  });
});

describe("POST /api/agents", () => {
  it("agentName/taskが無ければ400", async () => {
    const route = await import("./route");
    const res = await route.POST(jsonRequest("http://localhost/x", "POST", { agentName: "Lead Agent" }));
    expect(res.status).toBe(400);
  });

  it("起動できる（201）。CLI起動自体は別途モックしたspawnを使う", async () => {
    const route = await import("./route");
    const res = await route.POST(jsonRequest("http://localhost/x", "POST", { agentName: "Lead Agent", task: "タスク" }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.run.agentName).toBe("Lead Agent");
    expect(json.run.status).toBe("active");
  });
});
