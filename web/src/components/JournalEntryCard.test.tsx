// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JournalEntryCard } from "./JournalEntryCard";
import type { JournalEntry } from "@/lib/types";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

beforeEach(() => {
  pushMock.mockClear();
});

function baseEntry(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id: "entry-1",
    rawText: "Aさんと1on1した",
    tags: ["1on1"],
    people: ["Aさん"],
    teamIds: [],
    urgency: "mid",
    sentiment: "neutral",
    summary: "",
    createdAt: Date.now(),
    confirmed: true,
    ...overrides,
  };
}

const noop = () => {};
const asyncNoop = async () => undefined;

function baseProps(overrides: Partial<Parameters<typeof JournalEntryCard>[0]> = {}) {
  return {
    entry: baseEntry(),
    editing: false,
    editRawText: "",
    editTags: "",
    editPeople: "",
    editTeams: "",
    editUrgency: "mid" as const,
    editDate: "",
    editSubmitting: false,
    editError: null,
    resolutionNoteDraft: "",
    pending: false,
    onChangeEditRawText: noop,
    onChangeEditTags: noop,
    onChangeEditPeople: noop,
    onChangeEditTeams: noop,
    onChangeEditUrgency: noop,
    onChangeEditDate: noop,
    onChangeResolutionNoteDraft: noop,
    onConfirmEdit: noop,
    onCancelEdit: noop,
    onStartEdit: noop,
    onResolveWithNote: noop,
    onResolveWithNewIssue: asyncNoop,
    onClearResolution: noop,
    onDismissPendingError: noop,
    ...overrides,
  };
}

