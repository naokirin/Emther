import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AgentRun } from "@emther/core/agent-runtime";
import { CopilotChat, ExecutionState, StatusBadge } from "./RunDetail";
import { draftKindLabel, isDraftAwaitingTriage, runFallbackTitle, shouldOmitRunFromNextActions } from "./runDetailMeta";

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

  it("proposal.suggestionTitleがあれば最優先する", () => {
    expect(
      runFallbackTitle(
        baseRun({
          task: "長いタスク文",
          proposal: {
            conclusion: "五木さんの目標設定の悩みを提案化して追跡すべきと判断します",
            facts: [],
            logic: "",
            rejectedAlternatives: [],
        expansions: [],
        challenges: [],
            suggestionTitle: "五木さんの目標設定の悩み",
          },
        }),
      ),
    ).toBe("五木さんの目標設定の悩み");
  });

  it("suggestionTitleが無くsuggestionCandidatesがあれば先頭を使う", () => {
    expect(
      runFallbackTitle(
        baseRun({
          task: "長いタスク文",
          proposal: {
            conclusion: "複数の介入が必要",
            facts: [],
            logic: "",
            rejectedAlternatives: [],
        expansions: [],
        challenges: [],
            suggestionCandidates: [{ title: "候補A" }, { title: "候補B" }],
          },
        }),
      ),
    ).toBe("候補A");
  });

  it("proposal.conclusionがあればtaskより優先し、提案化メタを除いた題名にする", () => {
    expect(
      runFallbackTitle(
        baseRun({
          task: "Journalに緊急度highのエントリが追加されました。内容を確認し、提案として追跡すべきか判断してください。",
          proposal: {
            conclusion: "五木さんの目標設定の悩みを提案化して追跡すべきと判断します",
            facts: [],
            logic: "",
            rejectedAlternatives: [],
        expansions: [],
        challenges: [],
          },
        }),
      ),
    ).toBe("五木さんの目標設定の悩み");
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

  it("idleのドラフトはドラフト提案、実行中はドラフト分析中", () => {
    expect(draftKindLabel(baseRun({ origin: "auto-summary", reviewed: false, status: "idle" }))).toBe(
      "ドラフト提案",
    );
    expect(draftKindLabel(baseRun({ origin: "auto-summary", reviewed: false, status: "active" }))).toBe(
      "ドラフト分析中",
    );
  });
});

describe("shouldOmitRunFromNextActions", () => {
  it("consult子runと却下済みとアーカイブ済み提案紐付けを除外する", () => {
    const suggestions = [
      { agentRunId: "run-archived", archivedAt: Date.now() },
      { agentRunId: "run-open", archivedAt: undefined },
    ];
    expect(shouldOmitRunFromNextActions(baseRun({ consultedBy: "lead-1" }), suggestions)).toBe(true);
    expect(shouldOmitRunFromNextActions(baseRun({ triageStatus: "dismissed" }), suggestions)).toBe(true);
    expect(shouldOmitRunFromNextActions(baseRun({ id: "run-archived" }), suggestions)).toBe(true);
    expect(shouldOmitRunFromNextActions(baseRun({ id: "run-open" }), suggestions)).toBe(false);
    expect(shouldOmitRunFromNextActions(baseRun({ triageStatus: "watching" }), suggestions)).toBe(false);
  });

  it("相談自体がアーカイブ済み（archivedAt設定済み）のrunを除外する", () => {
    const suggestions: { agentRunId?: string; archivedAt?: number }[] = [];
    expect(shouldOmitRunFromNextActions(baseRun({ archivedAt: Date.now() }), suggestions)).toBe(true);
    expect(shouldOmitRunFromNextActions(baseRun({ archivedAt: undefined }), suggestions)).toBe(false);
  });

  // ユーザー指摘「確認済みの提案に紐づく相談が今日やるべきに残る」対応。
  // 確認済みとアーカイブは独立だが、どちらも朝キューからは外す。
  it("確認済み(done)の提案に紐づくrunはアーカイブしていなくても除外する", () => {
    const suggestions = [
      { agentRunId: "run-done", reviewStatus: "done" as const },
      { agentRunId: "run-open", reviewStatus: "unreviewed" as const },
    ];
    expect(shouldOmitRunFromNextActions(baseRun({ id: "run-done" }), suggestions)).toBe(true);
    expect(shouldOmitRunFromNextActions(baseRun({ id: "run-open" }), suggestions)).toBe(false);
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

  it("Context部分はデフォルトで折りたたまれており、展開すると表示される", () => {
    const run = baseRun({ task: "詳細な指示プロンプトテキスト" });
    render(
      <ExecutionState
        run={run}
        selectedOptionId={null}
        onSelectOption={noop}
        onConfirmOption={noop}
        onFocusChat={noop}
        deciding={false}
      />,
    );
    const summary = screen.getByText(/Context（指示・前提）を確認する/);
    expect(summary).toBeInTheDocument();
    const details = summary.closest("details");
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
    expect(screen.getByText("詳細な指示プロンプトテキスト")).toBeInTheDocument();
  });

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
    await user.click(screen.getByRole("radio", { name: /選択肢A/ }));
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
      proposal: {
        conclusion: "結論テキスト",
        facts: ["fact1"],
        logic: "ロジック説明",
        rejectedAlternatives: [{ option: "案X", reason: "理由Y" }],
        expansions: ["チーム全体の傾向かもしれない"],
        challenges: ["発言量自体が問題なのか"],
      },
    });
    render(
      <ExecutionState run={run} selectedOptionId={null} onSelectOption={noop} onConfirmOption={noop} onFocusChat={noop} deciding={false} />,
    );
    expect(screen.getByText("結論テキスト")).toBeInTheDocument();
    expect(screen.getByText("ロジック説明")).toBeInTheDocument();
    expect(screen.getByText("案X")).toBeInTheDocument();
    expect(screen.getByText("チーム全体の傾向かもしれない")).toBeInTheDocument();
    expect(screen.getByText("発言量自体が問題なのか")).toBeInTheDocument();
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

  it("吹き出しとnoteの両方で改行を残す（MarkdownView + remark-breaks）", () => {
    const run = baseRun({
      log: [
        { ts: 0, channel: "agent", text: "AIの1行目\nAIの2行目" },
        { ts: 1, channel: "system", text: "注記の1行目\n注記の2行目" },
      ],
    });
    const { container } = render(
      <CopilotChat run={run} message="" setMessage={() => {}} deciding={false} onDecide={() => {}} />,
    );
    // 単一改行が<br>になっていること（空白折りたたみでないこと）を担保する
    expect(container.querySelectorAll("br").length).toBeGreaterThanOrEqual(2);
    expect(container.textContent).toMatch(/AIの1行目\s*AIの2行目/);
    expect(container.textContent).toMatch(/注記の1行目\s*注記の2行目/);
  });

  it("active/queued中は入力欄を表示しない", () => {
    render(<CopilotChat run={baseRun({ status: "active" })} message="" setMessage={() => {}} deciding={false} onDecide={() => {}} />);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("Ctrl+Enterおよび送信ボタンでonDecideを呼ぶ（Enter単体は改行）", async () => {
    const onDecide = vi.fn();
    const user = userEvent.setup();
    render(<CopilotChat run={baseRun({ status: "idle" })} message="追加の相談内容" setMessage={() => {}} deciding={false} onDecide={onDecide} />);
    await user.type(screen.getByRole("textbox"), "{Enter}");
    expect(onDecide).not.toHaveBeenCalled();

    await user.type(screen.getByRole("textbox"), "{Control>}{Enter}{/Control}");
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
