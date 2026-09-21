import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { GrowthPage } from "./GrowthPage";

// web/src/app/growth/page.tsx（Next.js版）には専用テストが元々無かったため新規に追加する
// （フェーズ3.5 tier3、最終バッチ）。ReflectionNoteForm/GrowSuggestionsPanel
// 自体の詳細ロジックは個別テストで検証済みのため、ここでは「現在の改善方針」の
// 完了/アーカイブフローに絞って検証する。
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

const TRY_NOTE = {
  id: "n1",
  type: "try" as const,
  text: "1on1の頻度を週次に増やす",
  createdAt: Date.now(),
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GrowthPage", () => {
  it("現在の改善方針（Tryメモ）を表示し、完了/アーカイブするとPATCHして一覧から外れる", async () => {
    let notes = [TRY_NOTE];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/em-self/reflection-notes/n1" && init?.method === "PATCH") {
        const archived = { ...TRY_NOTE, archivedAt: Date.now() };
        notes = [archived];
        return { ok: true, json: async () => ({ note: archived }) };
      }
      if (url === "/api/em-self/reflection-notes") return { ok: true, json: async () => ({ notes }) };
      if (url === "/api/growth/suggestions") return { ok: true, json: async () => ({ suggestions: [] }) };
      if (url === "/api/agents") return { ok: true, json: async () => ({ runs: [], pendingAgentStarts: [], pendingUnmaskedSends: [] }) };
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<GrowthPage />, { wrapper: createWrapper() });

    // 同じメモ本文が「週次のKPT」表にも出るため（別セクション）、「現在の改善方針」
    // パネル固有の文言で一意に特定する。
    await screen.findByText(/のTryメモより/);
    await user.click(screen.getByRole("button", { name: "完了 / アーカイブする" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/em-self/reflection-notes/n1",
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ archived: true }) }),
      ),
    );
    expect(await screen.findByText(/いまフォーカス中の改善方針はありません/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /完了 \/ アーカイブ済みを見る/ })).toBeInTheDocument();
  });
});
