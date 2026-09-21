import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConsultHistoryItem } from "./ConsultHistoryItem";
import { consultListMetaParts, formatConsultListTime } from "./consultListMeta";
import type { AgentRun } from "./RunDetail";

// web/src/components/ConsultHistoryItem.tsx（Next.js版）には専用テストが元々無かったため
// 新規に追加する（フェーズ3.5 tier5 chatバッチ）。

function baseRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: "run-1",
    agentName: "Lead Agent",
    task: "相談したいことがある",
    status: "idle",
    log: [],
    totalCostUsd: 0,
    createdAt: 0,
    updatedAt: Date.now(),
    origin: "manual",
    reviewed: true,
    ...overrides,
  };
}

describe("formatConsultListTime", () => {
  it("今日なら「今日 HH:MM」、昨日なら「昨日 HH:MM」、それ以外はM/D HH:MM", () => {
    const now = new Date(2026, 0, 15, 12, 0).getTime();
    const today = new Date(2026, 0, 15, 9, 5).getTime();
    const yesterday = new Date(2026, 0, 14, 9, 5).getTime();
    const older = new Date(2026, 0, 10, 9, 5).getTime();
    expect(formatConsultListTime(today, now)).toBe("今日 09:05");
    expect(formatConsultListTime(yesterday, now)).toBe("昨日 09:05");
    expect(formatConsultListTime(older, now)).toBe("1/10 09:05");
  });
});

describe("consultListMetaParts", () => {
  it("staleなactiveは「応答なし」を出す", () => {
    const parts = consultListMetaParts(baseRun({ status: "active" }), { stale: true, omitTime: true });
    expect(parts).toContain("応答なし");
  });

  it("origin!==manualかつ未確認なら「未確認」を含む", () => {
    const parts = consultListMetaParts(baseRun({ origin: "auto-anomaly", reviewed: false }), { omitTime: true });
    expect(parts).toContain("未確認");
    expect(parts).toContain("Journal自動分析");
  });

  it("アーカイブ済みなら🗄ラベルを含む", () => {
    const parts = consultListMetaParts(baseRun({ archivedAt: Date.now() }), { omitTime: true });
    expect(parts).toContain("🗄 アーカイブ済み");
  });
});

describe("ConsultHistoryItem", () => {
  it("タイトル・メタ情報を表示し、クリックでonSelectを呼ぶ", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<ConsultHistoryItem run={baseRun()} selected={false} onSelect={onSelect} />);
    await user.click(screen.getByRole("button"));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("promotedなら「提案化済み」を表示する", () => {
    render(<ConsultHistoryItem run={baseRun()} selected={false} promoted onSelect={() => {}} />);
    expect(screen.getByText(/提案化済み/)).toBeInTheDocument();
  });

  it("直近24時間以内の更新はNEWバッジを出す", () => {
    render(<ConsultHistoryItem run={baseRun({ updatedAt: Date.now() })} selected={false} onSelect={() => {}} />);
    expect(screen.getByText("NEW")).toBeInTheDocument();
  });
});
