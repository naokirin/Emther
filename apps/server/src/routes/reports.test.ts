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

// POST /api/reports/review は startPeriodReviewAnalysis 経由で Lead Agent run を起動する
// （themes-distill.test.ts / growth-generate.test.ts と同じ spawn モックの流儀）。
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

function post(body: unknown) {
  return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

function patch(body: unknown) {
  return { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

describe("GET /api/reports", () => {
  it("periodTypeで絞り込める", async () => {
    const reportStore = await import("@emther/core/report-store");
    reportStore.generateReport("week");
    reportStore.generateReport("month");
    const { reportsRoute } = await import("./reports");

    const weekRes = await reportsRoute.request("/?periodType=week");
    expect((await weekRes.json()).reports).toHaveLength(1);

    const allRes = await reportsRoute.request("/");
    expect((await allRes.json()).reports).toHaveLength(2);
  });

  it("不正なperiodTypeは無視して全件返す", async () => {
    const reportStore = await import("@emther/core/report-store");
    reportStore.generateReport("week");
    const { reportsRoute } = await import("./reports");
    const res = await reportsRoute.request("/?periodType=invalid");
    expect((await res.json()).reports).toHaveLength(1);
  });
});

describe("POST /api/reports", () => {
  it("periodTypeが不正なら400", async () => {
    const { reportsRoute } = await import("./reports");
    const res = await reportsRoute.request("/", post({ periodType: "year" }));
    expect(res.status).toBe(400);
  });

  it("生成できる（201）", async () => {
    const { reportsRoute } = await import("./reports");
    const res = await reportsRoute.request("/", post({ periodType: "week" }));
    expect(res.status).toBe(201);
    expect((await res.json()).report.periodType).toBe("week");
  });

  it("periodsAgo=1なら1期間前を対象に生成する", async () => {
    vi.useFakeTimers();
    try {
      const fixedNow = new Date("2026-03-10T00:00:00.000Z").getTime();
      vi.setSystemTime(fixedNow);
      const { reportsRoute } = await import("./reports");
      const nowRes = await reportsRoute.request("/", post({ periodType: "week" }));
      const now = (await nowRes.json()).report;
      const agoRes = await reportsRoute.request("/", post({ periodType: "week", periodsAgo: 1 }));
      expect(agoRes.status).toBe(201);
      const ago = (await agoRes.json()).report;
      expect(ago.periodEnd).toBe(now.periodStart);
      expect(ago.periodEnd - ago.periodStart).toBe(now.periodEnd - now.periodStart);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("PATCH /api/reports/:id", () => {
  it("noteが無ければ400", async () => {
    const { reportsRoute } = await import("./reports");
    const res = await reportsRoute.request("/missing", patch({}));
    expect(res.status).toBe(400);
  });

  it("存在しないIDは404", async () => {
    const { reportsRoute } = await import("./reports");
    const res = await reportsRoute.request("/missing", patch({ note: "所感" }));
    expect(res.status).toBe(404);
  });

  it("noteを更新できる（実名復元済みで返す）", async () => {
    const peopleDirectory = await import("@emther/core/people-directory");
    const reportStore = await import("@emther/core/report-store");
    peopleDirectory.registerName("Aさん");
    const report = reportStore.generateReport("week");
    const { reportsRoute } = await import("./reports");
    const res = await reportsRoute.request(`/${report.id}`, patch({ note: "Aさんとの1on1で確認" }));
    expect(res.status).toBe(200);
    expect((await res.json()).report.note).toBe("Aさんとの1on1で確認");
  });
});

describe("POST /api/reports/review", () => {
  it("periodTypeが不正なら400", async () => {
    const { reportsRoute } = await import("./reports");
    const res = await reportsRoute.request("/review", post({ periodType: "year" }));
    expect(res.status).toBe(400);
  });

  it("暦週の統計スナップショットとLead Agent runを起動し、201で返す", async () => {
    vi.useFakeTimers();
    try {
      // 2026-03-10は火曜。暦週境界（月曜始まり）の確認も兼ねる。
      vi.setSystemTime(new Date("2026-03-10T00:00:00.000Z").getTime());
      const { reportsRoute } = await import("./reports");
      const res = await reportsRoute.request("/review", post({ periodType: "week" }));
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.report.periodType).toBe("week");
      expect(new Date(json.report.periodStart).getDay()).toBe(1); // 月曜始まり
      expect(json.run.agentName).toBe("Lead Agent");
      expect(json.run.origin).toBe("auto-weekly-report");
      expect(json.run.reviewed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("periodType=monthならorigin=auto-monthly-reportで起動する", async () => {
    const { reportsRoute } = await import("./reports");
    const res = await reportsRoute.request("/review", post({ periodType: "month" }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.report.periodType).toBe("month");
    expect(json.run.origin).toBe("auto-monthly-report");
  });
});
