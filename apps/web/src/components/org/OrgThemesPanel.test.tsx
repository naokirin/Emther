import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "@/router";
import { OrgThemesPanel } from "./OrgThemesPanel";
import type { OrgTheme } from "@emther/core/types";

// OrgTheme フィクスチャ＋ MemoryRouter で描画を検証する
function makeTheme(overrides: Partial<OrgTheme> & Pick<OrgTheme, "id" | "title" | "status">): OrgTheme {
  return {
    summary: "",
    rationale: "",
    facts: [],
    evidenceJournalIds: [],
    evidenceSuggestionIds: [],
    goalIds: [],
    sortOrder: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

const mockThemes: OrgTheme[] = [
  makeTheme({
    id: "theme-1",
    title: "技術的負債の解消と開発者体験の向上",
    summary: "レガシーコードの刷新とCI/CDの高速化を進める",
    rationale: "デプロイ頻度が低下し障害率が上昇しているため",
    status: "adopted",
  }),
  makeTheme({
    id: "theme-2",
    title: "採用とオンボーディングの強化",
    summary: "新メンバーの立ち上がり期間を半減させる",
    rationale: "メンバー急増に伴う育成コスト増大への対応",
    status: "candidate",
  }),
];

function renderPanel(overrides: Partial<React.ComponentProps<typeof OrgThemesPanel>> = {}) {
  return render(
    <MemoryRouter>
      <OrgThemesPanel
        themes={mockThemes}
        themesLoaded={true}
        goals={[]}
        refreshThemes={vi.fn().mockResolvedValue(undefined)}
        editingThemeId={null}
        onSelectTheme={vi.fn()}
        onBack={vi.fn()}
        {...overrides}
      />
    </MemoryRouter>,
  );
}

describe("OrgThemesPanel", () => {
  it("renders adopted and candidate themes without errors", () => {
    renderPanel();
    expect(screen.getByText("Themes（組織テーマ）")).toBeInTheDocument();
    expect(screen.getByText("技術的負債の解消と開発者体験の向上")).toBeInTheDocument();
    expect(screen.getByText("採用とオンボーディングの強化")).toBeInTheDocument();
  });

  it("opens create theme form when clicking add button", async () => {
    const user = userEvent.setup();
    renderPanel();

    const addBtn = screen.getByText("＋ テーマを直接設定");
    await user.click(addBtn);

    expect(screen.getByText("🎯 EMとしての注力テーマを直接登録")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("例: テックリードの自立支援と権限委譲")).toBeInTheDocument();
  });

  it("AIと壁打ちリンクにintent=themeが含まれる", () => {
    renderPanel();
    const link = screen.getByRole("link", { name: /AIと壁打ち/ });
    expect(link.getAttribute("href")).toContain("intent=theme");
    expect(link.getAttribute("href")).toContain("prefill=");
  });
});
