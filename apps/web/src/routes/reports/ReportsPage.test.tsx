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
// レポート生成・絞り込み・コメント保存の主要フローを検証する。
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

  it("「今週のレポートを作成」でPOSTし、生成後の一覧に反映する", async () => {
    let reports: typeof REPORT[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/reports" && init?.method === "POST") {
        reports = [REPORT];
        return { ok: true, json: async () => ({ report: REPORT }) };
      }
      if (url === "/api/reports") return { ok: true, json: async () => ({ reports }) };
      if (url === "/api/journal") return { ok: true, json: async () => ({ entries: [] }) };
      if (url === "/api/issues") return { ok: true, json: async () => ({ issues: [] }) };
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<ReportsPage />, { wrapper: createWrapper() });
    await screen.findByText(/まだレポートがありません/);

    await user.click(screen.getByRole("button", { name: "今週のレポートを作成" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/reports", expect.objectContaining({ method: "POST" })),
    );
    expect(await screen.findByText(/週次/)).toBeInTheDocument();
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
});
