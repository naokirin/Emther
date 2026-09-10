// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useIssueImpact, useIssues, useJournalEditing, usePeekParam } from "./hooks";
import type { JournalEntry } from "@/lib/types";

const pushMock = vi.fn();
let mockPathname = "/issues";
let mockSearchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => mockPathname,
  useSearchParams: () => mockSearchParams,
}));

describe("usePolling（useIssuesを代表として検証）", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => ({ json: async () => ({ issues: [{ id: "1" }] }) }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("マウント時に即座にfetchし、結果をstateへ反映する", async () => {
    const { result } = renderHook(() => useIssues(100_000));
    expect(result.current.issuesLoaded).toBe(false);
    await waitFor(() => expect(result.current.issues).toEqual([{ id: "1" }]));
    expect(result.current.issuesLoaded).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("/api/issues");
  });

  it("intervalMsごとに再取得する", async () => {
    renderHook(() => useIssues(50));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(1));
    const callsSoFar = fetchMock.mock.calls.length;
    // 短いintervalでの厳密な回数一致はタイミング依存で不安定なため、
    // 「初回より増え続けている」ことだけを確認する。
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(callsSoFar), { timeout: 2000 });
  });

  it("refreshIssuesは即座に再取得しstateへ反映する", async () => {
    const { result } = renderHook(() => useIssues(100_000));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fetchMock.mockResolvedValueOnce({ json: async () => ({ issues: [{ id: "manual" }] }) });
    await act(async () => {
      await result.current.refreshIssues();
    });
    expect(result.current.issues).toEqual([{ id: "manual" }]);
  });

  it("fetch失敗時は静かに無視し既存stateを保持する", async () => {
    fetchMock.mockRejectedValue(new Error("network error"));
    const { result } = renderHook(() => useIssues(100_000));
    await new Promise((r) => setTimeout(r, 30));
    expect(result.current.issues).toEqual([]);
  });
});

describe("usePolling: enabled=false", () => {
  it("fetchを一切行わない（useIssueImpactのenabledフラグ）", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderHook(() => useIssueImpact("issue-1", false, 10));
    await new Promise((r) => setTimeout(r, 30));
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

function baseEntry(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id: "entry-1",
    rawText: "元のテキスト",
    tags: ["1on1", "技術的負債"],
    people: ["Aさん"],
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

  it("resolveWithNewIssueはIssue作成→紐付けの2段階を行い、成功時はIssue IDを返してフォームを閉じる", async () => {
    const entry = baseEntry();
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/issues") return { ok: true, json: async () => ({ issue: { id: "new-issue-1" } }) };
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

  it("resolveWithNewIssueはIssue作成自体が失敗すればeditErrorを出し紐付けは試みない", async () => {
    const entry = baseEntry();
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: "Issue作成失敗" }) });
    const { result } = renderHook(() => useHarness([entry]));
    act(() => result.current.startEditing(entry));

    let issueId: string | undefined;
    await act(async () => {
      issueId = await result.current.resolveWithNewIssue(entry);
    });
    expect(issueId).toBeUndefined();
    expect(result.current.editError).toBe("Issue作成失敗");
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

describe("usePeekParam", () => {
  beforeEach(() => {
    pushMock.mockClear();
    mockPathname = "/issues";
    mockSearchParams = new URLSearchParams();
  });

  it("クエリパラメータが無ければidはnull", () => {
    const { result } = renderHook(() => usePeekParam("issue"));
    expect(result.current.id).toBeNull();
  });

  it("openはキーへidを付けてpushする", () => {
    const { result } = renderHook(() => usePeekParam("issue"));
    act(() => result.current.open("issue-1"));
    expect(pushMock).toHaveBeenCalledWith("/issues?issue=issue-1", { scroll: false });
  });

  it("既存のクエリパラメータ（他のキー）は保ったままopenする", () => {
    mockSearchParams = new URLSearchParams("tag=bug");
    const { result } = renderHook(() => usePeekParam("issue"));
    act(() => result.current.open("issue-1"));
    expect(pushMock).toHaveBeenCalledWith("/issues?tag=bug&issue=issue-1", { scroll: false });
  });

  it("既にクエリパラメータが有ればidを読み取る", () => {
    mockSearchParams = new URLSearchParams("issue=issue-1");
    const { result } = renderHook(() => usePeekParam("issue"));
    expect(result.current.id).toBe("issue-1");
  });

  it("closeはキーを外してpushする（他のキーは残す）", () => {
    mockSearchParams = new URLSearchParams("issue=issue-1&tag=bug");
    const { result } = renderHook(() => usePeekParam("issue"));
    act(() => result.current.close());
    expect(pushMock).toHaveBeenCalledWith("/issues?tag=bug", { scroll: false });
  });

  it("closeで他のクエリパラメータが無くなる場合は素のpathnameへpushする", () => {
    mockSearchParams = new URLSearchParams("issue=issue-1");
    const { result } = renderHook(() => usePeekParam("issue"));
    act(() => result.current.close());
    expect(pushMock).toHaveBeenCalledWith("/issues", { scroll: false });
  });
});
