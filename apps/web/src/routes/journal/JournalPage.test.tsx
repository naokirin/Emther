import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { JournalPage } from "./JournalPage";

// 個々の子コンポーネント（JournalEntryCard/JournalInputSwitcher/
// useJournalEditing）は別テストで検証済みのため、ここでは一覧表示とフィルタ操作による
// 再フェッチに絞って検証する
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

function createWrapper(initialEntries: string[] = ["/journal"]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={initialEntries}>
          {children}
          <LocationProbe />
        </MemoryRouter>
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
      if (url === "/api/journal/batch") return { ok: true, json: async () => ({ pendingCount: 0 }) };
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

    await user.type(screen.getByLabelText("本文・人物・タグで検索"), "リファクタ");
    await waitFor(() => {
      const called = fetchMock.mock.calls.some((call: unknown[]) => {
        const url = call[0] as string;
        const params = new URLSearchParams(url.split("?")[1] ?? "");
        return params.get("query") === "リファクタ";
      });
      expect(called).toBe(true);
    });
    expect(screen.getByTestId("location")).toHaveTextContent("q=%E3%83%AA%E3%83%95%E3%82%A1%E3%82%AF%E3%82%BF");
  });

  it("?person= から人物フィルタを初期化する", async () => {
    render(<JournalPage />, { wrapper: createWrapper(["/journal?person=A%E3%81%95%E3%82%93"]) });
    await waitFor(() => {
      const called = fetchMock.mock.calls.some((call: unknown[]) => {
        const url = call[0] as string;
        if (!url.startsWith("/api/journal/search")) return false;
        const params = new URLSearchParams(url.split("?")[1] ?? "");
        return params.get("person") === "Aさん";
      });
      expect(called).toBe(true);
    });
    expect(screen.getByTestId("location")).toHaveTextContent("person=");
  });

  it("条件に一致するJournalが無ければその旨を表示する", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.startsWith("/api/journal/search")) {
          return { ok: true, json: async () => ({ entries: [], total: 0, page: 1, pageSize: 10, facets: { tags: [], people: [] } }) };
        }
        if (url === "/api/journal/batch") return { ok: true, json: async () => ({ pendingCount: 0 }) };
        return { ok: true, json: async () => ({}) };
      }),
    );
    render(<JournalPage />, { wrapper: createWrapper() });
    expect(await screen.findByText("条件に一致するJournalはありません。")).toBeInTheDocument();
  });

  it("未解釈件数があるときだけ集約解釈ストリップを出す", async () => {
    fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith("/api/journal/search")) {
        return { ok: true, json: async () => ({ entries: [ENTRY], total: 1, page: 1, pageSize: 10, facets: { tags: [], people: [] } }) };
      }
      if (url === "/api/journal/batch") return { ok: true, json: async () => ({ pendingCount: 3 }) };
      if (url === "/api/suggestions") return { ok: true, json: async () => ({ suggestions: [] }) };
      if (url === "/api/journal/dumps") return { ok: true, json: async () => ({ dumps: [] }) };
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<JournalPage />, { wrapper: createWrapper() });
    expect(await screen.findByText("前回解釈から 3件の未解釈があります")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "集約解釈する" })).toBeInTheDocument();
  });

  it("未解釈が0件なら集約解釈ストリップを出さない", async () => {
    render(<JournalPage />, { wrapper: createWrapper() });
    expect(await screen.findByText("Aさんと1on1した")).toBeInTheDocument();
    expect(screen.queryByText(/未解釈があります/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "集約解釈する" })).not.toBeInTheDocument();
  });

  it("?focus= 指定時は対象Journalへ scrollIntoView する", async () => {
    const scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;

    const focusEntry = { ...ENTRY, id: "focus-me", rawText: "フォーカス対象のメモ" };
    const otherEntry = { ...ENTRY, id: "other", rawText: "別のメモ" };

    fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith("/api/journal/search")) {
        return {
          ok: true,
          json: async () => ({
            entries: [otherEntry, focusEntry],
            total: 2,
            page: 1,
            pageSize: 10,
            facets: { tags: [], people: [] },
          }),
        };
      }
      if (url === "/api/suggestions") return { ok: true, json: async () => ({ suggestions: [] }) };
      if (url === "/api/org/objectives") return { ok: true, json: async () => ({ objectives: [] }) };
      if (url === "/api/journal/dumps") return { ok: true, json: async () => ({ dumps: [] }) };
      if (url === "/api/journal/batch") return { ok: true, json: async () => ({ pendingCount: 0 }) };
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);

    function FocusWrapper({ children }: { children: ReactNode }) {
      return createWrapper(["/journal?focus=focus-me"])({ children });
    }

    render(<JournalPage />, { wrapper: FocusWrapper });

    expect(await screen.findByText("フォーカス対象のメモ")).toBeInTheDocument();
    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
    });
  });
});
