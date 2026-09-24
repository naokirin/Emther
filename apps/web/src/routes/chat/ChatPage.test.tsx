import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "@/router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ChatPage } from "./ChatPage";
import type { AgentRun } from "@emther/core/agent-runtime";

// 相談履歴の選択・新規相談フォームとの切り替えに絞って
// 検証する（各パネルの内部動作はChatHistoryPanel/NewConsultForm/ConsultReviewPanelの
// 各テストで個別に検証済み）

function run(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: "run-1",
    agentName: "Lead Agent",
    task: "既存の相談",
    status: "idle",
    log: [],
    totalCostUsd: 0,
    createdAt: 0,
    updatedAt: Date.now(),
    origin: "manual",
    reviewed: false,
    ...overrides,
  };
}

function createWrapper(initialEntries: string[] = ["/chat"], queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  };
}

describe("ChatPage", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/agents") {
        return { ok: true, json: async () => ({ runs: [run()], pendingAgentStarts: [], pendingUnmaskedSends: [] }) };
      }
      if (url === "/api/suggestions") return { ok: true, json: async () => ({ suggestions: [] }) };
      if (url === "/api/settings/rules") return { ok: true, json: async () => ({ rules: { agentStaleAfterSeconds: 120 } }) };
      if (url === "/api/journal") return { ok: true, json: async () => ({ entry: null }) };
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("runId未指定なら新規相談フォームを表示する", async () => {
    render(<ChatPage />, { wrapper: createWrapper() });
    expect(await screen.findByRole("button", { name: "相談を始める" })).toBeInTheDocument();
  });

  it("履歴一覧から選択すると相談レビューパネルに切り替わる", async () => {
    const user = userEvent.setup();
    render(<ChatPage />, { wrapper: createWrapper() });
    await user.click(await screen.findByText("既存の相談"));
    expect(await screen.findByRole("heading", { name: "Lead Agentへの相談" })).toBeInTheDocument();
  });

  it("?runId=が既にあれば初期表示から相談レビューパネルを開く", async () => {
    render(<ChatPage />, { wrapper: createWrapper(["/chat?runId=run-1"]) });
    expect(await screen.findByRole("heading", { name: "Lead Agentへの相談" })).toBeInTheDocument();
  });

  it("ダッシュボード等でrunsLoaded/suggestionsLoadedが既にキャッシュ済みの状態で?runId=マウントしても相談レビューパネルを開く", async () => {
    // 再現バグ: マウント前にキャッシュが温まっている（他画面から遷移した直後）と、
    // selectionSyncKeyの初期値が初回レンダー時点で既にnextSelectionSyncKeyと一致してしまい、
    // 「変化」として検知されず選択が同期されないまま新規相談フォームが表示され続けていた。
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(["api", "agents"], { runs: [run()], pendingAgentStarts: [], pendingUnmaskedSends: [] });
    queryClient.setQueryData(["api", "suggestions"], { suggestions: [] });
    render(<ChatPage />, { wrapper: createWrapper(["/chat?runId=run-1"], queryClient) });
    expect(await screen.findByRole("heading", { name: "Lead Agentへの相談" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "相談を始める" })).not.toBeInTheDocument();
  });

  it("「新しい相談を始める」で新規フォームへ戻る", async () => {
    const user = userEvent.setup();
    render(<ChatPage />, { wrapper: createWrapper(["/chat?runId=run-1"]) });
    await screen.findByRole("heading", { name: "Lead Agentへの相談" });
    await user.click(screen.getByRole("button", { name: "＋ 新しい相談を始める" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "相談を始める" })).toBeInTheDocument());
  });
});
