import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { OrgThreadPage } from "./OrgThreadPage";

// web/src/app/org/thread/page.tsx（Next.js版）には専用テストが元々無かったため
// 新規に追加する（フェーズ3.5 tier3）。StrategyThreadTree自体の詳細ロジックは
// 個別テストで検証済みのため、ここではデータの受け渡しだけを確認する。
function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  };
}

describe("OrgThreadPage", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/org/objectives") return { ok: true, json: async () => ({ objectives: [] }) };
        if (url === "/api/issues") return { ok: true, json: async () => ({ issues: [] }) };
        if (url === "/api/journal") return { ok: true, json: async () => ({ entries: [] }) };
        return { ok: true, json: async () => ({}) };
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("Objectiveが無ければ空状態メッセージを表示する", async () => {
    render(<OrgThreadPage />, { wrapper: createWrapper() });
    expect(screen.getByRole("heading", { name: "つながりを見る" })).toBeInTheDocument();
    expect(await screen.findByText(/Objectiveがまだ登録されていません/)).toBeInTheDocument();
  });
});
