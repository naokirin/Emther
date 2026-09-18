// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OrgThemesPanel } from "./OrgThemesPanel";
import type { OrgTheme } from "@/lib/types";

const mockThemes: OrgTheme[] = [
  {
    id: "theme-1",
    title: "技術的負債の解消と開発者体験の向上",
    summary: "レガシーコードの刷新とCI/CDの高速化を進める",
    rationale: "デプロイ頻度が低下し障害率が上昇しているため",
    status: "adopted",
    priority: 1,
    sourceIssueIds: [],
    objectiveIds: [],
    keyResultIds: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: "theme-2",
    title: "採用とオンボーディングの強化",
    summary: "新メンバーの立ち上がり期間を半減させる",
    rationale: "メンバー急増に伴う育成コスト増大への対応",
    status: "candidate",
    priority: 2,
    sourceIssueIds: [],
    objectiveIds: [],
    keyResultIds: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
];

describe("OrgThemesPanel", () => {
  it("renders adopted and candidate themes without errors", () => {
    const onSelectTheme = vi.fn();
    const onBack = vi.fn();
    const refreshThemes = vi.fn().mockResolvedValue(undefined);

    render(
      <OrgThemesPanel
        themes={mockThemes}
        themesLoaded={true}
        objectives={[]}
        refreshThemes={refreshThemes}
        editingThemeId={null}
        onSelectTheme={onSelectTheme}
        onBack={onBack}
      />,
    );

    expect(screen.getByText("組織テーマ")).toBeInTheDocument();
    expect(screen.getByText("技術的負債の解消と開発者体験の向上")).toBeInTheDocument();
    expect(screen.getByText("採用とオンボーディングの強化")).toBeInTheDocument();
  });

  it("opens create theme form when clicking add button", async () => {
    const user = userEvent.setup();
    const onSelectTheme = vi.fn();
    const onBack = vi.fn();
    const refreshThemes = vi.fn().mockResolvedValue(undefined);

    render(
      <OrgThemesPanel
        themes={mockThemes}
        themesLoaded={true}
        objectives={[]}
        refreshThemes={refreshThemes}
        editingThemeId={null}
        onSelectTheme={onSelectTheme}
        onBack={onBack}
      />,
    );

    const addBtn = screen.getByText("＋ テーマを直接設定");
    await user.click(addBtn);

    expect(screen.getByText("🎯 EMとしての注力テーマを直接登録")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("例: テックリードの自立支援と権限委譲")).toBeInTheDocument();
  });
});
