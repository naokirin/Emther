import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { SuggestionsPage } from "./SuggestionsPage";
import { IdResolveProvider } from "../../components/IdFragmentLink";
import type { Suggestion } from "@emther/core/types";

// web/src/app/suggestions/page.tsx（Next.js版）には専用テストが元々無かったため新規に
// 追加する（フェーズ3.5 tier4 suggestionsバッチ）。デフォルトフィルタ（確認済みは非表示）と
// キーワード検索、サイドピークを開く導線に絞って検証する。

function suggestion(overrides: Partial<Suggestion> = {}): Suggestion {
  return {
    id: `sug-${Math.random()}`,
    title: "提案タイトル",
    reviewStatus: "unreviewed",
    confirmPriority: "normal",
    memos: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

function createWrapper(onPeekOpen?: (id: string) => void) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <IdResolveProvider openSuggestionInPeek={onPeekOpen}>
            {children}
            <LocationProbe />
          </IdResolveProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );
  };
}

describe("SuggestionsPage", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/suggestions") {
        return {
          ok: true,
          json: async () => ({
            suggestions: [
              suggestion({ id: "sug-open", title: "未確認の提案" }),
              suggestion({ id: "sug-done", title: "確認済みの提案", reviewStatus: "done" }),
            ],
          }),
        };
      }
      if (url === "/api/agents") return { ok: true, json: async () => ({ runs: [], pendingAgentStarts: [], pendingUnmaskedSends: [] }) };
      if (url === "/api/settings/rules") return { ok: true, json: async () => ({ rules: { agentStaleAfterSeconds: 120 } }) };
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("デフォルトでは確認済み（done）の提案を表示しない", async () => {
    render(<SuggestionsPage />, { wrapper: createWrapper() });
    expect(await screen.findByText("未確認の提案")).toBeInTheDocument();
    expect(screen.queryByText("確認済みの提案")).not.toBeInTheDocument();
  });

  it("「確認済みも表示する」と確認状態フィルタの両方をONにすると表示される", async () => {
    const user = userEvent.setup();
    render(<SuggestionsPage />, { wrapper: createWrapper() });
    await screen.findByText("未確認の提案");
    // showDone（トップの表示切替）と確認状態フィルタ（複数選択チェックボックス）は独立しており、
    // doneの提案を表示するには両方をONにする必要がある（SuggestionsPage.tsxのfilteredロジック参照）。
    await user.click(screen.getByLabelText(/確認済み（もう追わない）も表示する/));
    await user.click(screen.getByRole("checkbox", { name: "✅ 確認済み" }));
    expect(await screen.findByText("確認済みの提案")).toBeInTheDocument();
  });

  it("キーワード検索でタイトルが一致しない提案を除外する", async () => {
    const user = userEvent.setup();
    render(<SuggestionsPage />, { wrapper: createWrapper() });
    await screen.findByText("未確認の提案");
    await user.type(screen.getByLabelText(/キーワード検索/), "存在しないキーワード");
    expect(screen.queryByText("未確認の提案")).not.toBeInTheDocument();
    expect(screen.getByText("条件に一致する提案はありません。")).toBeInTheDocument();
  });

  it("タイトルをクリックするとサイドピークを開く", async () => {
    const onPeekOpen = vi.fn();
    const user = userEvent.setup();
    render(<SuggestionsPage />, { wrapper: createWrapper(onPeekOpen) });
    await user.click(await screen.findByText("未確認の提案"));
    expect(onPeekOpen).toHaveBeenCalledWith("sug-open");
  });

  it("提案未作成のLead Agent Runをクリックすると、その相談をrunIdで指定して/chatへ遷移する", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/suggestions") return { ok: true, json: async () => ({ suggestions: [] }) };
      if (url === "/api/agents") {
        return {
          ok: true,
          json: async () => ({
            runs: [
              {
                id: "run-lead-1",
                agentName: "Lead Agent",
                task: "相談内容",
                status: "idle",
                log: [],
                totalCostUsd: 0,
                createdAt: 0,
                updatedAt: 0,
                origin: "manual",
                reviewed: true,
              },
            ],
            pendingAgentStarts: [],
            pendingUnmaskedSends: [],
          }),
        };
      }
      if (url === "/api/settings/rules") return { ok: true, json: async () => ({ rules: { agentStaleAfterSeconds: 120 } }) };
      return { ok: true, json: async () => ({}) };
    });
    const user = userEvent.setup();
    render(<SuggestionsPage />, { wrapper: createWrapper() });
    await user.click(await screen.findByText("Lead Agent"));
    // 「run=」ではなく、ChatPageが読む「runId=」で指定しないと相談画面のデフォルト表示に飛んでしまう。
    expect(screen.getByTestId("location")).toHaveTextContent("/chat?runId=run-lead-1");
  });
});