describe("JournalEntryCard（表示モード）", () => {
  it("本文・タグ・人物・Urgencyを表示する", () => {
    render(<JournalEntryCard {...baseProps()} />);
    expect(screen.getByText("Aさんと1on1した")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "@Aさん" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "#1on1" })).toBeInTheDocument();
    expect(screen.getByText("Urgency: Mid")).toBeInTheDocument();
  });

  it("関連チーム名を表示する", () => {
    render(
      <JournalEntryCard
        {...baseProps({
          entry: baseEntry({ teamIds: ["t1"], teamNames: ["基盤チーム"] }),
        })}
      />,
    );
    expect(screen.getByRole("button", { name: "👥 基盤チーム" })).toBeInTheDocument();
  });

  it("今日の発生日は「今日」と表示する", () => {
    render(<JournalEntryCard {...baseProps({ entry: baseEntry({ createdAt: Date.now() }) })} />);
    expect(screen.getByText(/今日/)).toBeInTheDocument();
  });

  it("昨日の発生日は「昨日」と表示する", () => {
    const yesterday = Date.now() - 24 * 60 * 60 * 1000;
    render(<JournalEntryCard {...baseProps({ entry: baseEntry({ createdAt: yesterday }) })} />);
    expect(screen.getByText(/昨日/)).toBeInTheDocument();
  });

  it("未確認(confirmed:false)のエントリには🤖未確認バッジを出す", () => {
    render(<JournalEntryCard {...baseProps({ entry: baseEntry({ confirmed: false }) })} />);
    expect(screen.getByText(/未確認/)).toBeInTheDocument();
  });

  it("人物タグをクリックすると/chatへ遷移する", async () => {
    const user = userEvent.setup();
    render(<JournalEntryCard {...baseProps()} />);
    await user.click(screen.getByRole("button", { name: "@Aさん" }));
    expect(pushMock).toHaveBeenCalledWith(expect.stringContaining("/chat?prefill="));
  });

  it("resolvedIssueIdがあれば「Issueで追跡中」バッジを表示しクリックでIssueへ遷移する", async () => {
    const user = userEvent.setup();
    render(
      <JournalEntryCard
        {...baseProps({ entry: baseEntry({ resolvedIssueId: "issue-1", resolvedIssueTitle: "追跡中Issue" }) })}
      />,
    );
    const badge = screen.getByRole("button", { name: "✅ Issueで追跡中" });
    expect(badge).toBeInTheDocument();
    await user.click(badge);
    expect(pushMock).toHaveBeenCalledWith("/issues/issue-1");
  });

  it("sourceConsultRunIdがあれば「相談を開く」を表示しクリックで相談へ遷移する", async () => {
    const user = userEvent.setup();
    render(<JournalEntryCard {...baseProps({ entry: baseEntry({ sourceConsultRunId: "run-1" }) })} />);
    await user.click(screen.getByRole("button", { name: "💬 相談を開く" }));
    expect(pushMock).toHaveBeenCalledWith("/chat?runId=run-1");
  });

  it("編集ボタンでonStartEditを呼ぶ", async () => {
    const onStartEdit = vi.fn();
    const user = userEvent.setup();
    render(<JournalEntryCard {...baseProps({ onStartEdit })} />);
    await user.click(screen.getByRole("button", { name: "編集" }));
    expect(onStartEdit).toHaveBeenCalledTimes(1);
  });

  it("未確認なら「この内容で確定」ショートカットを出し、onConfirmAsIsを呼ぶ", async () => {
    const onConfirmAsIs = vi.fn();
    const user = userEvent.setup();
    render(
      <JournalEntryCard
        {...baseProps({ entry: baseEntry({ confirmed: false }), onConfirmAsIs })}
      />,
    );
    await user.click(screen.getByRole("button", { name: "この内容で確定" }));
    expect(onConfirmAsIs).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "分析する" })).not.toBeInTheDocument();
  });

  it("確定済みで相談が無いとき「分析する」を出し、成功したら相談へ遷移する", async () => {
    const onStartAnalysis = vi.fn(async () => "run-42");
    const user = userEvent.setup();
    render(<JournalEntryCard {...baseProps({ onStartAnalysis })} />);
    await user.click(screen.getByRole("button", { name: "分析する" }));
    expect(onStartAnalysis).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith("/chat?runId=run-42");
  });

  it("相談があるときは「分析する」を出さず「相談を開く」を優先する", () => {
    render(
      <JournalEntryCard
        {...baseProps({
          entry: baseEntry({ sourceConsultRunId: "run-1" }),
          onStartAnalysis: async () => "run-x",
        })}
      />,
    );
    expect(screen.getByRole("button", { name: "💬 相談を開く" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "分析する" })).not.toBeInTheDocument();
  });
});

describe("JournalEntryCard（pending / pendingError）", () => {
  it("pending中はスピナーを表示する", () => {
    render(<JournalEntryCard {...baseProps({ pending: true })} />);
    expect(screen.getByRole("status")).toHaveTextContent("更新中…");
  });

  it("pendingErrorがあればエラーと再試行・閉じるボタンを表示する", async () => {
    const retry = vi.fn();
    const onDismissPendingError = vi.fn();
    const user = userEvent.setup();
    render(
      <JournalEntryCard
        {...baseProps({ pendingError: { message: "ネットワークエラー", retry }, onDismissPendingError })}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("ネットワークエラー");
    await user.click(screen.getByRole("button", { name: "再試行" }));
    expect(retry).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "閉じる" }));
    expect(onDismissPendingError).toHaveBeenCalledTimes(1);
  });
});

