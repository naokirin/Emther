// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CopilotChat, ExecutionState, draftKindLabel, isDraftAwaitingTriage, runFallbackTitle, StatusBadge, type AgentRun } from "./RunDetail";

function baseRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: "run-1",
    agentName: "Lead Agent",
    task: "タスク",
    status: "idle",
    log: [],
    totalCostUsd: 0,
    createdAt: 0,
    updatedAt: 0,
    origin: "manual",
    reviewed: true,
    ...overrides,
  };
}

describe("runFallbackTitle", () => {
  it("taskがあればそれを使う", () => {
    expect(runFallbackTitle(baseRun({ task: "本来のタスク" }))).toBe("本来のタスク");
  });

  it("proposal.conclusionがあればtaskより優先する（異常検知など定型の指示文がtaskの場合に本文を残すため）", () => {
    expect(
      runFallbackTitle(
        baseRun({
          task: "Journalに緊急度highのエントリが追加されました。内容を確認し、Issueとして追跡すべきか判断してください。",
          proposal: {
            conclusion: "五木さんの目標設定の悩みをIssue化して追跡すべきと判断します",
            facts: [],
            logic: "",
            rejectedAlternatives: [],
          },
        }),
      ),
    ).toBe("五木さんの目標設定の悩みをIssue化して追跡すべきと判断します");
  });

  it("taskが空ならyieldの理由を使う", () => {
    expect(
      runFallbackTitle(baseRun({ task: "  ", yieldRequest: { reason: "情報不足のため判断が必要", options: [] } })),
    ).toBe("情報不足のため判断が必要");
  });

  it("taskもyieldも無ければ最初のsystem以外のログ行を使う", () => {
    expect(
      runFallbackTitle(
        baseRun({
          task: "",
          log: [
            { ts: 0, channel: "system", text: "システムログ" },
            { ts: 1, channel: "agent", text: "AIの発言" },
          ],
        }),
      ),
    ).toBe("AIの発言");
  });

  it("何も無ければエージェント名だけのフォールバックにする", () => {
    expect(runFallbackTitle(baseRun({ task: "", agentName: "People Agent" }))).toBe("People AgentのRun（内容未記録）");
  });

  it("system channelのログ行はfirstLogLineの候補から除外する", () => {
    expect(
      runFallbackTitle(
        baseRun({ task: "", agentName: "Tech Agent", log: [{ ts: 0, channel: "system", text: "システムログのみ" }] }),
      ),
    ).toBe("Tech AgentのRun（内容未記録）");
  });
});

describe("isDraftAwaitingTriage / draftKindLabel", () => {
  it("自動起動かつ未確認ならドラフト", () => {
    expect(isDraftAwaitingTriage(baseRun({ origin: "auto-anomaly", reviewed: false }))).toBe(true);
    expect(isDraftAwaitingTriage(baseRun({ origin: "manual", reviewed: false }))).toBe(false);
    expect(isDraftAwaitingTriage(baseRun({ origin: "auto-anomaly", reviewed: true }))).toBe(false);
    expect(
      isDraftAwaitingTriage(baseRun({ origin: "auto-anomaly", reviewed: false, triageStatus: "dismissed" })),
    ).toBe(false);
  });

  it("idleのドラフトはドラフトIssue、実行中はドラフト分析中", () => {
    expect(draftKindLabel(baseRun({ origin: "auto-summary", reviewed: false, status: "idle" }))).toBe(
      "ドラフトIssue",
    );
    expect(draftKindLabel(baseRun({ origin: "auto-summary", reviewed: false, status: "active" }))).toBe(
      "ドラフト分析中",
    );
  });
});

describe("StatusBadge", () => {
  it("staleなactiveは応答なし表示になる", () => {
    render(<StatusBadge status="active" stale />);
    expect(screen.getByText(/応答なし/)).toBeInTheDocument();
  });

  it("staleでなければ通常のステータス表示になる", () => {
    render(<StatusBadge status="active" />);
    expect(screen.getByText(/Active/)).toBeInTheDocument();
  });

  it("staleフラグはactive以外には影響しない", () => {
    render(<StatusBadge status="idle" stale />);
    expect(screen.getByText(/Idle/)).toBeInTheDocument();
  });
});

