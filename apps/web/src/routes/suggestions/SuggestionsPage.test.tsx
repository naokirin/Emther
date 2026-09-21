import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { SuggestionsPage } from "./SuggestionsPage";
import { IdResolveProvider } from "../../components/IdFragmentLink";
import type { Suggestion } from "@emther/core/types";

// docs/design/suggestion/suggestion-tab.pen 改善案C対応後の一覧UIを検証する。
// テーマメニュー・絞り込みポップオーバー・4列表・デフォルトの確認済み非表示に絞る。

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
              suggestion({
                id: "sug-theme",
                title: "テーマ付き提案",
                themeId: "theme-1",
              }),
            ],
          }),
        };
      }
      if (url === "/api/themes") {
        return {
          ok: true,
          json: async () => ({
            themes: [
              {
                id: "theme-1",
                title: "優先度の高いセキュリティリスクの排除とリスク運用実現",
                summary: "重大インシデントにつながる穴を先に潰す",
                rationale: "",
                facts: [],
                evidenceJournalIds: [],
                evidenceSuggestionIds: [],
                status: "adopted",
                createdAt: 1,
                updatedAt: 1,
                adoptedAt: 1,
              },
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
    await user.click(screen.getByRole("button", { name: "絞り込み" }));
    const dialog = screen.getByRole("dialog", { name: "絞り込み" });
    await user.click(within(dialog).getByLabelText(/確認済み（もう追わない）も表示する/));
    await user.click(within(dialog).getByRole("checkbox", { name: "✅ 確認済み" }));
    await user.click(within(dialog).getByRole("button", { name: /適用する/ }));
    expect(await screen.findByText("確認済みの提案")).toBeInTheDocument();
  });

  it("キーワード検索でタイトルが一致しない提案を除外する", async () => {
    const user = userEvent.setup();
    render(<SuggestionsPage />, { wrapper: createWrapper() });
    await screen.findByText("未確認の提案");
    await user.type(screen.getByLabelText(/このテーマ内を検索/), "存在しないキーワード");
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

  it("テーマメニューで特定テーマを選ぶとそのテーマの提案だけ残る", async () => {
    const user = userEvent.setup();
    render(<SuggestionsPage />, { wrapper: createWrapper() });
    await screen.findByText("未確認の提案");
    await user.click(screen.getByRole("combobox", { name: "いま向き合うテーマ" }));
    await user.click(await screen.findByRole("option", { name: /優先度の高いセキュリティリスク/ }));
    expect(await screen.findByText("テーマ付き提案")).toBeInTheDocument();
    expect(screen.queryByText("未確認の提案")).not.toBeInTheDocument();
  });

  it("提案未作成のLead Agent Runをクリックすると、その相談をrunIdで指定して/chatへ遷移する", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/suggestions") return { ok: true, json: async () => ({ suggestions: [] }) };
      if (url === "/api/themes") return { ok: true, json: async () => ({ themes: [] }) };
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
    expect(screen.getByTestId("location")).toHaveTextContent("/chat?runId=run-lead-1");
  });
});
