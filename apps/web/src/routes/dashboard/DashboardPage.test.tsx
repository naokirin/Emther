import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { DashboardPage } from "./DashboardPage";

// web/src/app/page.tsx（Next.js版、ダッシュボード本体）には専用テストが元々無かった
// ため新規に追加する（フェーズ3.5 tier5 dashboardバッチ、最終ティア最後の画面）。各子
// パネル（TodayActionsPanel/DailySituationPanel/ThemesPanel/EveningReviewCard/
// SetupGapsBanner）の内部動作は個別テストで検証済みのため、ここでは主要パネルが
// 揃って描画されることに絞って検証する。

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

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/agents") return { ok: true, json: async () => ({ runs: [], pendingAgentStarts: [], pendingUnmaskedSends: [] }) };
        if (url === "/api/suggestions") return { ok: true, json: async () => ({ suggestions: [] }) };
        if (url === "/api/vitals") {
          return {
            ok: true,
            json: async () => ({ teams: [], oneOnOneCoverage: { status: "good", covered: 1, total: 1, reason: "", uncoveredMembers: [] } }),
          };
        }
        if (url === "/api/journal") return { ok: true, json: async () => ({ entries: [] }) };
        if (url === "/api/em-self/checkins") return { ok: true, json: async () => ({ checkins: [] }) };
        if (url === "/api/settings/rules") return { ok: true, json: async () => ({ rules: { decisionQueueLimit: 3, observationQueueLimit: 3, agentStaleAfterSeconds: 120 } }) };
        if (url === "/api/org/strategy") return { ok: true, json: async () => ({ strategy: { mission: "使命", vision: "", values: "" } }) };
        if (url === "/api/teams") return { ok: true, json: async () => ({ teams: [{ id: "t1", name: "チームA" }] }) };
        if (url === "/api/org/objectives") return { ok: true, json: async () => ({ objectives: [{ id: "o1", title: "目標A", keyResults: [], progress: [] }] }) };
        if (url === "/api/org/goals") return { ok: true, json: async () => ({ goals: [{ id: "g1", title: "目標A" }] }) };
        if (url === "/api/people") return { ok: true, json: async () => ({ people: [] }) };
        if (url === "/api/themes") return { ok: true, json: async () => ({ themes: [] }) };
        if (url === "/api/dashboard/why-now") return { ok: true, json: async () => ({ items: [], source: "heuristic" }) };
        return { ok: true, json: async () => ({}) };
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("いまの状態・今日やるべき3つ・材料・テーマの各パネルを表示する", async () => {
    render(<DashboardPage />, { wrapper: createWrapper() });

    expect(await screen.findByRole("heading", { name: /今日、判断待ちの組織課題はありません/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "いまの状態" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "材料（判断はEMがする）" })).toBeInTheDocument();
    expect(screen.getByText(/まだ今日のチェックイン未記録/)).toBeInTheDocument();
    expect(await screen.findByText(/採用中の優先テーマはまだありません/)).toBeInTheDocument();
  });

  it("セットアップが揃っていなければSetupGapsBannerを表示する", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/teams") return { ok: true, json: async () => ({ teams: [] }) };
        if (url === "/api/org/objectives") return { ok: true, json: async () => ({ objectives: [] }) };
        if (url === "/api/org/goals") return { ok: true, json: async () => ({ goals: [] }) };
        if (url === "/api/org/strategy") return { ok: true, json: async () => ({ strategy: { mission: "", vision: "", values: "" } }) };
        if (url === "/api/agents") return { ok: true, json: async () => ({ runs: [], pendingAgentStarts: [], pendingUnmaskedSends: [] }) };
        if (url === "/api/suggestions") return { ok: true, json: async () => ({ suggestions: [] }) };
        if (url === "/api/vitals") {
          return { ok: true, json: async () => ({ teams: [], oneOnOneCoverage: { status: "good", covered: 1, total: 1, reason: "", uncoveredMembers: [] } }) };
        }
        if (url === "/api/journal") return { ok: true, json: async () => ({ entries: [] }) };
        if (url === "/api/em-self/checkins") return { ok: true, json: async () => ({ checkins: [] }) };
        if (url === "/api/settings/rules") return { ok: true, json: async () => ({ rules: { decisionQueueLimit: 3, observationQueueLimit: 3, agentStaleAfterSeconds: 120 } }) };
        if (url === "/api/people") return { ok: true, json: async () => ({ people: [] }) };
        if (url === "/api/themes") return { ok: true, json: async () => ({ themes: [] }) };
        if (url === "/api/dashboard/why-now") return { ok: true, json: async () => ({ items: [], source: "heuristic" }) };
        return { ok: true, json: async () => ({}) };
      }),
    );
    render(<DashboardPage />, { wrapper: createWrapper() });
    expect(await screen.findByText(/初回セットアップ/)).toBeInTheDocument();
  });
});
