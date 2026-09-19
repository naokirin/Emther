// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConsultReviewPanel } from "./ConsultReviewPanel";
import type { AgentRun } from "@/components/RunDetail";
import type { Issue } from "@core/types";

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

function baseIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "issue-1",
    title: "既存の提案タイトル",
    status: "in_progress",
    priority: "normal",
    createdAt: 1000,
    updatedAt: 2000,
    reviewStatus: "unreviewed",
    archived: false,
    tags: [],
    charter: { why: "", what: "", how: "" },
    actionItems: [],
    logEntries: [],
    ...overrides,
  };
}

describe("ConsultReviewPanel - 提案済み候補の再追加防止", () => {
  const defaultProps = {
    selectedRun: baseRun({
      proposal: {
        conclusion: "結論です",
        facts: [],
        logic: "ロジック",
        rejectedAlternatives: [],
        expansions: [],
        challenges: [],
        issueCandidates: [
          { title: "候補A: 1on1の改善", rationale: "理由A" },
          { title: "候補B: 評価基準の統一", rationale: "理由B" },
        ],
      },
    }),
    sourceJournal: null,
    issueCandidates: [
      { title: "候補A: 1on1の改善", rationale: "理由A" },
      { title: "候補B: 評価基準の統一", rationale: "理由B" },
    ],
    candidatePick: null,
    setCandidatePick: vi.fn(),
    stale: false,
    fetchWithNameConfirm: vi.fn(),
    refreshRuns: vi.fn().mockResolvedValue(undefined),
    refreshIssues: vi.fn().mockResolvedValue(undefined),
    issues: [],
  };

  it("まだ提案化されていない候補は選択可能でバッジなし", () => {
    render(<ConsultReviewPanel {...defaultProps} />);
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[0]).toBeEnabled();
    expect(checkboxes[0]).toBeChecked();
    expect(checkboxes[1]).toBeEnabled();
    expect(checkboxes[1]).toBeChecked();
    expect(screen.queryByText("提案済み")).not.toBeInTheDocument();
  });

  it("すでに提案化された候補はチェック不可かつ「提案済み」バッジがつく", () => {
    const issuesWithCandidateA = [
      baseIssue({
        id: "issue-created-1",
        title: "候補A: 1on1の改善",
        sourceRunId: "run-consult-1",
      }),
    ];

    render(
      <ConsultReviewPanel
        {...defaultProps}
        issues={issuesWithCandidateA}
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
    const issuesAllCandidates = [
      baseIssue({ id: "i1", title: "候補A: 1on1の改善", sourceRunId: "run-consult-1" }),
      baseIssue({ id: "i2", title: "候補B: 評価基準の統一", sourceRunId: "run-consult-1" }),
    ];

    render(
      <ConsultReviewPanel
        {...defaultProps}
        issues={issuesAllCandidates}
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
        issueCandidates: [{ title: "単一候補", rationale: "理由" }],
      },
    });

    const issuesSingle = [
      baseIssue({ id: "i1", title: "単一候補", sourceRunId: "run-consult-1" }),
    ];

    render(
      <ConsultReviewPanel
        {...defaultProps}
        selectedRun={singleRun}
        issueCandidates={[{ title: "単一候補", rationale: "理由" }]}
        issues={issuesSingle}
      />,
    );

    const button = screen.getByRole("button", { name: "📌 提案済み" });
    expect(button).toBeDisabled();
  });
});

describe("ConsultReviewPanel - エラー時のリセットと再分析", () => {
  it("sourceJournalIdがない手動相談でもstatusがerrorならリセットボタンを表示する", () => {
    const errorRun = baseRun({
      status: "error",
      sourceJournalId: undefined,
      origin: "manual",
    });

    render(
      <ConsultReviewPanel
        selectedRun={errorRun}
        sourceJournal={null}
        issueCandidates={[]}
        candidatePick={null}
        setCandidatePick={vi.fn()}
        stale={false}
        fetchWithNameConfirm={vi.fn()}
        refreshRuns={vi.fn().mockResolvedValue(undefined)}
        refreshIssues={vi.fn().mockResolvedValue(undefined)}
        issues={[]}
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
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    vi.stubGlobal("fetch", mockFetch);

    const mockFetchWithNameConfirm = vi.fn().mockResolvedValue({
      res: { ok: true },
      data: { run: { id: "new-run-456" } },
    });
    const onReanalyzed = vi.fn();
    const refreshRuns = vi.fn().mockResolvedValue(undefined);

    render(
      <ConsultReviewPanel
        selectedRun={errorRun}
        sourceJournal={null}
        issueCandidates={[]}
        candidatePick={null}
        setCandidatePick={vi.fn()}
        stale={false}
        fetchWithNameConfirm={mockFetchWithNameConfirm}
        refreshRuns={refreshRuns}
        refreshIssues={vi.fn().mockResolvedValue(undefined)}
        issues={[]}
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

    vi.unstubAllGlobals();
  });
});

