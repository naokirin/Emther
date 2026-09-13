// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useIssueImpact, useIssues, usePeekParam } from "./hooks";

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
