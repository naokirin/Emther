// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useJournalEditing } from "./useJournalEditing";
import type { JournalEntry } from "@core/types";

function baseEntry(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id: "entry-1",
    rawText: "元のテキスト",
    tags: ["1on1", "技術的負債"],
    people: ["Aさん"],
    teamIds: [],
    urgency: "mid",
    sentiment: "neutral",
    summary: "",
    createdAt: new Date(2026, 0, 15, 12, 0, 0, 0).getTime(),
    confirmed: false,
    ...overrides,
  };
}

// 実際のページ（Dashboard/Journal一覧）と同じく、journalEntriesをuseStateで持つ
// 呼び出し側を模したハーネス。useJournalEditingはsetJournalEntriesを通じてしか
// 配列を更新しないため、これがないと更新の反映を検証できない。
function useHarness(initial: JournalEntry[]) {
  const [entries, setEntries] = useState(initial);
  const editing = useJournalEditing(entries, setEntries);
  return { entries, ...editing };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("useJournalEditing", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("startEditingはentryの内容をフォームへ展開する", () => {
    const entry = baseEntry({ resolutionNote: "既存のメモ" });
    const { result } = renderHook(() => useHarness([entry]));
    act(() => result.current.startEditing(entry));
    expect(result.current.editingEntryId).toBe(entry.id);
    expect(result.current.editRawText).toBe("元のテキスト");
    expect(result.current.editTags).toBe("1on1, 技術的負債");
    expect(result.current.editPeople).toBe("Aさん");
    expect(result.current.editTeams).toBe("");
    expect(result.current.editDate).toBe("2026-01-15");
    expect(result.current.resolutionNoteDraft).toBe("既存のメモ");
  });

  it("cancelEditingは編集を終了する", () => {
    const entry = baseEntry();
    const { result } = renderHook(() => useHarness([entry]));
    act(() => result.current.startEditing(entry));
    act(() => result.current.cancelEditing());
    expect(result.current.editingEntryId).toBeNull();
  });

  it("confirmEditはフォームを即座に閉じ、tags/peopleをtrim・空要素除去したPATCHを送る", async () => {
    const entry = baseEntry();
    const updatedEntry = { ...entry, tags: ["確認済み"] };
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ entry: updatedEntry }) });
    const { result } = renderHook(() => useHarness([entry]));

    act(() => result.current.startEditing(entry));
    act(() => result.current.setEditTags(" 確認済み ,  "));
    act(() => result.current.confirmEdit(entry.id));

    // フォームは非同期のfetch完了を待たず即座に閉じる（非ブロッキング）。
    expect(result.current.editingEntryId).toBeNull();

    await waitFor(() => expect(result.current.entries[0].tags).toEqual(["確認済み"]));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/journal/${entry.id}`);
    const body = JSON.parse(init.body);
    expect(body.tags).toEqual(["確認済み"]);
    expect(body.rawText).toBeUndefined(); // 本文を触っていないので含めない
  });

  it("confirmAsIsは編集を開かず現在値のままPATCHする", async () => {
    const entry = baseEntry({ confirmed: false, tags: ["1on1"], people: ["Aさん"], urgency: "high" });
    const updated = { ...entry, id: "entry-confirmed", confirmed: true };
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ entry: updated }) });
    const { result } = renderHook(() => useHarness([entry]));

    act(() => result.current.confirmAsIs(entry));
    expect(result.current.editingEntryId).toBeNull();
    await waitFor(() => expect(result.current.entries[0].id).toBe("entry-confirmed"));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/journal/${entry.id}`);
    expect(JSON.parse(init.body)).toMatchObject({
      tags: ["1on1"],
      people: ["Aさん"],
      teamIds: [],
      urgency: "high",
      occurredAtDate: "2026-01-15",
    });
  });

  it("startAnalysisはanalyze APIを呼び、runIdを返す", async () => {
    const entry = baseEntry({ confirmed: true });
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ entry: { ...entry, sourceConsultRunId: "run-9" }, run: { id: "run-9" } }),
    });
    const { result } = renderHook(() => useHarness([entry]));
    let runId: string | undefined;
    await act(async () => {
      runId = await result.current.startAnalysis(entry);
    });
    expect(runId).toBe("run-9");
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/journal/${entry.id}/analyze`);
    expect(result.current.entries[0].sourceConsultRunId).toBe("run-9");
  });

  it("rawTextを触った場合だけPATCHのbodyにrawTextを含める", async () => {
    const entry = baseEntry();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ entry }) });
    const { result } = renderHook(() => useHarness([entry]));
    act(() => result.current.startEditing(entry));
    act(() => result.current.setEditRawText("訂正後の本文"));
    act(() => result.current.confirmEdit(entry.id));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.rawText).toBe("訂正後の本文");
  });

  it("confirmEdit中はisEntryPendingがtrueになり、完了後falseに戻る", async () => {
    const entry = baseEntry();
    const { promise, resolve } = deferred<{ ok: boolean; json: () => Promise<unknown> }>();
    fetchMock.mockReturnValue(promise);
    const { result } = renderHook(() => useHarness([entry]));

    act(() => result.current.startEditing(entry));
    act(() => result.current.confirmEdit(entry.id));
    expect(result.current.isEntryPending(entry.id)).toBe(true);

    await act(async () => {
      resolve({ ok: true, json: async () => ({ entry }) });
      await promise;
    });
    await waitFor(() => expect(result.current.isEntryPending(entry.id)).toBe(false));
  });

  it("PATCH失敗時はpendingEntryErrorsに記録し、retryで再送できる", async () => {
    const entry = baseEntry();
    fetchMock
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: "サーバーエラー" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ entry: { ...entry, tags: ["再送成功"] } }) });
    const { result } = renderHook(() => useHarness([entry]));

    act(() => result.current.startEditing(entry));
    act(() => result.current.confirmEdit(entry.id));
    await waitFor(() => expect(result.current.pendingEntryErrors[entry.id]?.message).toBe("サーバーエラー"));

    act(() => result.current.pendingEntryErrors[entry.id].retry());
    await waitFor(() => expect(result.current.entries[0].tags).toEqual(["再送成功"]));
    expect(result.current.pendingEntryErrors[entry.id]).toBeUndefined();
  });

  it("dismissPendingErrorはそのエントリのエラーだけを消す", async () => {
    const entry = baseEntry();
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: "失敗" }) });
    const { result } = renderHook(() => useHarness([entry]));
    act(() => result.current.startEditing(entry));
    act(() => result.current.confirmEdit(entry.id));
    await waitFor(() => expect(result.current.pendingEntryErrors[entry.id]).toBeDefined());
    act(() => result.current.dismissPendingError(entry.id));
    expect(result.current.pendingEntryErrors[entry.id]).toBeUndefined();
  });

  it("resolveWithNoteは空文字なら送信せずeditErrorを出す", () => {
    const entry = baseEntry();
    const { result } = renderHook(() => useHarness([entry]));
    act(() => result.current.startEditing(entry));
    act(() => result.current.resolveWithNote(entry.id));
    expect(result.current.editError).toBe("解決メモを入力してください");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolveWithNoteはresolutionNoteを含めて送信しフォームを閉じる", async () => {
    const entry = baseEntry();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ entry: { ...entry, resolutionNote: "対応済み" } }) });
    const { result } = renderHook(() => useHarness([entry]));
    act(() => result.current.startEditing(entry));
    act(() => result.current.setResolutionNoteDraft("対応済み"));
    act(() => result.current.resolveWithNote(entry.id));
    expect(result.current.editingEntryId).toBeNull();
    await waitFor(() => expect(result.current.entries[0].resolutionNote).toBe("対応済み"));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.resolutionNote).toBe("対応済み");
  });

  it("resolveWithNewIssueは提案作成→紐付けの2段階を行い、成功時はSuggestion IDを返してフォームを閉じる", async () => {
    const entry = baseEntry();
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/suggestions") return { ok: true, json: async () => ({ suggestion: { id: "new-issue-1" } }) };
      return { ok: true, json: async () => ({ entry: { ...entry, resolvedIssueId: "new-issue-1" } }) };
    });
    const { result } = renderHook(() => useHarness([entry]));
    act(() => result.current.startEditing(entry));

    let issueId: string | undefined;
    await act(async () => {
      issueId = await result.current.resolveWithNewIssue(entry);
    });

    expect(issueId).toBe("new-issue-1");
    expect(result.current.editingEntryId).toBeNull();
    expect(result.current.entries[0].resolvedIssueId).toBe("new-issue-1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe(`/api/journal/${entry.id}`);
    const issueBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(issueBody.sourceJournalId).toBe(entry.id);
  });

  it("resolveWithNewIssueは提案作成自体が失敗すればeditErrorを出し紐付けは試みない", async () => {
    const entry = baseEntry();
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: "提案の作成に失敗しました" }) });
    const { result } = renderHook(() => useHarness([entry]));
    act(() => result.current.startEditing(entry));

    let issueId: string | undefined;
    await act(async () => {
      issueId = await result.current.resolveWithNewIssue(entry);
    });
    expect(issueId).toBeUndefined();
    expect(result.current.editError).toBe("提案の作成に失敗しました");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("clearResolutionは解除PATCHを送りentriesを更新する", async () => {
    const entry = baseEntry({ resolvedIssueId: "issue-1" });
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ entry: { ...entry, resolvedIssueId: undefined } }) });
    const { result } = renderHook(() => useHarness([entry]));
    act(() => result.current.startEditing(entry));

    await act(async () => {
      await result.current.clearResolution(entry.id);
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.resolvedIssueId).toBeNull();
    expect(body.resolutionNote).toBeNull();
    expect(result.current.entries[0].resolvedIssueId).toBeUndefined();
  });
});
