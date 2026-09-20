import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ReportsPage } from "./ReportsPage";

// web/src/app/reports/page.tsx（Next.js版）には専用テストが元々無かったため新規に追加する
// （フェーズ3.5 tier3）。DailyTrendChartはreact-chartjs-2をモックしたテストで別途
// 検証済みのため、ここでは実チャートをそのまま描画させ「クラッシュしないこと」に留め、
// AIレビュー起動・絞り込み・コメント保存の主要フローを検証する。機械集計のみの
// 生成ボタンは「レポート作成とレビューの違いが分かりにくい」というユーザー指摘対応で
// 廃止し、AIレビュー起動（レビューをする）に一本化した。
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

const REPORT = {
  id: "r1",
  periodType: "week" as const,
  periodStart: Date.parse("2026-09-08"),
  periodEnd: Date.parse("2026-09-14"),
  generatedAt: Date.parse("2026-09-14"),
  note: "",
  stats: {
    journal: { total: 3, byUrgency: { low: 1, mid: 1, high: 1 }, bySentiment: { positive: 1, neutral: 1, negative: 1 }, topTags: [], notableEntries: [] },
    issues: { createdCount: 1, archivedCount: 0, createdTitles: [], archivedTitles: [] },
    events: { total: 0, byEntityType: {} },
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ReportsPage", () => {
  it("レポートが無ければ空メッセージを表示する", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/reports") return { ok: true, json: async () => ({ reports: [] }) };
        if (url === "/api/journal") return { ok: true, json: async () => ({ entries: [] }) };
        if (url === "/api/issues") return { ok: true, json: async () => ({ issues: [] }) };
        return { ok: true, json: async () => ({}) };
      }),
    );
    render(<ReportsPage />, { wrapper: createWrapper() });
    expect(await screen.findByText(/まだレポートがありません/)).toBeInTheDocument();
  });

  it("コメントを保存すると一覧の該当行に反映する", async () => {
    const updated = { ...REPORT, note: "順調" };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/reports/r1" && init?.method === "PATCH") {
        return { ok: true, json: async () => ({ report: updated }) };
      }
      if (url === "/api/reports") return { ok: true, json: async () => ({ reports: [REPORT] }) };
      if (url === "/api/journal") return { ok: true, json: async () => ({ entries: [] }) };
      if (url === "/api/issues") return { ok: true, json: async () => ({ issues: [] }) };
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<ReportsPage />, { wrapper: createWrapper() });
    await user.click(await screen.findByRole("button", { name: "詳細を見る" }));

    const noteInput = screen.getByLabelText("EMの所感・コメント");
    await user.type(noteInput, "順調");
    await user.click(screen.getByRole("button", { name: "コメントを保存" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/reports/r1",
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ note: "順調" }) }),
      ),
    );
    expect(await screen.findByText("保存済み")).toBeInTheDocument();
  });

  it("「週次レビューをする」→「今週」でPOSTし、periodReviewの内容を展開行に表示する", async () => {
    const reviewedReport = { ...REPORT, id: "r-review" };
    const reviewRun = {
      id: "run-review",
      agentName: "Lead Agent",
      task: "今週のレビューを作成してください。",
      status: "idle" as const,
      log: [],
      totalCostUsd: 0,
      createdAt: Date.parse("2026-09-14"),
      updatedAt: Date.parse("2026-09-14"),
      origin: "auto-weekly-report" as const,
      sourceReportId: "r-review",
      reviewed: true,
      periodReview: {
        overview: "今週は判断待ちが多かった",
        observations: [],
        interpretation: "意思決定の所在が曖昧な可能性",
        comparisons: [],
        blindSpots: [],
        learnings: [],
        nextQuestions: [],
      },
    };
    let reports: typeof REPORT[] = [];
    let runs: (typeof reviewRun)[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/reports/review" && init?.method === "POST") {
        reports = [reviewedReport];
        runs = [reviewRun];
        return { ok: true, json: async () => ({ report: reviewedReport, run: reviewRun }) };
      }
      if (url === "/api/reports") return { ok: true, json: async () => ({ reports }) };
      if (url === "/api/agents") return { ok: true, json: async () => ({ runs, pendingAgentStarts: [], pendingUnmaskedSends: [] }) };
      if (url === "/api/journal") return { ok: true, json: async () => ({ entries: [] }) };
      if (url === "/api/issues") return { ok: true, json: async () => ({ issues: [] }) };
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<ReportsPage />, { wrapper: createWrapper() });
    await screen.findByText(/まだレポートがありません/);

    await user.click(screen.getByRole("combobox", { name: "🤖 週次レビューをする" }));
    await user.click(await screen.findByRole("option", { name: "今週" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/reports/review",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ periodType: "week", offset: 0 }) }),
      ),
    );

    // ユーザー指摘「実行しても結果が表示されず、一覧を見てもAIの分析結果やリンクが出ない」対応。
    // 「詳細を見る」で展開しなくても、実行直後に直近のAIレビュー欄へ内容が出ること・
    // 一覧の行にもレビュー有無のバッジが出ることを確認する。
    expect(await screen.findByRole("heading", { name: "直近のAIレビュー" })).toBeInTheDocument();
    expect(screen.getByText("今週は判断待ちが多かった")).toBeInTheDocument();
    expect(screen.getAllByText(/AIレビュー完了/).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /この提案について会話する/ })).toHaveAttribute(
      "href",
      "/chat?runId=run-review",
    );
  });

  it("過去に生成済みのAIレビューがあれば、ページを開いた時点で直近のAIレビュー欄に表示する", async () => {
    const reviewedReport = { ...REPORT, id: "r-review" };
    const reviewRun = {
      id: "run-review",
      agentName: "Lead Agent",
      task: "今週のレビューを作成してください。",
      status: "idle" as const,
      log: [],
      totalCostUsd: 0,
      createdAt: Date.parse("2026-09-14"),
      updatedAt: Date.parse("2026-09-14"),
      origin: "auto-weekly-report" as const,
      sourceReportId: "r-review",
      reviewed: true,
      periodReview: {
        overview: "既存のレビュー結果",
        observations: [],
        interpretation: "解釈",
        comparisons: [],
        blindSpots: [],
        learnings: [],
        nextQuestions: [],
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/reports") return { ok: true, json: async () => ({ reports: [reviewedReport] }) };
        if (url === "/api/agents") return { ok: true, json: async () => ({ runs: [reviewRun], pendingAgentStarts: [], pendingUnmaskedSends: [] }) };
        if (url === "/api/journal") return { ok: true, json: async () => ({ entries: [] }) };
        if (url === "/api/issues") return { ok: true, json: async () => ({ issues: [] }) };
        return { ok: true, json: async () => ({}) };
      }),
    );
    render(<ReportsPage />, { wrapper: createWrapper() });
    expect(await screen.findByRole("heading", { name: "直近のAIレビュー" })).toBeInTheDocument();
    expect(screen.getByText("既存のレビュー結果")).toBeInTheDocument();
  });
});
