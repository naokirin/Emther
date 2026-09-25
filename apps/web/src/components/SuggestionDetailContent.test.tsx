import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "@/router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { SuggestionDetailContent } from "./SuggestionDetailContent";
import type { Suggestion } from "@emther/core/types";
import { copyTextToClipboard } from "../lib/clipboard";

vi.mock("../lib/clipboard", () => ({
  copyTextToClipboard: vi.fn(async () => true),
}));

// 確認状態のPATCH（ミューテーション後の再取得）とメモ追記の主要フローに絞って検証する
// （画面の他の細部はRunDetail.test.tsx等で
// 個別に検証済み）

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

function baseSuggestion(overrides: Partial<Suggestion> = {}): Suggestion {
  return {
    id: "sug-1",
    title: "提案タイトル",
    reviewStatus: "unreviewed",
    confirmPriority: "normal",
    memos: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("SuggestionDetailContent", () => {
  let suggestion: Suggestion;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    suggestion = baseSuggestion();
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (url === "/api/suggestions/sug-1" && method === "GET") {
        return { ok: true, json: async () => ({ suggestion, sourceJournals: [] }) };
      }
      if (url === "/api/suggestions/sug-1" && method === "PATCH") {
        const body = JSON.parse(String(init?.body));
        suggestion = { ...suggestion, ...body };
        return { ok: true, json: async () => ({ suggestion }) };
      }
      if (url === "/api/suggestions/sug-1/memo" && method === "POST") {
        const body = JSON.parse(String(init?.body));
        suggestion = {
          ...suggestion,
          memos: [...suggestion.memos, { id: "m1", text: body.text, createdAt: 1, source: "user" as const }],
        };
        return { ok: true, json: async () => ({ suggestion }) };
      }
      if (url === "/api/suggestions") return { ok: true, json: async () => ({ suggestions: [] }) };
      if (url === "/api/agents") return { ok: true, json: async () => ({ runs: [], pendingAgentStarts: [], pendingUnmaskedSends: [] }) };
      if (url === "/api/org/goals") return { ok: true, json: async () => ({ goals: [] }) };
      if (url === "/api/teams") return { ok: true, json: async () => ({ teams: [] }) };
      if (url === "/api/themes") return { ok: true, json: async () => ({ themes: [] }) };
      if (url === "/api/settings/rules") return { ok: true, json: async () => ({ rules: {} }) };
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(copyTextToClipboard).mockClear();
  });

  it("提案のタイトルを表示する", async () => {
    render(<SuggestionDetailContent id="sug-1" />, { wrapper: createWrapper() });
    expect(await screen.findByText("提案タイトル")).toBeInTheDocument();
  });

  it("Markdown をコピーすると提案本文をクリップボードへ書く", async () => {
    suggestion = baseSuggestion({
      detail: {
        conclusion: "結論",
        facts: ["事実"],
        logic: "ロジック",
        updatedAt: 1,
      },
    });
    const user = userEvent.setup();
    render(<SuggestionDetailContent id="sug-1" />, { wrapper: createWrapper() });
    await user.click(await screen.findByRole("button", { name: /^エクスポート/ }));
    await user.click(screen.getByRole("menuitem", { name: "Markdown をコピー" }));
    expect(copyTextToClipboard).toHaveBeenCalled();
    const text = vi.mocked(copyTextToClipboard).mock.calls[0]![0];
    expect(text).toContain("# 提案タイトル");
    expect(text).toContain("## 結論\n結論");
    expect(text).toContain("Emther ID: sug-1");
    expect(text).toMatch(/Emther URL: https?:\/\/.+\/suggestions\/sug-1/);
  });

  it("Agent Runが無ければその旨を表示する", async () => {
    render(<SuggestionDetailContent id="sug-1" />, { wrapper: createWrapper() });
    await screen.findByText("提案タイトル");
    expect(screen.getByText(/この提案に紐づく Agent Run はありません/)).toBeInTheDocument();
  });

  it("確認状態を変更するとPATCHして再取得する", async () => {
    const user = userEvent.setup();
    render(<SuggestionDetailContent id="sug-1" />, { wrapper: createWrapper() });
    await screen.findByText("提案タイトル");

    const combobox = screen.getByRole("combobox", { name: "確認状態" });
    await user.click(combobox);
    await user.click(screen.getByRole("option", { name: /🔎 確認中/ }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/suggestions/sug-1",
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ reviewStatus: "in_review" }) }),
      ),
    );
  });

  it("メモを追記できる", async () => {
    const user = userEvent.setup();
    render(<SuggestionDetailContent id="sug-1" />, { wrapper: createWrapper() });
    await screen.findByText("提案タイトル");

    await user.type(screen.getByPlaceholderText(/考えたこと・確認したこと/), "来週の1on1で触れる");
    await user.click(screen.getByRole("button", { name: "追記" }));

    expect(await screen.findByText("来週の1on1で触れる")).toBeInTheDocument();
    expect(screen.getByText("自分")).toBeInTheDocument();
    expect(screen.queryByText("まだメモはありません。")).not.toBeInTheDocument();
  });

  it("出所バッジをAIと自分で出し分ける", async () => {
    suggestion = baseSuggestion({
      memos: [
        { id: "m-user", text: "手入力メモ", createdAt: 2, source: "user" },
        { id: "m-agent", text: "AI追記メモ", createdAt: 1, source: "agent" },
        { id: "m-legacy", text: "旧メモ", createdAt: 0 },
      ],
    });
    render(<SuggestionDetailContent id="sug-1" />, { wrapper: createWrapper() });
    await screen.findByText("手入力メモ");
    expect(screen.getByText("自分")).toBeInTheDocument();
    expect(screen.getByText("AI")).toBeInTheDocument();
    expect(screen.getByText("旧メモ")).toBeInTheDocument();
  });

  it("詳細を結論・進め方 / 問い直し / 探索 / 根拠のタブで切り替える", async () => {
    suggestion = baseSuggestion({
      detail: {
        conclusion: "結論本文",
        facts: ["事実A", "事実B"],
        logic: "判断の筋道",
        expansions: ["別視点"],
        challenges: ["前提は妥当か"],
        explorations: [
          {
            kind: "blind_spot",
            observation: "User Valueの観測が少ない",
            relevance: "Goalに成果が含まれる",
            confirmationQuestion: "最近User Valueに変化はありましたか？",
          },
        ],
        updatedAt: 1,
      },
    });
    const user = userEvent.setup();
    render(<SuggestionDetailContent id="sug-1" />, { wrapper: createWrapper() });

    expect(await screen.findByText("結論本文")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "結論・進め方" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "問い直し（2）" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "探索（1）" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "根拠（3）" })).toBeInTheDocument();
    expect(screen.queryByText("別視点")).not.toBeInTheDocument();
    expect(screen.queryByText("事実A")).not.toBeInTheDocument();
    expect(screen.queryByText("User Valueの観測が少ない")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "問い直し（2）" }));
    expect(screen.getByText("別視点")).toBeInTheDocument();
    expect(screen.getByText("前提は妥当か")).toBeInTheDocument();
    expect(screen.queryByText("結論本文")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "探索（1）" }));
    expect(screen.getByText("User Valueの観測が少ない")).toBeInTheDocument();
    expect(screen.getByText("最近User Valueに変化はありましたか？")).toBeInTheDocument();
    expect(screen.getByText("観測の偏り")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "根拠（3）" }));
    expect(screen.getByText("事実A")).toBeInTheDocument();
    expect(screen.getByText("判断の筋道")).toBeInTheDocument();
    expect(screen.queryByText("別視点")).not.toBeInTheDocument();
  });
});
