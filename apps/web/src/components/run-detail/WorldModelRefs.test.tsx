import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "@/router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { WorldModelRefs } from "./WorldModelRefs";

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe("WorldModelRefs", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ elements: [{ id: "e1", title: "レビュー待ち" }] }) })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("参照 ID を要素のタイトルで表示し、組織モデルへリンクする", async () => {
    render(<WorldModelRefs ids={["e1"]} />, { wrapper });
    const link = await screen.findByRole("link", { name: "レビュー待ち" });
    expect(link).toHaveAttribute("href", "/world-model");
  });
});
