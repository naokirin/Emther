// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, renderHook, screen, act } from "@testing-library/react";
import { PaginationControls, usePagination } from "./Pagination";

describe("usePagination", () => {
  it("ページサイズごとに分割する", () => {
    const { result } = renderHook(() => usePagination([1, 2, 3, 4, 5], 2));
    expect(result.current.pageItems).toEqual([1, 2]);
    expect(result.current.totalPages).toBe(3);
    expect(result.current.rangeStart).toBe(1);
    expect(result.current.rangeEnd).toBe(2);
  });

  it("setPageでページを進められる", () => {
    const { result } = renderHook(() => usePagination([1, 2, 3, 4, 5], 2));
    act(() => result.current.setPage(2));
    expect(result.current.pageItems).toEqual([3, 4]);
    expect(result.current.rangeStart).toBe(3);
    expect(result.current.rangeEnd).toBe(4);
  });

  it("件数が0件ならrangeStartは0、totalPagesは最低1", () => {
    const { result } = renderHook(() => usePagination([] as number[], 10));
    expect(result.current.totalPages).toBe(1);
    expect(result.current.rangeStart).toBe(0);
    expect(result.current.rangeEnd).toBe(0);
  });

  it("フィルタで件数が減りpageが範囲外になった場合、表示側は最終ページへ自動的に丸める", () => {
    const { result, rerender } = renderHook(({ items }) => usePagination(items, 2), {
      initialProps: { items: [1, 2, 3, 4, 5] },
    });
    act(() => result.current.setPage(3)); // 5件・2件ずつ→3ページ目（5件目のみ）
    rerender({ items: [1, 2] }); // フィルタで2件に減る→1ページのみ
    expect(result.current.page).toBe(1);
    expect(result.current.pageItems).toEqual([1, 2]);
  });
});

describe("PaginationControls", () => {
  it("totalPagesが1以下なら何も描画しない", () => {
    const { container } = render(
      <PaginationControls page={1} totalPages={1} total={1} rangeStart={1} rangeEnd={1} onChange={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("件数・ページ位置を表示し、端では該当ボタンをdisabledにする", () => {
    render(<PaginationControls page={1} totalPages={3} total={25} rangeStart={1} rangeEnd={10} onChange={vi.fn()} />);
    expect(screen.getByText(/1–10 \/ 25件（1 \/ 3ページ）/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "← 前へ" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "次へ →" })).not.toBeDisabled();
  });

  it("次へ／前へクリックでonChangeが呼ばれる", async () => {
    const onChange = vi.fn();
    render(<PaginationControls page={2} totalPages={3} total={25} rangeStart={11} rangeEnd={20} onChange={onChange} />);
    screen.getByRole("button", { name: "次へ →" }).click();
    expect(onChange).toHaveBeenCalledWith(3);
    screen.getByRole("button", { name: "← 前へ" }).click();
    expect(onChange).toHaveBeenCalledWith(1);
  });
});
