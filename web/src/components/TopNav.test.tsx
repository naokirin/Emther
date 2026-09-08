// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppShell, StoryBanner, TopNav } from "./TopNav";

let mockPathname = "/";
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

describe("TopNav", () => {
  it("グループ単位（7個）のタブを表示する", () => {
    mockPathname = "/";
    render(<TopNav />);
    expect(screen.getAllByRole("link")).toHaveLength(7);
  });

  it("現在のパスに応じたグループのタブだけactiveクラスを持つ", () => {
    mockPathname = "/issues";
    render(<TopNav />);
    const issuesTab = screen.getByRole("link", { name: "課題" });
    const dashboardTab = screen.getByRole("link", { name: "今日" });
    expect(issuesTab.className).toContain("tabBtnActive");
    expect(dashboardTab.className).not.toContain("tabBtnActive");
  });

  it("トップページ以外のパスは前方一致で判定する（/issues/xxxもissuesグループがactive）", () => {
    mockPathname = "/issues/some-id";
    render(<TopNav />);
    expect(screen.getByRole("link", { name: "課題" }).className).toContain("tabBtnActive");
  });

  it("ルートパス(\"/\")は完全一致のみ（他パスの前方一致に巻き込まれない）", () => {
    mockPathname = "/issues";
    render(<TopNav />);
    expect(screen.getByRole("link", { name: "今日" }).className).not.toContain("tabBtnActive");
  });
});

describe("StoryBanner", () => {
  it("単一画面のグループでは見出しを表示する", () => {
    mockPathname = "/journal";
    render(<StoryBanner />);
    expect(screen.getByText(/現場メモ/)).toBeInTheDocument();
  });

  it("複数画面を持つグループ（課題）では表示しない（サイドメニュー見出しと重複するため）", () => {
    mockPathname = "/issues";
    const { container } = render(<StoryBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("どのグループにも属さないパスでは表示しない", () => {
    mockPathname = "/unknown";
    const { container } = render(<StoryBanner />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("AppShell", () => {
  it("複数画面グループでは配下画面へのサイドメニューを表示する", () => {
    mockPathname = "/people";
    render(
      <AppShell>
        <div>page content</div>
      </AppShell>,
    );
    expect(screen.getByRole("link", { name: "課題一覧" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "人" }).className).toContain("sideNavItemActive");
    expect(screen.getByText("page content")).toBeInTheDocument();
  });

  it("単一画面グループではサイドメニューを表示しない", () => {
    mockPathname = "/journal";
    render(
      <AppShell>
        <div>page content</div>
      </AppShell>,
    );
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.getByText("page content")).toBeInTheDocument();
  });
});
