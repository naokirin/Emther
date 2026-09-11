import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@/lib/test-helpers/store-env";

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

describe("resolveIdPrefix", () => {
  it("一意な Issue プレフィックスを解決する", async () => {
    const issueStore = await import("@/lib/issue-store");
    const { resolveIdPrefix } = await import("./id-resolve");
    const issue = await issueStore.createIssue("プレフィックス解決");
    const prefix = issue.id.slice(0, 8);
    const matches = resolveIdPrefix(prefix);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ kind: "issue", id: issue.id, href: `/issues/${issue.id}` });
  });

  it("複数ヒット時は候補をすべて返す", async () => {
    const issueStore = await import("@/lib/issue-store");
    const { resolveIdPrefix, resolveUniqueByPrefix } = await import("./id-resolve");

    // 衝突を強制するため、内部配列へ同じ先頭の ID を持つ Issue を直接載せるのは難しいので
    // resolveUniqueByPrefix をユニットで検証する。
    const items = [
      { id: "aaaaaaaa-1111-4111-8111-111111111111", title: "A" },
      { id: "aaaaaaaa-2222-4222-8222-222222222222", title: "B" },
    ];
    const resolved = resolveUniqueByPrefix(items, (i) => i.id, "aaaaaaaa");
    expect(resolved.status).toBe("ambiguous");
    if (resolved.status === "ambiguous") {
      expect(resolved.items).toHaveLength(2);
    }

    const issue = await issueStore.createIssue("単独");
    const alone = resolveIdPrefix(issue.id.slice(0, 8));
    expect(alone).toHaveLength(1);
  });

  it("Journal も解決対象に含める", async () => {
    const journalStore = await import("@/lib/journal-store");
    const { resolveIdPrefix } = await import("./id-resolve");
    const entry = await journalStore.addJournalEntry("現場メモ");
    const matches = resolveIdPrefix(entry.id.slice(0, 8));
    expect(matches.some((m) => m.kind === "journal" && m.id === entry.id)).toBe(true);
    expect(matches.find((m) => m.id === entry.id)?.href).toContain(`/journal?focus=${encodeURIComponent(entry.id)}`);
  });
});
