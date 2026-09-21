import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { PersonDetailContent } from "./PersonDetailContent";

// web/src/components/PersonDetailContent.tsx（Next.js版）には専用テストが元々無かった
// ため新規に追加する（フェーズ3.5 tier2、人物バッチ）。usePersonProfile/
// usePersonEvaluationLogs/usePeople/useTeamsがTanStack Query化されているため
// QueryClientProviderで包む。
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

describe("PersonDetailContent", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/people/p1") {
          return {
            ok: true,
            json: async () => ({
              person: {
                id: "p1",
                name: "田中さん",
                aliases: ["たなか"],
                teamNames: ["Design"],
                trend: { positive: 2, negative: 0, neutral: 0 },
                factCount: 2,
                isDirectReport: true,
                isSelf: false,
                hasConcerningSuggestion: false,
                facts: [],
                interpretations: [],
                relatedSuggestions: [],
              },
            }),
          };
        }
        if (url === "/api/people/p1/evaluation-logs") return { ok: true, json: async () => ({ logs: [] }) };
        if (url === "/api/people") return { ok: true, json: async () => ({ people: [{ id: "p2", name: "鈴木さん" }] }) };
        if (url === "/api/teams") return { ok: true, json: async () => ({ teams: [] }) };
        return { ok: true, json: async () => ({}) };
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("読み込み中はローディング表示、完了後は人物名・セクション見出しを表示する", async () => {
    render(<PersonDetailContent id="p1" />, { wrapper: createWrapper() });
    expect(screen.getByText("読み込み中…")).toBeInTheDocument();

    expect(await screen.findByRole("heading", { name: "田中さん" })).toBeInTheDocument();
    expect(screen.getByText("所属チーム")).toBeInTheDocument();
    expect(screen.getByText("別名（表記揺れ）")).toBeInTheDocument();
    expect(screen.getByText("重複を統合")).toBeInTheDocument();
    expect(screen.getByText("日常の評価ログ（目標貢献 / Value）")).toBeInTheDocument();
    expect(screen.getByText("長期プロファイル（解釈、TTLなし）")).toBeInTheDocument();
  });

  it("該当する人物が見つからない場合はその旨を表示する", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/people/missing") return { ok: true, json: async () => ({ person: null }) };
        return { ok: true, json: async () => ({}) };
      }),
    );
    render(<PersonDetailContent id="missing" />, { wrapper: createWrapper() });
    await waitFor(() => expect(screen.getByText("該当する人物が見つかりませんでした。")).toBeInTheDocument());
  });
});
