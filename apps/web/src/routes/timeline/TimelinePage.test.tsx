import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "@/router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { TimelinePage } from "./TimelinePage";

// useTimelineがTanStack Query化されているためQueryClientProviderで包む
function createWrapper(initialEntries: string[] = ["/timeline"]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  };
}

describe("TimelinePage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("履歴が無ければ空メッセージを表示する", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ entries: [] }) }));
    render(<TimelinePage />, { wrapper: createWrapper() });
    expect(await screen.findByText(/まだ変更履歴はありません/)).toBeInTheDocument();
  });

  it("日付ごとにグルーピングして表示し、提案エントリをクリックするとサイドピークが開く", async () => {
    const sameDay = new Date("2026-01-15T09:00:00+09:00").getTime();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          entries: [
            { id: "e1", entityType: "suggestion", entityId: "sug-1", entityLabel: "サンプル提案", text: "確認状態を変更", occurredAt: sameDay },
          ],
        }),
      }),
    );
    const user = userEvent.setup();
    render(<TimelinePage />, { wrapper: createWrapper() });

    const entryButton = await screen.findByRole("button", { name: "サンプル提案" });
    await user.click(entryButton);

    const dialog = await screen.findByRole("dialog", { name: "サンプル提案" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "詳細画面で開く" })).toHaveAttribute("href", "/suggestions/sug-1");
  });

  it("?suggestion=<id>が既にあれば初期表示からサイドピークが開いた状態になる", async () => {
    const sameDay = Date.now();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          entries: [{ id: "e1", entityType: "suggestion", entityId: "sug-1", entityLabel: "サンプル提案", text: "更新", occurredAt: sameDay }],
        }),
      }),
    );
    render(<TimelinePage />, { wrapper: createWrapper(["/timeline?suggestion=sug-1"]) });
    await waitFor(() => expect(screen.getByRole("dialog", { name: "サンプル提案" })).toBeInTheDocument());
  });
});
