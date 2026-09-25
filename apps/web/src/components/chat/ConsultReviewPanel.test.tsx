import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "@/router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConsultReviewPanel } from "./ConsultReviewPanel";
import type { AgentRun } from "@emther/core/agent-runtime";
import type { Suggestion } from "@emther/core/types";

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

function baseRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: "run-consult-1",
    agentName: "Lead Agent",
    task: "相談タスク",
    status: "idle",
    log: [],
    totalCostUsd: 0,
    createdAt: 1000,
    updatedAt: 2000,
    origin: "manual",
    reviewed: false,
    ...overrides,
  };
}

function baseSuggestion(overrides: Partial<Suggestion> = {}): Suggestion {
  return {
    id: "suggestion-1",
    title: "既存の提案タイトル",
    createdAt: 1000,
    updatedAt: 2000,
    reviewStatus: "unreviewed",
    confirmPriority: "normal",
    memos: [],
    ...overrides,
  };
}

function renderPanel(ui: React.ReactElement, initialEntries: string[] = ["/chat"]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <LocationProbe />
        {ui}
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function emptyProposal(overrides: Partial<NonNullable<AgentRun["proposal"]>> = {}): NonNullable<AgentRun["proposal"]> {
  return {
    conclusion: "結論です",
    facts: [],
    logic: "ロジック",
    rejectedAlternatives: [],
    expansions: [],
    challenges: [],
    explorations: [],
    ...overrides,
  };
}

describe("ConsultReviewPanel - 提案済み候補の再追加防止", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ themes: [] }) }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const defaultProps = {
    selectedRun: baseRun({
      proposal: emptyProposal({
        suggestionCandidates: [
          { title: "候補A: 1on1の改善", rationale: "理由A" },
          { title: "候補B: 評価基準の統一", rationale: "理由B" },
        ],
      }),
    }),
    sourceJournal: null,
    suggestionCandidates: [
      { title: "候補A: 1on1の改善", rationale: "理由A" },
      { title: "候補B: 評価基準の統一", rationale: "理由B" },
    ],
    candidatePick: null,
    setCandidatePick: vi.fn(),
    stale: false,
    fetchWithNameConfirm: vi.fn(),
    refreshRuns: vi.fn().mockResolvedValue(undefined),
    refreshSuggestions: vi.fn().mockResolvedValue(undefined),
    suggestions: [],
  };

  it("まだ提案化されていない候補は選択可能でバッジなし", () => {
    renderPanel(<ConsultReviewPanel {...defaultProps} />);
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[0]).toBeEnabled();
    expect(checkboxes[0]).toBeChecked();
    expect(checkboxes[1]).toBeEnabled();
    expect(checkboxes[1]).toBeChecked();
    expect(screen.queryByText("提案済み")).not.toBeInTheDocument();
  });

  it("すでに提案化された候補はチェック不可かつ「提案済み」バッジがつく", () => {
    const suggestionsWithCandidateA = [
      baseSuggestion({
        id: "suggestion-created-1",
        title: "候補A: 1on1の改善",
        sourceRunId: "run-consult-1",
      }),
    ];

    renderPanel(
      <ConsultReviewPanel
        {...defaultProps}
        suggestions={suggestionsWithCandidateA}
      />,
    );

    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(2);
    // 候補Aは提案済みのため disabled かつ uncheck
    expect(checkboxes[0]).toBeDisabled();
    expect(checkboxes[0]).not.toBeChecked();
    // 候補Bはまだ選択可能
    expect(checkboxes[1]).toBeEnabled();
    expect(checkboxes[1]).toBeChecked();

    expect(screen.getByText("提案済み")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /選択した1件を提案として残す/ })).toBeEnabled();
  });

  it("すべての候補が提案済みの場合はボタンが無効化される", () => {
    const suggestionsAllCandidates = [
      baseSuggestion({ id: "i1", title: "候補A: 1on1の改善", sourceRunId: "run-consult-1" }),
      baseSuggestion({ id: "i2", title: "候補B: 評価基準の統一", sourceRunId: "run-consult-1" }),
    ];

    renderPanel(
      <ConsultReviewPanel
        {...defaultProps}
        suggestions={suggestionsAllCandidates}
      />,
    );

    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes[0]).toBeDisabled();
    expect(checkboxes[1]).toBeDisabled();
    expect(screen.getAllByText("提案済み")).toHaveLength(2);

    const button = screen.getByRole("button", { name: /すべての候補を提案済み/ });
    expect(button).toBeDisabled();
  });

  it("単一候補で既に提案化されている場合はボタンが「提案済み」となり無効化される", () => {
    const singleRun = baseRun({
      proposal: {
        conclusion: "単一結論",
        facts: [],
        logic: "ロジック",
        rejectedAlternatives: [],
        expansions: [],
        challenges: [],
        explorations: [],
        suggestionCandidates: [{ title: "単一候補", rationale: "理由" }],
      },
    });

    const suggestionsSingle = [
      baseSuggestion({ id: "i1", title: "単一候補", sourceRunId: "run-consult-1" }),
    ];

    renderPanel(
      <ConsultReviewPanel
        {...defaultProps}
        selectedRun={singleRun}
        suggestionCandidates={[{ title: "単一候補", rationale: "理由" }]}
        suggestions={suggestionsSingle}
      />,
    );

    const button = screen.getByRole("button", { name: "📌 提案済み" });
    expect(button).toBeDisabled();
  });

  it("reviewedがtrueなだけ（手動相談は常にtrue）では提案化済み扱いにならない", () => {
    // 手動相談（origin: "manual"）はreviewed: trueで作られるが、それだけでは
    // 実際に提案が作られたことを意味しない。「この相談への結論」バッジも
    // 「提案として残す」ボタンの活性状態も、reviewedではなく実際の提案有無で判定する。
    const reviewedButNotPromotedRun = baseRun({
      reviewed: true,
      proposal: {
        conclusion: "結論です",
        facts: [],
        logic: "ロジック",
        rejectedAlternatives: [],
        expansions: [],
        challenges: [],
        explorations: [],
        suggestionCandidates: [{ title: "単一候補", rationale: "理由" }],
      },
    });

    renderPanel(
      <ConsultReviewPanel
        {...defaultProps}
        selectedRun={reviewedButNotPromotedRun}
        suggestionCandidates={[{ title: "単一候補", rationale: "理由" }]}
        suggestions={[]}
      />,
    );

    expect(screen.queryByText("提案化済み")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "📌 提案として残す" })).toBeEnabled();
  });
});

