// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ConsultHistoryItem,
  consultListMetaParts,
  formatConsultListTime,
} from "./ConsultHistoryItem";
import type { AgentRun } from "./RunDetail";

function baseRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: "run-1",
    agentName: "Lead Agent",
    task: "Aさんの1on1方針を相談したい",
    status: "idle",
    log: [],
    totalCostUsd: 0,
    createdAt: 0,
    updatedAt: Date.parse("2026-09-10T14:22:00"),
    origin: "manual",
    reviewed: true,
    ...overrides,
  };
}

describe("formatConsultListTime", () => {
  const now = Date.parse("2026-09-10T18:00:00");

  it("今日・昨日はそう書き、それ以外は日付にする", () => {
    expect(formatConsultListTime(Date.parse("2026-09-10T14:22:00"), now)).toBe("今日 14:22");
    expect(formatConsultListTime(Date.parse("2026-09-09T09:01:00"), now)).toBe("昨日 09:01");
    expect(formatConsultListTime(Date.parse("2026-09-08T18:30:00"), now)).toBe("9/8 18:30");
  });
});

describe("consultListMetaParts", () => {
  const now = Date.parse("2026-09-10T18:00:00");

  it("日時・状態・起点を並べ、バッジ用の長いラベルは使わない", () => {
    expect(
      consultListMetaParts(
        baseRun({
          origin: "auto-anomaly",
          reviewed: false,
          triageStatus: "watching",
          status: "idle",
        }),
        { now },
      ),
    ).toEqual(["今日 14:22", "完了", "Journal自動分析", "未確認", "様子見"]);
  });

  it("手動相談は起点を出さず、Journal起点なら付ける", () => {
    expect(consultListMetaParts(baseRun(), { now })).toEqual(["今日 14:22", "完了"]);
    expect(consultListMetaParts(baseRun({ sourceJournalId: "j1" }), { now })).toEqual([
      "今日 14:22",
      "完了",
      "Journalから",
    ]);
  });

  it("様子見一覧向けに日時とトリアージを省略できる", () => {
    expect(
      consultListMetaParts(
        baseRun({
          origin: "auto-anomaly",
          reviewed: false,
          triageStatus: "watching",
          status: "idle",
        }),
        { now, omitTime: true, omitTriage: true },
      ),
    ).toEqual(["完了", "Journal自動分析", "未確認"]);
  });
});

describe("ConsultHistoryItem", () => {
  it("相談内容を先に出し、状態はメタ行にまとめる", async () => {
    const onSelect = vi.fn();
    render(
      <ConsultHistoryItem
        run={baseRun({
          task: [
            "Journalに、設定した自動分析条件に合うエントリが追加されました。",
            "",
            '対象のJournalエントリ: "リリースが遅れて現場が疲弊している"',
          ].join("\n"),
          origin: "auto-anomaly",
          reviewed: false,
          proposal: { conclusion: "Issue化を検討する", facts: [], logic: "", rejectedAlternatives: [] },
        })}
        selected={false}
        onSelect={onSelect}
      />,
    );

    expect(screen.getByText("リリースが遅れて現場が疲弊している")).toBeInTheDocument();
    expect(screen.getByText("Issue化を検討する")).toBeInTheDocument();
    expect(screen.queryByText(/Idle（完了・待機中）/)).not.toBeInTheDocument();
    expect(screen.getByText(/Journal自動分析/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button"));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
