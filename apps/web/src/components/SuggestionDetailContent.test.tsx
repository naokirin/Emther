import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { SuggestionDetailContent } from "./SuggestionDetailContent";
import type { Suggestion } from "@emther/core/types";
import { copyTextToClipboard } from "../lib/clipboard";

vi.mock("../lib/clipboard", () => ({
  copyTextToClipboard: vi.fn(async () => true),
}));

// web/src/components/SuggestionDetailContent.tsx（Next.js版）には専用テストが元々無かった
// ため新規に追加する（フェーズ3.5 tier4 suggestionsバッチ）。確認状態のPATCH（ミューテーション
// 後の再取得）とメモ追記の主要フローに絞って検証する（画面の他の細部はRunDetail.test.tsx等で
// 個別に検証済み）。

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

function baseSuggestion(overrides: Partial<Suggestion> = {}): Suggestion {
  return {
    id: "sug-1",
    title: "提案タイトル",
    reviewStatus: "unreviewed",
    confirmPriority: "normal",
    memos: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("SuggestionDetailContent", () => {
  let suggestion: Suggestion;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    suggestion = baseSuggestion();
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/suggestions/sug-1" && (!init || init.method === undefined)) {
        return { ok: true, json: async () => ({ suggestion, sourceJournals: [] }) };
      }
      if (url === "/api/suggestions/sug-1" && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body));
        suggestion = { ...suggestion, ...body };
        return { ok: true, json: async () => ({ suggestion }) };
      }
      if (url === "/api/suggestions/sug-1/memo" && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        suggestion = { ...suggestion, memos: [...suggestion.memos, { id: "m1", text: body.text, createdAt: 1 }] };
        return { ok: true, json: async () => ({ suggestion }) };
      }
      if (url === "/api/suggestions") return { ok: true, json: async () => ({ suggestions: [] }) };
      if (url === "/api/agents") return { ok: true, json: async () => ({ runs: [], pendingAgentStarts: [], pendingUnmaskedSends: [] }) };
      if (url === "/api/org/objectives") return { ok: true, json: async () => ({ objectives: [] }) };
      if (url === "/api/teams") return { ok: true, json: async () => ({ teams: [] }) };
      if (url === "/api/themes") return { ok: true, json: async () => ({ themes: [] }) };
      if (url === "/api/settings/rules") return { ok: true, json: async () => ({ rules: {} }) };
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(copyTextToClipboard).mockClear();
  });

  it("提案のタイトルを表示する", async () => {
    render(<SuggestionDetailContent id="sug-1" />, { wrapper: createWrapper() });
    expect(await screen.findByText("提案タイトル")).toBeInTheDocument();
  });

  it("Markdown をコピーすると提案本文をクリップボードへ書く", async () => {
    suggestion = baseSuggestion({
      detail: {
        conclusion: "結論",
        facts: ["事実"],
        logic: "ロジック",
        updatedAt: 1,
      },
    });
    const user = userEvent.setup();
    render(<SuggestionDetailContent id="sug-1" />, { wrapper: createWrapper() });
    await user.click(await screen.findByRole("button", { name: "Markdown をコピー" }));
    expect(await screen.findByRole("button", { name: "コピーしました" })).toBeInTheDocument();
    expect(copyTextToClipboard).toHaveBeenCalled();
    const text = vi.mocked(copyTextToClipboard).mock.calls[0]![0];
    expect(text).toContain("# 提案タイトル");
    expect(text).toContain("## 結論\n結論");
    expect(text).toContain("Emther ID: sug-1");
    expect(text).toMatch(/Emther URL: https?:\/\/.+\/suggestions\/sug-1/);
  });

  it("Agent Runが無ければその旨を表示する", async () => {
    render(<SuggestionDetailContent id="sug-1" />, { wrapper: createWrapper() });
    await screen.findByText("提案タイトル");
    expect(screen.getByText(/この提案に紐づく Agent Run はありません/)).toBeInTheDocument();
  });

  it("確認状態を変更するとPATCHして再取得する", async () => {
    const user = userEvent.setup();
    render(<SuggestionDetailContent id="sug-1" />, { wrapper: createWrapper() });
    await screen.findByText("提案タイトル");

    const combobox = screen.getByRole("combobox", { name: "確認状態" });
    await user.click(combobox);
    await user.click(screen.getByRole("option", { name: /🔎 確認中/ }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/suggestions/sug-1",
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ reviewStatus: "in_review" }) }),
      ),
    );
  });

  it("メモを追記できる", async () => {
    const user = userEvent.setup();
    render(<SuggestionDetailContent id="sug-1" />, { wrapper: createWrapper() });
    await screen.findByText("提案タイトル");

    await user.type(screen.getByPlaceholderText(/考えたこと・確認したこと/), "来週の1on1で触れる");
    await user.click(screen.getByRole("button", { name: "追記" }));

    expect(await screen.findByText("来週の1on1で触れる")).toBeInTheDocument();
    expect(screen.queryByText("まだメモはありません。")).not.toBeInTheDocument();
  });
});
