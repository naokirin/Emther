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
      const peek = usePeekParam("suggestion");
      const [searchParams] = useSearchParams();
      return { peek, search: searchParams.toString() };
    },
    { wrapper: wrapperWith(initialEntries) },
  );
}

describe("usePeekParam", () => {
  it("クエリパラメータが無ければidはnull", () => {
    const { result } = renderWithLocation(["/suggestions"]);
    expect(result.current.peek.id).toBeNull();
  });

  it("openはキーへidを設定する", async () => {
    const { result } = renderWithLocation(["/suggestions"]);
    act(() => result.current.peek.open("suggestion-1"));
    await waitFor(() => expect(result.current.search).toBe("suggestion=suggestion-1"));
  });

  it("既存のクエリパラメータ（他のキー）は保ったままopenする", async () => {
    const { result } = renderWithLocation(["/suggestions?tag=bug"]);
    act(() => result.current.peek.open("suggestion-1"));
    await waitFor(() => expect(result.current.search).toBe("tag=bug&suggestion=suggestion-1"));
  });

  it("既にクエリパラメータが有ればidを読み取る", () => {
    const { result } = renderWithLocation(["/suggestions?suggestion=suggestion-1"]);
    expect(result.current.peek.id).toBe("suggestion-1");
  });

  it("closeはキーを外す（他のキーは残す）", async () => {
    const { result } = renderWithLocation(["/suggestions?suggestion=suggestion-1&tag=bug"]);
    act(() => result.current.peek.close());
    await waitFor(() => expect(result.current.search).toBe("tag=bug"));
  });
});
