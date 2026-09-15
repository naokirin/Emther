// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrategyThreadTree } from "./StrategyThreadTree";
import type { Issue, JournalEntry, ObjectiveWithProgress } from "@/lib/types";

function baseIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "issue-1",
    title: "Bチーム1on1不足",
    charter: { why: "", what: "", how: "" },
    actionItems: [],
    logEntries: [],
    status: "in_progress",
    priority: "normal",
    archived: false,
    tags: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function baseJournal(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id: "journal-1",
    rawText: "9/10 Bさんと1on1。負荷が高いとのこと",
    tags: [],
    people: [],
    teamIds: [],
    urgency: "mid",
    sentiment: "negative",
    summary: "",
    createdAt: 1,
    confirmed: true,
    ...overrides,
  };
}

const objectives: ObjectiveWithProgress[] = [
  {
    id: "obj-1",
    title: "エンジニア満足度向上",
    keyResults: [{ id: "kr-1", title: "1on1カバレッジ90%" }],
    createdAt: 0,
    updatedAt: 0,
    progress: [{ keyResultId: "kr-1", total: 1 }],
  },
];

// jsdom（テスト環境）にはscrollIntoViewが実装されていないため（@/components/Select.tsxの
// 既存コメントと同じ理由）、?objective=自動展開のスクロール副作用が例外にならないようスタブする。
Element.prototype.scrollIntoView = () => {};

describe("StrategyThreadTree", () => {
  it("ロード中は読み込み中と表示する", () => {
    render(
      <StrategyThreadTree
        objectives={[]}
        objectivesLoaded={false}
        issues={[]}
        journalEntries={[]}
        focusObjectiveId={null}
      />,
    );
    expect(screen.getByText("読み込み中…")).toBeInTheDocument();
  });

  it("Objectiveが無ければ空状態を表示する", () => {
    render(
      <StrategyThreadTree
        objectives={[]}
        objectivesLoaded={true}
        issues={[]}
        journalEntries={[]}
        focusObjectiveId={null}
      />,
    );
    expect(screen.getByText(/Objectiveがまだ登録されていません/)).toBeInTheDocument();
  });

  it("Objectiveを開くとKR › Issue › Journalが辿れる", async () => {
    const user = userEvent.setup();
    const issue = baseIssue({ keyResultId: "kr-1" });
    const journal = baseJournal({ resolvedIssueId: issue.id });

    render(
      <StrategyThreadTree
        objectives={objectives}
        objectivesLoaded={true}
        issues={[issue]}
        journalEntries={[journal]}
        focusObjectiveId={null}
      />,
    );

    expect(screen.queryByText(issue.title)).not.toBeInTheDocument();

    await user.click(screen.getByText(/エンジニア満足度向上/));

    expect(screen.getByText(/1on1カバレッジ90%/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: new RegExp(issue.title) })).toHaveAttribute(
      "href",
      `/issues/${issue.id}`,
    );
    expect(screen.getByRole("link", { name: /Bさんと1on1/ })).toHaveAttribute(
      "href",
      `/journal?focus=${journal.id}`,
    );
  });

  it("?objective=で対象Objectiveが自動展開される", () => {
    const issue = baseIssue({ keyResultId: "kr-1" });

    render(
      <StrategyThreadTree
        objectives={objectives}
        objectivesLoaded={true}
        issues={[issue]}
        journalEntries={[]}
        focusObjectiveId="obj-1"
      />,
    );

    expect(screen.getByText(new RegExp(issue.title))).toBeInTheDocument();
  });
});
