import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AgentsPage } from "./AgentsPage";
import { IdResolveProvider } from "../../components/IdFragmentLink";
import type { AgentRun } from "../../components/RunDetail";

// web/src/app/agents/page.tsx（Next.js版）には専用テストが元々無かったため新規に追加する
// （フェーズ3.5 tier5 agentsバッチ）。Fleet状態・起動フォーム・Inbox一覧のクリック導線に絞って
// 検証する（ExecutionState等の個別描画はRunDetail.test.tsxで検証済み）。

function run(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: "run-1",
    agentName: "Lead Agent",
    task: "タスク内容",
    status: "idle",
    log: [],
    totalCostUsd: 0,
    createdAt: 0,
    updatedAt: 0,
    origin: "manual",
    reviewed: true,
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
          <IdResolveProvider openIssueInPeek={onPeekOpen}>
            {children}
            <LocationProbe />
          </IdResolveProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );
  };
}

describe("AgentsPage", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let runs: AgentRun[];

  beforeEach(() => {
    runs = [run()];
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/agents" && (!init || init.method === undefined)) {
        return { ok: true, json: async () => ({ runs, pendingAgentStarts: [], pendingUnmaskedSends: [] }) };
      }
      if (url === "/api/agents" && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        const newRun = run({ id: "run-new", agentName: body.agentName, task: body.task });
        runs = [...runs, newRun];
        return { ok: true, json: async () => ({ run: newRun }) };
      }
      if (url.startsWith("/api/agents/inbox")) {
        return { ok: true, json: async () => ({ runs, total: runs.length, page: 1, pageSize: 5 }) };
      }
      if (url === "/api/issues") return { ok: true, json: async () => ({ issues: [] }) };
      if (url === "/api/settings/rules") return { ok: true, json: async () => ({ rules: { agentStaleAfterSeconds: 120 } }) };
      if (url === "/api/suggestions" && init?.method === "POST") {
        return { ok: true, json: async () => ({ suggestion: { id: "sug-new" } }) };
      }
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("エージェントごとのFleet状態を表示する", async () => {
    render(<AgentsPage />, { wrapper: createWrapper() });
    expect(await screen.findByText("Lead Agent")).toBeInTheDocument();
    expect(screen.getByText("People Agent")).toBeInTheDocument();
  });

  it("Inbox一覧にrunを表示する", async () => {
    render(<AgentsPage />, { wrapper: createWrapper() });
    expect(await screen.findByRole("button", { name: /タスク内容/ })).toBeInTheDocument();
  });

  it("Lead Agentのタスクを起動すると/chatへ遷移する", async () => {
    const user = userEvent.setup();
    render(<AgentsPage />, { wrapper: createWrapper() });
    await screen.findByText("Lead Agent");

    await user.type(screen.getByLabelText("タスク内容"), "新しい相談内容");
    await user.click(screen.getByRole("button", { name: "エージェントを起動" }));

    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/chat?runId=run-new"));
  });

  it("専門エージェントのタスクを起動すると提案として残しサイドピークを開く", async () => {
    const onPeekOpen = vi.fn();
    const user = userEvent.setup();
    render(<AgentsPage />, { wrapper: createWrapper(onPeekOpen) });
    await screen.findByText("Lead Agent");

    await user.click(screen.getByRole("button", { name: "Tech Agent" }));
    await user.type(screen.getByLabelText("タスク内容"), "リファクタリングの相談");
    await user.click(screen.getByRole("button", { name: "エージェントを起動" }));

    await waitFor(() => expect(onPeekOpen).toHaveBeenCalledWith("sug-new"));
  });

  it("Lead Agentで未紐付けのInbox行をクリックすると/chatへ遷移する", async () => {
    const user = userEvent.setup();
    render(<AgentsPage />, { wrapper: createWrapper() });
    await user.click(await screen.findByRole("button", { name: /タスク内容/ }));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/chat?runId=run-1"));
  });
});
