import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { TeamsPage } from "./TeamsPage";

// web/src/app/teams/page.tsx（Next.js版）には専用テストが元々無かったため新規に追加する
// （フェーズ3.5 tier2、teamsバッチ）。useTeams/useIssues/useJournal/useEntityHistoryが
// TanStack Query化されたためQueryClientProviderで包む。
function createWrapper(initialEntries: string[] = ["/teams"]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  };
}

describe("TeamsPage", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/teams") {
          return { ok: true, json: async () => ({ teams: [{ id: "t1", name: "Design", members: [], charter: { mission: "", constraints: "" }, managedByEm: true, aliases: [], archived: false, createdAt: 0, updatedAt: 0 }] }) };
        }
        if (url === "/api/issues") return { ok: true, json: async () => ({ issues: [] }) };
        if (url === "/api/journal") return { ok: true, json: async () => ({ entries: [] }) };
        if (url.startsWith("/api/knowledge/events")) return { ok: true, json: async () => ({ events: [] }) };
        return { ok: true, json: async () => ({}) };
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("チーム一覧を読み込み、クリックすると編集パネルに反映する", async () => {
    const user = userEvent.setup();
    render(<TeamsPage />, { wrapper: createWrapper() });

    await user.click(await screen.findByText(/Design（0名）/));
    expect(await screen.findByDisplayValue("Design")).toBeInTheDocument();
  });

  it("?focus=<teamId>を渡すと初期表示から該当チームを開く", async () => {
    render(<TeamsPage />, { wrapper: createWrapper(["/teams?focus=t1"]) });
    expect(await screen.findByDisplayValue("Design")).toBeInTheDocument();
  });
});
