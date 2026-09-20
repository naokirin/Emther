import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { StrategyThreadTree } from "./StrategyThreadTree";
import type { Issue, JournalEntry, ObjectiveWithProgress } from "@emther/core/types";

// web/src/components/org/StrategyThreadTree.test.tsx（Next.js版）からの移植（フェーズ3.5
// tier3、org/threadバッチ）。SuggestionLink/next→react-routerのLinkがRouter contextを
// 要求するためMemoryRouterで包む以外は検証内容を変更していない。
function baseIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "issue-1",
    title: "Bチーム1on1不足",
    charter: { why: "", what: "", how: "" },
    actionItems: [],
    logEntries: [],
    status: "in_progress",
    reviewStatus: "unreviewed",
    priority: "normal",
    archived: false,
    tags: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as Issue;
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
  } as JournalEntry;
}

const objectives: ObjectiveWithProgress[] = [
  {
    id: "obj-1",
    title: "エンジニア満足度向上",
    keyResults: [{ id: "kr-1", title: "1on1カバレッジ90%" }],
    createdAt: 0,
    updatedAt: 0,
    progress: [{ keyResultId: "kr-1", total: 1 }],
  } as ObjectiveWithProgress,
];

// jsdom（テスト環境）にはscrollIntoViewが実装されていないため、?objective=自動展開の
// スクロール副作用が例外にならないようスタブする。
Element.prototype.scrollIntoView = () => {};

function renderTree(props: React.ComponentProps<typeof StrategyThreadTree>) {
  return render(
    <MemoryRouter>
      <StrategyThreadTree {...props} />
    </MemoryRouter>,
  );
}

describe("StrategyThreadTree", () => {
  it("ロード中は読み込み中と表示する", () => {
    renderTree({ objectives: [], objectivesLoaded: false, issues: [], journalEntries: [], focusObjectiveId: null });
    expect(screen.getByText("読み込み中…")).toBeInTheDocument();
  });

  it("Objectiveが無ければ空状態を表示する", () => {
    renderTree({ objectives: [], objectivesLoaded: true, issues: [], journalEntries: [], focusObjectiveId: null });
    expect(screen.getByText(/Objectiveがまだ登録されていません/)).toBeInTheDocument();
  });

  it("Objectiveを開くとKR › Issue › Journalが辿れる", async () => {
    const user = userEvent.setup();
    const issue = baseIssue({ keyResultId: "kr-1" });
    const journal = baseJournal({ resolvedIssueId: issue.id });

    renderTree({ objectives, objectivesLoaded: true, issues: [issue], journalEntries: [journal], focusObjectiveId: null });

    expect(screen.queryByText(issue.title)).not.toBeInTheDocument();

    await user.click(screen.getByText(/エンジニア満足度向上/));

    expect(screen.getByText(/1on1カバレッジ90%/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: new RegExp(issue.title) })).toHaveAttribute(
      "href",
      `/suggestions/${issue.id}`,
    );
    expect(screen.getByRole("link", { name: /Bさんと1on1/ })).toHaveAttribute(
      "href",
      `/journal?focus=${journal.id}`,
    );
  });

  it("?objective=で対象Objectiveが自動展開される", () => {
    const issue = baseIssue({ keyResultId: "kr-1" });
    renderTree({ objectives, objectivesLoaded: true, issues: [issue], journalEntries: [], focusObjectiveId: "obj-1" });
    expect(screen.getByText(new RegExp(issue.title))).toBeInTheDocument();
  });

  it("提案の横には旧Issueワークフローの status ではなく確認状態(reviewStatus)を表示する", async () => {
    const user = userEvent.setup();
    const issue = baseIssue({ keyResultId: "kr-1", status: "in_progress", reviewStatus: "deferred" });

    renderTree({ objectives, objectivesLoaded: true, issues: [issue], journalEntries: [], focusObjectiveId: null });
    await user.click(screen.getByText(/エンジニア満足度向上/));

    expect(screen.getByText(/確認保留/)).toBeInTheDocument();
    expect(screen.queryByText(/進行中/)).not.toBeInTheDocument();
  });
});
