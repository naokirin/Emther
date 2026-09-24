import { describe, expect, it } from "vitest";
import { render, screen, renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter, useSearchParams } from "react-router";
import type { ReactNode } from "react";

describe("MemoryRouter smoke", () => {
  it("renders children", async () => {
    render(
      <MemoryRouter>
        <div>hello-memory</div>
      </MemoryRouter>,
    );
    expect(await screen.findByText("hello-memory")).toBeInTheDocument();
  });

  it("useSearchParams in renderHook", async () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <MemoryRouter initialEntries={["/?a=1"]}>{children}</MemoryRouter>
    );
    const { result } = renderHook(() => useSearchParams(), { wrapper });
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current![0].get("a")).toBe("1");
  });
});