describe("ExecutionState", () => {
  const noop = () => {};

  it("yield中は選択肢を表示し、選択してから確定ボタンが有効になる", async () => {
    const onSelectOption = vi.fn();
    const onConfirmOption = vi.fn();
    const user = userEvent.setup();
    const run = baseRun({
      status: "yield",
      yieldRequest: { reason: "判断が必要", options: [{ id: "A", label: "選択肢A" }, { id: "B", label: "選択肢B" }] },
    });
    render(
      <ExecutionState
        run={run}
        selectedOptionId={null}
        onSelectOption={onSelectOption}
        onConfirmOption={onConfirmOption}
        onFocusChat={noop}
        deciding={false}
      />,
    );
    expect(screen.getByRole("button", { name: "選択してStateを更新" })).toBeDisabled();
    await user.click(screen.getByText(/Option A: 選択肢A/));
    expect(onSelectOption).toHaveBeenCalledWith("A");
  });

  it("yieldのkindがcommitならCommitのカード見出しを表示する", () => {
    const run = baseRun({
      status: "yield",
      yieldRequest: { reason: "介入を実行するか決めてください", kind: "commit", options: [] },
    });
    render(
      <ExecutionState run={run} selectedOptionId={null} onSelectOption={noop} onConfirmOption={noop} onFocusChat={noop} deciding={false} />,
    );
    expect(screen.getByText(/Commit/)).toBeInTheDocument();
  });

  it("yieldのkind未指定・options空ならInformへフォールバックする", () => {
    const run = baseRun({
      status: "yield",
      yieldRequest: { reason: "前提が足りません", options: [] },
    });
    render(
      <ExecutionState run={run} selectedOptionId={null} onSelectOption={noop} onConfirmOption={noop} onFocusChat={noop} deciding={false} />,
    );
    expect(screen.getByText(/Inform/)).toBeInTheDocument();
  });

  it("idle+proposalの場合は結論・ロジック・棄却案を表示する", () => {
    const run = baseRun({
      status: "idle",
      proposal: { conclusion: "結論テキスト", facts: ["fact1"], logic: "ロジック説明", rejectedAlternatives: [{ option: "案X", reason: "理由Y" }] },
    });
    render(
      <ExecutionState run={run} selectedOptionId={null} onSelectOption={noop} onConfirmOption={noop} onFocusChat={noop} deciding={false} />,
    );
    expect(screen.getByText("結論テキスト")).toBeInTheDocument();
    expect(screen.getByText("ロジック説明")).toBeInTheDocument();
    expect(screen.getByText("案X")).toBeInTheDocument();
  });

  it("提案されたAction Itemsを採用/却下できる", async () => {
    const onAdoptActionItems = vi.fn();
    const onDismissActionItems = vi.fn();
    const user = userEvent.setup();
    const run = baseRun({
      status: "idle",
      proposal: { conclusion: "c", facts: [], logic: "l", rejectedAlternatives: [] },
      suggestedActionItems: ["やること1"],
    });
    render(
      <ExecutionState
        run={run}
        selectedOptionId={null}
        onSelectOption={noop}
        onConfirmOption={noop}
        onFocusChat={noop}
        deciding={false}
        onAdoptActionItems={onAdoptActionItems}
        onDismissActionItems={onDismissActionItems}
      />,
    );
    await user.click(screen.getByRole("button", { name: "採用する（先頭を次の一手に）" }));
    expect(onAdoptActionItems).toHaveBeenCalledWith(["やること1"]);
    await user.click(screen.getByRole("button", { name: "却下する" }));
    expect(onDismissActionItems).toHaveBeenCalledTimes(1);
  });

  it("提案されたWhy/What/Howを採用/却下できる", async () => {
    const onAdoptCharter = vi.fn();
    const onDismissCharter = vi.fn();
    const user = userEvent.setup();
    const run = baseRun({
      status: "idle",
      proposal: { conclusion: "c", facts: [], logic: "l", rejectedAlternatives: [] },
      suggestedCharter: { why: "生む価値の提案" },
    });
    render(
      <ExecutionState
        run={run}
        selectedOptionId={null}
        onSelectOption={noop}
        onConfirmOption={noop}
        onFocusChat={noop}
        deciding={false}
        onAdoptCharter={onAdoptCharter}
        onDismissCharter={onDismissCharter}
      />,
    );
    expect(screen.getByText("生む価値の提案")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "採用してWhy/What/Howに反映" }));
    expect(onAdoptCharter).toHaveBeenCalledWith({ why: "生む価値の提案" });
    await user.click(screen.getByRole("button", { name: "却下する" }));
    expect(onDismissCharter).toHaveBeenCalledTimes(1);
  });

  it("error状態では再試行ボタンを表示する", async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    render(
      <ExecutionState
        run={baseRun({ status: "error" })}
        selectedOptionId={null}
        onSelectOption={noop}
        onConfirmOption={noop}
        onFocusChat={noop}
        deciding={false}
        onRetry={onRetry}
      />,
    );
    await user.click(screen.getByRole("button", { name: /再試行する/ }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe("CopilotChat", () => {
  it("meta:タスクを受理はユーザー発言として表示し、agentは吹き出しで表示する", () => {
    const run = baseRun({
      log: [
        { ts: 0, channel: "meta", text: "タスクを受理: 相談したいことがある" },
        { ts: 1, channel: "agent", text: "承知しました。詳細を教えてください。" },
      ],
    });
    render(<CopilotChat run={run} message="" setMessage={() => {}} deciding={false} onDecide={() => {}} />);
    expect(screen.getByText("相談したいことがある")).toBeInTheDocument();
    expect(screen.getByText("承知しました。詳細を教えてください。")).toBeInTheDocument();
  });

  it("agentの発言からyield/proposal等の構造化ブロックを除去して表示する", () => {
    const run = baseRun({
      log: [{ ts: 0, channel: "agent", text: '自然文の説明です。\n```proposal\n{"conclusion":"x"}\n```' }],
    });
    render(<CopilotChat run={run} message="" setMessage={() => {}} deciding={false} onDecide={() => {}} />);
    expect(screen.getByText("自然文の説明です。")).toBeInTheDocument();
    expect(screen.queryByText(/conclusion/)).not.toBeInTheDocument();
  });

  it("active/queued中は入力欄を表示しない", () => {
    render(<CopilotChat run={baseRun({ status: "active" })} message="" setMessage={() => {}} deciding={false} onDecide={() => {}} />);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("Enterキーおよび送信ボタンでonDecideを呼ぶ", async () => {
    const onDecide = vi.fn();
    const user = userEvent.setup();
    render(<CopilotChat run={baseRun({ status: "idle" })} message="追加の相談内容" setMessage={() => {}} deciding={false} onDecide={onDecide} />);
    await user.type(screen.getByRole("textbox"), "{Enter}");
    expect(onDecide).toHaveBeenCalledWith("追加の相談内容");

    onDecide.mockClear();
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(onDecide).toHaveBeenCalledWith("追加の相談内容");
  });

  it("メッセージが空ならSendボタンはdisabled", () => {
    render(<CopilotChat run={baseRun({ status: "idle" })} message="   " setMessage={() => {}} deciding={false} onDecide={() => {}} />);
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });
});
