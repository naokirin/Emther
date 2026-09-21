import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { JournalPage } from "./JournalPage";

// web/src/app/journal/page.tsx（Next.js版）には専用テストが元々無かったため新規に追加する
// （フェーズ3.5 tier4）。個々の子コンポーネント（JournalEntryCard/JournalInputSwitcher/
// useJournalEditing）は別テストで検証済みのため、ここでは一覧表示とフィルタ操作による
// 再フェッチに絞って検証する。
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

const ENTRY = {
  id: "e1",
  rawText: "Aさんと1on1した",
  tags: ["1on1"],
  people: ["Aさん"],
  teamIds: [],
  urgency: "mid" as const,
  sentiment: "neutral" as const,
  summary: "",
  createdAt: Date.now(),
  confirmed: true,
};

describe("JournalPage", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith("/api/journal/search")) {
        return { ok: true, json: async () => ({ entries: [ENTRY], total: 1, page: 1, pageSize: 10, facets: { tags: [], people: [] } }) };
      }
      if (url === "/api/suggestions") return { ok: true, json: async () => ({ suggestions: [] }) };
      if (url === "/api/org/objectives") return { ok: true, json: async () => ({ objectives: [] }) };
      if (url === "/api/journal/dumps") return { ok: true, json: async () => ({ dumps: [] }) };
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("一覧を表示し、キーワード検索で再フェッチする", async () => {
    const user = userEvent.setup();
    render(<JournalPage />, { wrapper: createWrapper() });

    expect(await screen.findByText("Aさんと1on1した")).toBeInTheDocument();

    await user.type(screen.getByLabelText("キーワード検索（本文・要約・タグ・人物）"), "リファクタ");
    await waitFor(() => {
      const called = fetchMock.mock.calls.some((call: unknown[]) => {
        const url = call[0] as string;
        const params = new URLSearchParams(url.split("?")[1] ?? "");
        return params.get("query") === "リファクタ";
      });
      expect(called).toBe(true);
    });
  });

  it("条件に一致するJournalが無ければその旨を表示する", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.startsWith("/api/journal/search")) {
          return { ok: true, json: async () => ({ entries: [], total: 0, page: 1, pageSize: 10, facets: { tags: [], people: [] } }) };
        }
        return { ok: true, json: async () => ({}) };
      }),
    );
    render(<JournalPage />, { wrapper: createWrapper() });
    expect(await screen.findByText("条件に一致するJournalはありません。")).toBeInTheDocument();
  });
});
