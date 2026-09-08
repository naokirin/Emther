// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IssueBoard } from "./IssueBoard";
import type { Issue } from "@/lib/types";

function baseIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "issue-1",
    title: "Issue",
    charter: { why: "", what: "", how: "" },
    actionItems: [],
    logEntries: [],
    status: "not_started",
    archived: false,
    tags: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("IssueBoard", () => {
  it("ステータスごとの列にIssueを振り分けて表示する", () => {
    const issues = [
      baseIssue({ id: "a", title: "未着手Issue", status: "not_started" }),
      baseIssue({ id: "b", title: "進行中Issue", status: "in_progress" }),
    ];
    render(<IssueBoard issues={issues} allIssues={issues} now={Date.now()} staleInterventionDays={14} onSelect={vi.fn()} />);
    expect(screen.getByText("未着手Issue")).toBeInTheDocument();
    expect(screen.getByText("進行中Issue")).toBeInTheDocument();
  });

  it("カードが無い列には「なし」を表示する", () => {
    render(<IssueBoard issues={[]} allIssues={[]} now={Date.now()} staleInterventionDays={14} onSelect={vi.fn()} />);
    expect(screen.getAllByText("なし")).toHaveLength(4);
  });

  it("カードクリックでonSelectにissue idを渡す", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    const issues = [baseIssue({ id: "a", title: "対象Issue" })];
    render(<IssueBoard issues={issues} allIssues={issues} now={Date.now()} staleInterventionDays={14} onSelect={onSelect} />);
    await user.click(screen.getByText("対象Issue"));
    expect(onSelect).toHaveBeenCalledWith("a");
  });

  it("停滞中のIssueには⏳マークを表示する", () => {
    const staleIssue = baseIssue({
      id: "a",
      title: "停滞Issue",
      actionItems: [{ id: "1", text: "x", done: false }],
      updatedAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
    });
    render(<IssueBoard issues={[staleIssue]} allIssues={[staleIssue]} now={Date.now()} staleInterventionDays={14} onSelect={vi.fn()} />);
    expect(screen.getByText(/停滞中/)).toBeInTheDocument();
  });
});
