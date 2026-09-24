import { describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { act } from "react";
import { MemoryRouter } from "@/router";
import type { ReactNode } from "react";
import { z } from "zod";
import { useTypedSearchParams } from "./useTypedSearchParams";

const schema = z.object({
  issue: z.string().optional(),
  urgency: z.enum(["low", "high"]).optional().catch(undefined),
});

function wrapperWith(initialEntries: string[]) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>;
  };
}

describe("useTypedSearchParams", () => {
  it("クエリが無ければ全フィールドundefined", async () => {
    const { result } = renderHook(() => useTypedSearchParams(schema), { wrapper: wrapperWith(["/"]) });
    await waitFor(() => expect(result.current).not.toBeNull());
    const [values] = result.current;
    expect(values).toEqual({ issue: undefined, urgency: undefined });
  });

  it("存在するクエリを型どおりにパースする", async () => {
    const { result } = renderHook(() => useTypedSearchParams(schema), {
      wrapper: wrapperWith(["/?issue=abc&urgency=high"]),
    });
    await waitFor(() => expect(result.current).not.toBeNull());
    const [values] = result.current;
    expect(values).toEqual({ issue: "abc", urgency: "high" });
  });

  it("enumに一致しない値は.catch(undefined)で無視される（不正値は黙って未指定扱い）", async () => {
    const { result } = renderHook(() => useTypedSearchParams(schema), {
      wrapper: wrapperWith(["/?urgency=invalid"]),
    });
    await waitFor(() => expect(result.current).not.toBeNull());
    const [values] = result.current;
    expect(values.urgency).toBeUndefined();
  });

  it("setParamsでクエリを更新できる（usePeekParamのopen()相当）", async () => {
    const { result } = renderHook(() => useTypedSearchParams(schema), { wrapper: wrapperWith(["/"]) });
    await waitFor(() => expect(result.current).not.toBeNull());
    act(() => {
      result.current[1]({ issue: "xyz" });
    });
    await waitFor(() => expect(result.current[0].issue).toBe("xyz"));
  });

  it("setParamsにundefinedを渡すとクエリを削除できる（usePeekParamのclose()相当）", async () => {
    const { result } = renderHook(() => useTypedSearchParams(schema), {
      wrapper: wrapperWith(["/?issue=xyz"]),
    });
    await waitFor(() => expect(result.current[0]?.issue).toBe("xyz"));
    act(() => {
      result.current[1]({ issue: undefined });
    });
    await waitFor(() => expect(result.current[0].issue).toBeUndefined());
  });

  it("既存の他クエリは保持したまま更新する", async () => {
    const { result } = renderHook(() => useTypedSearchParams(schema), {
      wrapper: wrapperWith(["/?issue=xyz"]),
    });
    await waitFor(() => expect(result.current).not.toBeNull());
    act(() => {
      result.current[1]({ urgency: "low" });
    });
    await waitFor(() => expect(result.current[0]).toEqual({ issue: "xyz", urgency: "low" }));
  });
});
