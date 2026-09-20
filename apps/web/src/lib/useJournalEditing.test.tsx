import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useJournalEditing } from "./useJournalEditing";
import type { JournalEntry } from "@emther/core/types";

// web/src/lib/useJournalEditing.ts（Next.js版）には専用テストが元々無かったため
// 新規に追加する（フェーズ3.5 tier4 journalバッチ）。Next非依存のフレームワーク非依存
// フックとしてそのまま移設したロジックの主要フローを検証する。
function baseEntry(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id: "e1",
    rawText: "Aさんと1on1した",
    tags: ["1on1"],
    people: ["Aさん"],
    teamIds: [],
    urgency: "mid",
    sentiment: "neutral",
    summary: "",
    createdAt: Date.now(),
    confirmed: true,
    ...overrides,
  } as JournalEntry;
}

function setup(entries: JournalEntry[]) {
  let current = entries;
  const setEntries = vi.fn((next: JournalEntry[] | ((prev: JournalEntry[]) => JournalEntry[])) => {
    current = typeof next === "function" ? next(current) : next;
  });
  const { result, rerender } = renderHook(() => useJournalEditing(current, setEntries));
  return { result, rerender, setEntries, getEntries: () => current };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useJournalEditing", () => {
  it("startEditingでフィールドをエントリの内容に初期化する", () => {
    const { result } = setup([baseEntry()]);
    act(() => result.current.startEditing(baseEntry()));
    expect(result.current.editingEntryId).toBe("e1");
    expect(result.current.editTags).toBe("1on1");
    expect(result.current.editPeople).toBe("Aさん");
  });

  it("confirmEditはPATCHしてエントリを差し替える", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ entry: baseEntry({ id: "e1-v2", tags: ["1on1", "追加"] }) }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result, getEntries } = setup([baseEntry()]);
    act(() => result.current.startEditing(baseEntry()));
    act(() => result.current.confirmEdit("e1"));

    expect(result.current.editingEntryId).toBeNull();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/journal/e1", expect.objectContaining({ method: "PATCH" })));
    await waitFor(() => expect(getEntries().find((e) => e.id === "e1-v2")).toBeTruthy());
  });

  it("confirmAsIsは現在の内容のまま確定する", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ entry: baseEntry() }) });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = setup([baseEntry()]);
    act(() => result.current.confirmAsIs(baseEntry()));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/journal/e1");
    expect(init.method).toBe("PATCH");
    const body = JSON.parse(String(init.body));
    expect(body).toEqual(
      expect.objectContaining({ tags: ["1on1"], people: ["Aさん"], teamIds: [], urgency: "mid", occurredAtDate: expect.any(String) }),
    );
  });

  it("resolveWithNoteはメモが空だとeditErrorを設定しfetchしない", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { result } = setup([baseEntry()]);
    act(() => result.current.startEditing(baseEntry()));
    act(() => result.current.resolveWithNote("e1"));
    expect(result.current.editError).toBe("解決メモを入力してください");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolveWithNoteはメモがあればPATCHしresolutionNoteを含める", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ entry: baseEntry({ resolutionNote: "解消済み" }) }) });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = setup([baseEntry()]);
    act(() => result.current.startEditing(baseEntry()));
    act(() => result.current.setResolutionNoteDraft("解消済み"));
    act(() => result.current.resolveWithNote("e1"));

    await waitFor(() => {
      const call = fetchMock.mock.calls[0];
      expect(JSON.parse(String(call[1]?.body))).toEqual(expect.objectContaining({ resolutionNote: "解消済み" }));
    });
  });

  it("resolveWithNewIssueは提案を作成してからJournalへ紐付ける", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/suggestions") {
        return { ok: true, json: async () => ({ suggestion: { id: "sug-1" } }) };
      }
      if (url === "/api/journal/e1") {
        return { ok: true, json: async () => ({ entry: baseEntry({ resolvedIssueId: "sug-1" }) }) };
      }
      throw new Error(`unexpected: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = setup([baseEntry()]);
    let suggestionId: string | undefined;
    await act(async () => {
      suggestionId = await result.current.resolveWithNewIssue(baseEntry());
    });
    expect(suggestionId).toBe("sug-1");
    expect(fetchMock).toHaveBeenCalledWith("/api/suggestions", expect.objectContaining({ method: "POST" }));
  });

  it("clearResolutionはresolvedIssueId/resolutionNoteをnullにしてPATCHする", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ entry: baseEntry() }) });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = setup([baseEntry()]);
    act(() => result.current.startEditing(baseEntry()));
    await act(async () => {
      await result.current.clearResolution("e1");
    });
    const call = fetchMock.mock.calls[0];
    expect(JSON.parse(String(call[1]?.body))).toEqual(expect.objectContaining({ resolvedIssueId: null, resolutionNote: null }));
  });

  it("archiveEntryはpending状態を経てエントリを差し替える", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ entry: baseEntry({ archivedAt: 123 }) }) });
    vi.stubGlobal("fetch", fetchMock);
    const { result, getEntries } = setup([baseEntry()]);
    await act(async () => {
      await result.current.archiveEntry("e1");
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/journal/e1/archive", { method: "POST" });
    expect(getEntries()[0].archivedAt).toBe(123);
  });

  it("失敗時はpendingEntryErrorsに再試行用のretryを記録する", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "アーカイブに失敗しました" }) }));
    const { result } = setup([baseEntry()]);
    await act(async () => {
      await result.current.archiveEntry("e1");
    });
    expect(result.current.pendingEntryErrors["e1"]?.message).toBe("アーカイブに失敗しました");

    result.current.dismissPendingError("e1");
  });
});
