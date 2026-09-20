import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { GrowSuggestionsPanel } from "./GrowSuggestionsPanel";

// web/src/components/growth/GrowSuggestionsPanel.tsx（Next.js版）には専用テストが
// 元々無かったため新規に追加する（フェーズ3.5 tier3 growthバッチ）。useGrowSuggestions/
// useRunsがTanStack Query化されているためQueryClientProviderで包む。
function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

const SUGGESTION = {
  id: "gs1",
  weekKey: "2026-W38",
  title: "1on1の頻度を見直す",
  rationale: "直近のJournalで負荷の偏りが観測された",
  references: [],
  status: "unread" as const,
  generatedAt: Date.now(),
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GrowSuggestionsPanel", () => {
  it("開くと件数・提案一覧を表示する", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/growth/suggestions") return { ok: true, json: async () => ({ suggestions: [SUGGESTION] }) };
        if (url === "/api/agents") return { ok: true, json: async () => ({ runs: [], pendingAgentStarts: [], pendingUnmaskedSends: [] }) };
        return { ok: true, json: async () => ({}) };
      }),
    );
    const user = userEvent.setup();
    render(<GrowSuggestionsPanel />, { wrapper: createWrapper() });

    await waitFor(() => expect(screen.getByText("1件")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /AIからの学びの提案/ }));
    expect(screen.getByText("1on1の頻度を見直す")).toBeInTheDocument();
  });

  it("確認済みにするとPATCHし、一覧に反映する", async () => {
    const updated = { ...SUGGESTION, status: "acknowledged" as const };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/growth/suggestions/gs1" && init?.method === "PATCH") {
        return { ok: true, json: async () => ({ suggestion: updated }) };
      }
      if (url === "/api/growth/suggestions") return { ok: true, json: async () => ({ suggestions: [SUGGESTION] }) };
      if (url === "/api/agents") return { ok: true, json: async () => ({ runs: [], pendingAgentStarts: [], pendingUnmaskedSends: [] }) };
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<GrowSuggestionsPanel />, { wrapper: createWrapper() });
    await user.click(await screen.findByRole("button", { name: /AIからの学びの提案/ }));
    await screen.findByText("1on1の頻度を見直す");

    await user.click(screen.getByRole("button", { name: "確認済みにする" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/growth/suggestions/gs1",
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ status: "acknowledged" }) }),
      ),
    );
    expect(screen.queryByText("未確認")).not.toBeInTheDocument();
  });
});
