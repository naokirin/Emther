import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { formatPendingAgentStartText, PendingAgentStartNotice } from "./PendingAgentStartNotice";
import type { PendingAgentStart } from "@emther/core/types";

// web/src/components/PendingAgentStartNotice.tsx（Next.js版）には専用テストが元々無かった
// ため新規に追加する（フェーズ3.5 tier4 suggestionsバッチ）。

function pending(overrides: Partial<PendingAgentStart> = {}): PendingAgentStart {
  return {
    id: "p1",
    label: "分析",
    firesAt: Date.now() + 5000,
    ...overrides,
  } as PendingAgentStart;
}

describe("PendingAgentStartNotice", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("残り秒数とラベル・詳細を表示する", () => {
    render(<PendingAgentStartNotice pending={pending({ label: "朝のサマリー", detail: "Journal 3件" })} />);
    expect(screen.getByText(/あと\d+秒後にエージェントが起動します/)).toBeInTheDocument();
    expect(screen.getByText(/朝のサマリー/)).toBeInTheDocument();
    expect(screen.getByText(/Journal 3件/)).toBeInTheDocument();
  });

  it("1秒ごとに残り秒数を再計算する", () => {
    render(<PendingAgentStartNotice pending={pending({ firesAt: Date.now() + 5000 })} />);
    const before = screen.getByRole("status").textContent;
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    const after = screen.getByRole("status").textContent;
    expect(after).not.toBe(before);
  });
});

describe("formatPendingAgentStartText", () => {
  it("issueTitleがあればタイトル付きで整形する", () => {
    const now = 1_000_000;
    const text = formatPendingAgentStartText(
      pending({ label: "分析", firesAt: now + 4000, issueTitle: "五木さんの目標設定" }),
      now,
    );
    expect(text).toBe("あと4秒で分析（「五木さんの目標設定」）");
  });

  it("issueTitleが無ければタイトル部分を省く", () => {
    const now = 1_000_000;
    const text = formatPendingAgentStartText(pending({ label: "分析", firesAt: now + 2000 }), now);
    expect(text).toBe("あと2秒で分析");
  });
});
