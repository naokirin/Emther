import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@emther/core/test-helpers/store-env";

vi.mock("@emther/core/local-model", () => ({
  runLocalChat: vi.fn(async () => JSON.stringify({ people: [] })),
  extractFirstJsonObject: (text: string) => text,
}));
vi.mock("@emther/core/embeddings", () => ({
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

describe("POST /api/growth/generate", () => {
  it("Lead Agentの分析Runを起動し、reviewed済みで返す（201）", async () => {
    const { growthGenerateRoute } = await import("./growth-generate");
    const res = await growthGenerateRoute.request("/", { method: "POST" });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.run.agentName).toBe("Lead Agent");
    expect(json.run.reviewed).toBe(true);
  });
});
