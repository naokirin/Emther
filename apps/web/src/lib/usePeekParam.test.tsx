import { describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter, useSearchParams } from "react-router";
import type { ReactNode } from "react";
import { usePeekParam } from "./usePeekParam";

// web/src/lib/hooks.ts usePeekParam（Next.js版）のテストからの移植（フェーズ3.5 tier2
// timelineバッチ）。next/navigationのモックの代わりに実際のreact-router（MemoryRouter）で
// クエリパラメータの読み書きを検証する。
function wrapperWith(initialEntries: string[]) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>;
  };
}

function renderWithLocation(initialEntries: string[]) {
  return renderHook(
    () => {
      const peek = usePeekParam("issue");
      const [searchParams] = useSearchParams();
      return { peek, search: searchParams.toString() };
    },
    { wrapper: wrapperWith(initialEntries) },
  );
}

describe("usePeekParam", () => {
  it("クエリパラメータが無ければidはnull", () => {
    const { result } = renderWithLocation(["/issues"]);
    expect(result.current.peek.id).toBeNull();
  });

  it("openはキーへidを設定する", async () => {
    const { result } = renderWithLocation(["/issues"]);
    act(() => result.current.peek.open("issue-1"));
    await waitFor(() => expect(result.current.search).toBe("issue=issue-1"));
  });

  it("既存のクエリパラメータ（他のキー）は保ったままopenする", async () => {
    const { result } = renderWithLocation(["/issues?tag=bug"]);
    act(() => result.current.peek.open("issue-1"));
    await waitFor(() => expect(result.current.search).toBe("tag=bug&issue=issue-1"));
  });

  it("既にクエリパラメータが有ればidを読み取る", () => {
    const { result } = renderWithLocation(["/issues?issue=issue-1"]);
    expect(result.current.peek.id).toBe("issue-1");
  });

  it("closeはキーを外す（他のキーは残す）", async () => {
    const { result } = renderWithLocation(["/issues?issue=issue-1&tag=bug"]);
    act(() => result.current.peek.close());
    await waitFor(() => expect(result.current.search).toBe("tag=bug"));
  });
});
