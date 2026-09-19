import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "./test-helpers/store-env";

vi.mock("./local-model", () => ({
  runLocalChat: vi.fn(async () => JSON.stringify({ people: [] })),
  extractFirstJsonObject: (text: string) => text,
}));
vi.mock("./embeddings", () => ({
  embedText: vi.fn(async () => [1, 0, 0]),
  cosineSimilarity: () => 0,
}));

// docs/memo.md「テキストから検出されたメンバー名を確実に『人物』にすべて登録する」対応で
// createJournalEventFromTextがdetectUnregisteredNameCandidatesを呼ぶようになったため、
// 実際の辞書・形態素解析（重い・並列実行時にタイムアウトしやすい）を避けてモックする。
vi.mock("./name-candidate-detect", () => ({
  detectNameCandidatesAsync: async () => [] as string[],
  detectNameCandidates: () => [] as string[],
  registerNameCandidateFilters: () => {},
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
    const issueStore = await import("./issue-store");
    const { resolveIdPrefix } = await import("./id-resolve");
    const issue = await issueStore.createIssue("プレフィックス解決");
    const prefix = issue.id.slice(0, 8);
    const matches = resolveIdPrefix(prefix);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ kind: "issue", id: issue.id, href: `/suggestions/${issue.id}` });
  });

  it("複数ヒット時は候補をすべて返す", async () => {
    const issueStore = await import("./issue-store");
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
    const journalStore = await import("./journal-store");
    const { resolveIdPrefix } = await import("./id-resolve");
    const entry = await journalStore.addJournalEntry("現場メモ");
    const matches = resolveIdPrefix(entry.id.slice(0, 8));
    expect(matches.some((m) => m.kind === "journal" && m.id === entry.id)).toBe(true);
    expect(matches.find((m) => m.id === entry.id)?.href).toContain(`/journal?focus=${encodeURIComponent(entry.id)}`);
  });

  // ユーザー指摘「ツールチップ内のメンバー名が{{PERSON_11}}のようなままになっている」対応。
  it("Issue のタイトルに含まれる登録済み人名は{{PERSON_n}}のままにせず実名で返す", async () => {
    const peopleDirectory = await import("./people-directory");
    peopleDirectory.registerName("Aさん");
    const issueStore = await import("./issue-store");
    const { resolveIdPrefix } = await import("./id-resolve");
    const issue = await issueStore.createIssue("Aさんの1on1で出た懸念");
    const matches = resolveIdPrefix(issue.id.slice(0, 8));
    const match = matches.find((m) => m.id === issue.id);
    expect(match?.label).toBe("Aさんの1on1で出た懸念");
    expect(match?.label).not.toContain("PERSON_");
  });

  it("Journal の本文に含まれる登録済み人名は{{PERSON_n}}のままにせず実名で返す", async () => {
    const peopleDirectory = await import("./people-directory");
    peopleDirectory.registerName("Bさん");
    const journalStore = await import("./journal-store");
    const { resolveIdPrefix } = await import("./id-resolve");
    const entry = await journalStore.addJournalEntry("Bさんと話した現場メモ");
    const matches = resolveIdPrefix(entry.id.slice(0, 8));
    const match = matches.find((m) => m.id === entry.id && m.kind === "journal");
    expect(match?.label).toContain("Bさん");
    expect(match?.label).not.toContain("PERSON_");
  });
});