describe("ConsultReviewPanel - 様子見の継続", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ themes: [] }) }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const proposalRun = baseRun({
    proposal: emptyProposal({
      suggestionCandidates: [{ title: "単一候補", rationale: "理由" }],
    }),
  });

  const baseProps = {
    sourceJournal: null,
    suggestionCandidates: [{ title: "単一候補", rationale: "理由" }],
    candidatePick: null,
    setCandidatePick: vi.fn(),
    stale: false,
    fetchWithNameConfirm: vi.fn(),
    refreshRuns: vi.fn().mockResolvedValue(undefined),
    refreshSuggestions: vi.fn().mockResolvedValue(undefined),
    suggestions: [],
  };

  it("未トリアージなら「様子見する」と表示する", () => {
    renderPanel(<ConsultReviewPanel {...baseProps} selectedRun={proposalRun} />);
    expect(screen.getByRole("button", { name: "👀 様子見する" })).toBeInTheDocument();
  });

  it("様子見中なら「継続して様子見する」と表示し、押すとwatchingを再設定できる", async () => {
    const watchingRun = { ...proposalRun, triageStatus: "watching" as const, triageAt: 1000, reviewed: true };
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/themes") return Promise.resolve({ ok: true, json: async () => ({ themes: [] }) });
      return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
    });
    vi.stubGlobal("fetch", mockFetch);
    const refreshRuns = vi.fn().mockResolvedValue(undefined);

    renderPanel(
      <ConsultReviewPanel {...baseProps} selectedRun={watchingRun} refreshRuns={refreshRuns} />,
    );

    const button = screen.getByRole("button", { name: "👀 継続して様子見する" });
    button.click();

    await vi.waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/agents/run-consult-1/review",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ triageStatus: "watching" }),
        }),
      );
      expect(refreshRuns).toHaveBeenCalled();
    });
  });
});

