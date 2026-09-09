import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@/lib/test-helpers/store-env";
import { jsonRequest } from "@/lib/test-helpers/api-route";

let dir: string;

beforeEach(() => {
  dir = setupIsolatedStoreEnv();
  vi.resetModules();
});

afterEach(() => {
  teardownIsolatedStoreEnv(dir);
});

describe("GET /api/settings/rules", () => {
  it("既定値を返す", async () => {
    const route = await import("./route");
    const res = await route.GET();
    const json = await res.json();
    expect(json.rules.maxParallelAgentRuns).toBe(2);
  });
});

describe("PATCH /api/settings/rules", () => {
  it("数値・真偽値・配列フィールドを部分更新できる", async () => {
    const route = await import("./route");
    const res = await route.PATCH(
      jsonRequest("http://localhost/x", "PATCH", {
        teamWindowDays: 30,
        autoAnomalyDetectionEnabled: true,
        agyFallbackAgents: ["Lead Agent", 123],
      }),
    );
    const json = await res.json();
    expect(json.rules.teamWindowDays).toBe(30);
    expect(json.rules.autoAnomalyDetectionEnabled).toBe(true);
    expect(json.rules.agyFallbackAgents).toEqual(["Lead Agent"]);
    expect(json.rules.maxParallelAgentRuns).toBe(2); // 未指定は既定値のまま
  });

  it("maxParallelAgentRunsは0以下にできない（デッドロック防止で最低1に丸める）", async () => {
    const route = await import("./route");
    const res = await route.PATCH(jsonRequest("http://localhost/x", "PATCH", { maxParallelAgentRuns: 0 }));
    expect((await res.json()).rules.maxParallelAgentRuns).toBe(1);
  });

  it("decisionQueueLimit/observationQueueLimit/staleInterventionDaysを更新できる", async () => {
    const route = await import("./route");
    const res = await route.PATCH(
      jsonRequest("http://localhost/x", "PATCH", {
        decisionQueueLimit: 5,
        observationQueueLimit: 10,
        staleInterventionDays: 3,
      }),
    );
    const json = await res.json();
    expect(json.rules.decisionQueueLimit).toBe(5);
    expect(json.rules.observationQueueLimit).toBe(10);
    expect(json.rules.staleInterventionDays).toBe(3);
  });

  it("型が不正な値は無視する（既定値のまま）", async () => {
    const route = await import("./route");
    const res = await route.PATCH(jsonRequest("http://localhost/x", "PATCH", { teamWindowDays: "not-a-number" }));
    expect((await res.json()).rules.teamWindowDays).toBe(14);
  });

  // ユーザー要望「利用するAIツールの優先度を設定で変更できるようにしたい」対応。
  describe("cliPriorityOrder", () => {
    it("claude/agy/cursorの並び替えを更新できる", async () => {
      const route = await import("./route");
      const res = await route.PATCH(jsonRequest("http://localhost/x", "PATCH", { cliPriorityOrder: ["cursor", "claude", "agy"] }));
      expect((await res.json()).rules.cliPriorityOrder).toEqual(["cursor", "claude", "agy"]);
    });

    it("要素が不足していると無視する（既定値のまま）", async () => {
      const route = await import("./route");
      const res = await route.PATCH(jsonRequest("http://localhost/x", "PATCH", { cliPriorityOrder: ["cursor", "claude"] }));
      expect((await res.json()).rules.cliPriorityOrder).toEqual(["claude", "agy", "cursor"]);
    });

    it("重複した値があると無視する（既定値のまま）", async () => {
      const route = await import("./route");
      const res = await route.PATCH(
        jsonRequest("http://localhost/x", "PATCH", { cliPriorityOrder: ["cursor", "cursor", "claude"] }),
      );
      expect((await res.json()).rules.cliPriorityOrder).toEqual(["claude", "agy", "cursor"]);
    });

    it("知らない値が含まれると無視する（既定値のまま）", async () => {
      const route = await import("./route");
      const res = await route.PATCH(
        jsonRequest("http://localhost/x", "PATCH", { cliPriorityOrder: ["cursor", "claude", "bogus"] }),
      );
      expect((await res.json()).rules.cliPriorityOrder).toEqual(["claude", "agy", "cursor"]);
    });
  });
});
