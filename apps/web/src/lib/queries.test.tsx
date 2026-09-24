import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useTimeline } from "./queries";

function createWrapper() {
  // testInWindow相当のretry無効化。既定のリトライだと失敗系テストが長時間化するため。
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useTimeline（usePolledQueryの代表例として検証）", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ entries: [{ id: "1" }] }) }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("マウント時に即座にfetchし、結果を反映する", async () => {
    const { result } = renderHook(() => useTimeline(100_000), { wrapper: createWrapper() });
    expect(result.current.timelineLoaded).toBe(false);
    await waitFor(() => expect(result.current.entries).toEqual([{ id: "1" }]));
    expect(result.current.timelineLoaded).toBe(true);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/timeline");
  });

  it("intervalMsごとに再取得する（refetchInterval）", async () => {
    renderHook(() => useTimeline(50), { wrapper: createWrapper() });
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(1));
    const callsSoFar = fetchMock.mock.calls.length;
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(callsSoFar), { timeout: 2000 });
  });

  it("refreshTimelineは即座に再取得し反映する", async () => {
    const { result } = renderHook(() => useTimeline(100_000), { wrapper: createWrapper() });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ entries: [{ id: "manual" }] }) });
    // TanStack Queryの再レンダー通知はact()のマイクロタスクフラッシュと同期しないため、
    // act直後の同期読み取りではなくwaitForで反映を待つ（web/src/lib/hooks.test.tsxの
    // usePollingテストとは異なり、ここはReact標準のact挙動に頼れない）。
    await act(async () => {
      await result.current.refreshTimeline();
    });
    await waitFor(() => expect(result.current.entries).toEqual([{ id: "manual" }]));
  });

  it("HTTPエラー時はthrowし、TanStack Query側のerror状態になる（静かに無視しない。旧usePollingとの意図的な差分）", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const { result } = renderHook(() => useTimeline(100_000), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.timelineLoaded).toBe(true));
    expect(result.current.entries).toEqual([]);
  });
});