describe("ConsultReviewPanel - テーマ壁打ちからの定着", () => {
  const themeProposalRun = baseRun({
    consultIntent: "theme",
    proposal: emptyProposal({
      conclusion: "テックリードの自立を進める",
      suggestionTitle: "テックリード自立支援",
      logic: "ボトルネック解消のため",
      suggestionCandidates: [{ title: "テックリード自立支援", rationale: "理由" }],
    }),
  });

  const baseProps = {
    sourceJournal: null,
    suggestionCandidates: [{ title: "テックリード自立支援", rationale: "理由" }],
    candidatePick: null,
    setCandidatePick: vi.fn(),
    stale: false,
    fetchWithNameConfirm: vi.fn(),
    refreshRuns: vi.fn().mockResolvedValue(undefined),
    refreshSuggestions: vi.fn().mockResolvedValue(undefined),
    suggestions: [],
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("通常相談ではテーマ定着CTAを出さない", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ themes: [] }) }),
    );
    renderPanel(
      <ConsultReviewPanel
        {...baseProps}
        selectedRun={baseRun({
          proposal: emptyProposal({
            suggestionCandidates: [{ title: "単一候補", rationale: "理由" }],
          }),
        })}
        suggestionCandidates={[{ title: "単一候補", rationale: "理由" }]}
      />,
    );
    expect(screen.queryByRole("button", { name: /テーマとして定着/ })).not.toBeInTheDocument();
  });

  it("consultIntent=theme ならテーマ定着CTAを出す", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ themes: [] }) }),
    );
    renderPanel(<ConsultReviewPanel {...baseProps} selectedRun={themeProposalRun} />);
    expect(await screen.findByRole("button", { name: "🎯 テーマとして定着" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "📌 提案として残す" })).toBeInTheDocument();
  });

  it("テーマ定着を押すとPOST /api/themesしてThemesへ遷移する", async () => {
    const user = userEvent.setup();
    const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/themes" && init?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            theme: {
              id: "theme-new",
              title: "テックリード自立支援",
              summary: "テックリードの自立を進める",
              rationale: "ボトルネック解消のため",
              facts: [],
              evidenceJournalIds: [],
              evidenceSuggestionIds: [],
              status: "adopted",
              sourceRunId: "run-consult-1",
              sortOrder: 0,
              createdAt: 1,
              updatedAt: 1,
            },
          }),
        });
      }
      if (url === "/api/themes") {
        return Promise.resolve({ ok: true, json: async () => ({ themes: [] }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    vi.stubGlobal("fetch", mockFetch);

    renderPanel(<ConsultReviewPanel {...baseProps} selectedRun={themeProposalRun} />, [
      "/chat?runId=run-consult-1",
    ]);

    await user.click(await screen.findByRole("button", { name: "🎯 テーマとして定着" }));

    await vi.waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/themes",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"sourceRunId":"run-consult-1"'),
        }),
      );
    });
    expect(await screen.findByTestId("location")).toHaveTextContent("/org?section=themes&themeId=theme-new");
  });

  it("作成済みテーマがあればリンクを表示しボタンを無効化する", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          themes: [
            {
              id: "theme-1",
              title: "テックリード自立支援",
              summary: "要約",
              rationale: "理由",
              facts: [],
              evidenceJournalIds: [],
              evidenceSuggestionIds: [],
              status: "adopted",
              sourceRunId: "run-consult-1",
              sortOrder: 0,
              createdAt: 1,
              updatedAt: 1,
            },
          ],
        }),
      }),
    );

    renderPanel(<ConsultReviewPanel {...baseProps} selectedRun={themeProposalRun} />);

    expect(await screen.findByRole("button", { name: "🎯 テーマ作成済み" })).toBeDisabled();
    const link = await screen.findByRole("link", { name: /テックリード自立支援/ });
    expect(link).toHaveAttribute("href", "/org?section=themes&themeId=theme-1");
  });
});

describe("ConsultReviewPanel - エラー時のリセットと再分析", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ themes: [] }) }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sourceJournalIdがない手動相談でもstatusがerrorならリセットボタンを表示する", () => {
    const errorRun = baseRun({
      status: "error",
      sourceJournalId: undefined,
      origin: "manual",
    });

    renderPanel(
      <ConsultReviewPanel
        selectedRun={errorRun}
        sourceJournal={null}
        suggestionCandidates={[]}
        candidatePick={null}
        setCandidatePick={vi.fn()}
        stale={false}
        fetchWithNameConfirm={vi.fn()}
        refreshRuns={vi.fn().mockResolvedValue(undefined)}
        refreshSuggestions={vi.fn().mockResolvedValue(undefined)}
        suggestions={[]}
      />,
    );

    expect(screen.getByRole("button", { name: "🔁 相談をリセットして再分析する" })).toBeInTheDocument();
    expect(screen.getByText(/この相談はエラーで停止しています/)).toBeInTheDocument();
  });

  it("手動相談でリセットを押すとアーカイブ後に/api/agentsで再分析が起動される", async () => {
    const errorRun = baseRun({
      id: "error-run-123",
      status: "error",
      task: "検証タスクです",
      agentName: "Lead Agent",
      sourceJournalId: undefined,
      origin: "manual",
    });

    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/review")) {
        return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
      }
      if (url === "/api/themes") {
        return Promise.resolve({ ok: true, json: async () => ({ themes: [] }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    vi.stubGlobal("fetch", mockFetch);

    const mockFetchWithNameConfirm = vi.fn().mockResolvedValue({
      res: { ok: true },
      data: { run: { id: "new-run-456" } },
    });
    const onReanalyzed = vi.fn();
    const refreshRuns = vi.fn().mockResolvedValue(undefined);

    renderPanel(
      <ConsultReviewPanel
        selectedRun={errorRun}
        sourceJournal={null}
        suggestionCandidates={[]}
        candidatePick={null}
        setCandidatePick={vi.fn()}
        stale={false}
        fetchWithNameConfirm={mockFetchWithNameConfirm}
        refreshRuns={refreshRuns}
        refreshSuggestions={vi.fn().mockResolvedValue(undefined)}
        suggestions={[]}
        onReanalyzed={onReanalyzed}
      />,
    );

    const button = screen.getByRole("button", { name: "🔁 相談をリセットして再分析する" });
    button.click();

    await vi.waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/agents/error-run-123/review",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ archived: true }),
        }),
      );
      expect(mockFetchWithNameConfirm).toHaveBeenCalledWith(
        "/api/agents",
        expect.objectContaining({
          method: "POST",
          body: { agentName: "Lead Agent", task: "検証タスクです" },
        }),
        "送信する",
      );
      expect(onReanalyzed).toHaveBeenCalledWith("new-run-456");
    });
  });
});
