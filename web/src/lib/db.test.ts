import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@/lib/test-helpers/store-env";

// db.tsはモジュールレベルでDatabaseSyncインスタンスをキャッシュするため、
// テストごとにvi.resetModules()して新しい一時ディレクトリのapp.dbへ接続し直す。
let dir: string;

beforeEach(() => {
  dir = setupIsolatedStoreEnv();
  vi.resetModules();
});

afterEach(() => {
  teardownIsolatedStoreEnv(dir);
});

describe("getDb", () => {
  it("必要なテーブルを作成する", async () => {
    const { getDb } = await import("@/lib/db");
    const db = getDb();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toEqual(expect.arrayContaining(["knowledge_events", "agent_runs", "agent_run_logs", "reports"]));
  });

  it("同じプロセス内で呼ぶたびに同じインスタンスを返す（都度接続し直さない）", async () => {
    const { getDb } = await import("@/lib/db");
    expect(getDb()).toBe(getDb());
  });

  it("2回目のgetDb()呼び出し（マイグレーション再実行）でも例外を投げない（冪等）", async () => {
    const { getDb } = await import("@/lib/db");
    getDb();
    vi.resetModules();
    process.env.EM_DATA_DIR = process.env.EM_DATA_DIR; // 同じディレクトリを維持
    const mod2 = await import("@/lib/db");
    expect(() => mod2.getDb()).not.toThrow();
  });

  it("knowledge_eventsに実際にレコードを挿入・取得できる", async () => {
    const { getDb } = await import("@/lib/db");
    const db = getDb();
    db.prepare(
      `INSERT INTO knowledge_events
        (id, kind, context, entity_type, people_json, text, tags_json, occurred_at, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("evt-1", "fact", "observation", "journal", "[]", "hello", "[]", 1000, 1000);
    const row = db.prepare("SELECT * FROM knowledge_events WHERE id = ?").get("evt-1") as { text: string };
    expect(row.text).toBe("hello");
  });

  it("closeDbのあとgetDbで新しい接続を開ける", async () => {
    const { getDb, closeDb } = await import("@/lib/db");
    getDb().prepare("SELECT 1 AS n").get();
    closeDb();
    const reopened = getDb();
    expect(reopened.prepare("SELECT 1 AS n").get()).toEqual({ n: 1 });
  });
});
