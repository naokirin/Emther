import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@core/test-helpers/store-env";

let dir: string;

beforeEach(() => {
  dir = setupIsolatedStoreEnv();
  vi.resetModules();
});

afterEach(() => {
  teardownIsolatedStoreEnv(dir);
});

describe("journal-batch-window", () => {
  it("初回は直近24時間を対象にし、begin後は前回カバーより後だけを対象にする", async () => {
    const mod = await import("@/lib/agent-runtime/journal-batch-window");
    const now = Date.now();
    expect(mod.isJournalInBatchWindow(now - 12 * 60 * 60 * 1000, now)).toBe(true);
    expect(mod.isJournalInBatchWindow(now - 2 * 24 * 60 * 60 * 1000, now)).toBe(false);

    const window = mod.beginJournalBatchWindow(now);
    expect(window.sinceExclusive).toBeNull();
    expect(window.until).toBe(now);

    // アクティブ窓内: begin より前（フォールバック24h内）は含まれる
    expect(mod.isJournalInBatchWindow(now - 1000, now)).toBe(true);
    // begin より後は含まれない
    expect(mod.isJournalInBatchWindow(now + 1000, now + 2000)).toBe(false);

    // 2回目の begin では前回 until が sinceExclusive になる
    const later = now + 60_000;
    const window2 = mod.beginJournalBatchWindow(later);
    expect(window2.sinceExclusive).toBe(now);
    expect(mod.isJournalInBatchWindow(now - 1000, later)).toBe(false);
    expect(mod.isJournalInBatchWindow(now + 1000, later)).toBe(true);
    expect(mod.isJournalInBatchWindow(later + 1, later + 10)).toBe(false);
  });

  it("アクティブ窓は永続化され、モジュール再読込後も同じ範囲を返す", async () => {
    const mod1 = await import("@/lib/agent-runtime/journal-batch-window");
    const t0 = Date.now();
    mod1.beginJournalBatchWindow(t0);
    const mid = t0 - 1000;
    expect(mod1.isJournalInBatchWindow(mid, t0)).toBe(true);

    vi.resetModules();
    const mod2 = await import("@/lib/agent-runtime/journal-batch-window");
    expect(mod2.isJournalInBatchWindow(mid, t0)).toBe(true);
    expect(mod2.isJournalInBatchWindow(t0 + 1, t0 + 10)).toBe(false);
  });

  it("最大7日より古いJournalは除外する", async () => {
    const mod = await import("@/lib/agent-runtime/journal-batch-window");
    const now = Date.now();
    mod.beginJournalBatchWindow(now - 10 * 24 * 60 * 60 * 1000);
    const later = now;
    mod.beginJournalBatchWindow(later);
    expect(mod.isJournalInBatchWindow(now - 8 * 24 * 60 * 60 * 1000, later)).toBe(false);
    expect(mod.isJournalInBatchWindow(now - 2 * 24 * 60 * 60 * 1000, later)).toBe(true);
  });

  it("旧形式 { date } のみは全日クレームにせず legacyDateOnly で返す", async () => {
    const { saveJSON } = await import("@core/persistence");
    saveJSON("auto-journal-batch.json", { date: "2026-09-17" });
    const mod = await import("@/lib/agent-runtime/journal-batch-window");
    const state = mod.loadJournalBatchPersisted();
    expect(state.date).toBe("2026-09-17");
    expect(state.claimedHours).toEqual([]);
    expect(state.legacyDateOnly).toBe(true);
  });
});