describe("JournalEntryCard（編集モード）", () => {
  it("フィールドの値を表示し、変更でonChangeハンドラを呼ぶ", async () => {
    const onChangeEditTags = vi.fn();
    const user = userEvent.setup();
    render(<JournalEntryCard {...baseProps({ editing: true, editTags: "1on1", onChangeEditTags })} />);
    const tagsInput = screen.getByPlaceholderText("例: 1on1, 技術的負債");
    expect(tagsInput).toHaveValue("1on1");
    await user.type(tagsInput, "x");
    expect(onChangeEditTags).toHaveBeenCalled();
  });

  it("本文は「本文を編集」ボタンを押すまでtextareaを表示しない", async () => {
    const user = userEvent.setup();
    render(<JournalEntryCard {...baseProps({ editing: true })} />);
    expect(screen.queryByRole("textbox", { name: "本文" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "本文を編集" }));
    expect(screen.getByLabelText("本文")).toBeInTheDocument();
  });

  it("確定ボタンでonConfirmEditを呼ぶ", async () => {
    const onConfirmEdit = vi.fn();
    const user = userEvent.setup();
    render(<JournalEntryCard {...baseProps({ editing: true, onConfirmEdit })} />);
    await user.click(screen.getByRole("button", { name: "この内容で確定" }));
    expect(onConfirmEdit).toHaveBeenCalledTimes(1);
  });

  it("editSubmitting中は確定/キャンセルボタンがdisabledになる", () => {
    render(<JournalEntryCard {...baseProps({ editing: true, editSubmitting: true })} />);
    expect(screen.getByRole("button", { name: "確定中…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "キャンセル" })).toBeDisabled();
  });

  it("未解決の場合、解決メモを空で送ろうとするとonResolveWithNoteは呼ばれ、バリデーションはフック側の責務", async () => {
    const onResolveWithNote = vi.fn();
    const user = userEvent.setup();
    render(<JournalEntryCard {...baseProps({ editing: true, onResolveWithNote })} />);
    await user.click(screen.getByRole("button", { name: "メモを残して解決にする" }));
    expect(onResolveWithNote).toHaveBeenCalledTimes(1);
  });

  it("sourceConsultRunIdがあれば編集中でも相談へのリンクを出す", async () => {
    const user = userEvent.setup();
    render(
      <JournalEntryCard
        {...baseProps({
          editing: true,
          entry: baseEntry({ sourceConsultRunId: "run-1", resolvedIssueId: "issue-1", resolvedIssueTitle: "追跡中Issue" }),
        })}
      />,
    );
    expect(screen.getByText(/このJournalから相談が生まれています/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Issueを開く" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "相談を開く" }));
    expect(pushMock).toHaveBeenCalledWith("/chat?runId=run-1");
  });

  it("解決済み(resolutionNote)の場合はメモ内容を表示し、取り消しボタンを出す", async () => {
    const onClearResolution = vi.fn();
    const user = userEvent.setup();
    render(
      <JournalEntryCard
        {...baseProps({
          editing: true,
          entry: baseEntry({ resolutionNote: "本人と話して解消済み" }),
          onClearResolution,
        })}
      />,
    );
    expect(screen.getByText(/本人と話して解消済み/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "解決を取り消す" }));
    expect(onClearResolution).toHaveBeenCalledTimes(1);
  });

  it("「Issueを起票してこの件を追跡する」でIssue作成後にそのIssueへ遷移する", async () => {
    const onResolveWithNewIssue = vi.fn(async () => "new-issue-id");
    const user = userEvent.setup();
    render(<JournalEntryCard {...baseProps({ editing: true, onResolveWithNewIssue })} />);
    await user.click(screen.getByRole("button", { name: "Issueを起票してこの件を追跡する" }));
    expect(onResolveWithNewIssue).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith("/issues/new-issue-id");
  });

  it("Issue作成に失敗した場合（undefined）は遷移しない", async () => {
    const onResolveWithNewIssue = vi.fn(async () => undefined);
    const user = userEvent.setup();
    render(<JournalEntryCard {...baseProps({ editing: true, onResolveWithNewIssue })} />);
    await user.click(screen.getByRole("button", { name: "Issueを起票してこの件を追跡する" }));
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("editErrorがあればalertとして表示する", () => {
    render(<JournalEntryCard {...baseProps({ editing: true, editError: "更新に失敗しました" })} />);
    expect(screen.getByRole("alert")).toHaveTextContent("更新に失敗しました");
  });
});
