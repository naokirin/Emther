// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppShell, StoryBanner, TopNav } from "./TopNav";

let mockPathname = "/";
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

describe("TopNav", () => {
  it("グループ単位（8個）のタブを表示する", () => {
    mockPathname = "/";
    render(<TopNav />);
    expect(screen.getAllByRole("link")).toHaveLength(8);
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

  // ユーザー指摘「課題タブの下に『人』があるのがわかりにくい」対応の回帰テスト。
  it("/peopleは「課題」ではなく独立した「チーム・メンバー」タブがactiveになる", () => {
    mockPathname = "/people";
    render(<TopNav />);
    expect(screen.getByRole("link", { name: "チーム・メンバー" }).className).toContain("tabBtnActive");
    expect(screen.getByRole("link", { name: "課題" }).className).not.toContain("tabBtnActive");
  });

  it("振り返りタブの既定先はEMの成長", () => {
    mockPathname = "/";
    render(<TopNav />);
    expect(screen.getByRole("link", { name: "振り返り" })).toHaveAttribute("href", "/growth");
  });

  it("/teamsも「チーム・メンバー」タブがactiveになる", () => {
    mockPathname = "/teams";
    render(<TopNav />);
    expect(screen.getByRole("link", { name: "チーム・メンバー" }).className).toContain("tabBtnActive");
  });
});

describe("StoryBanner", () => {
  it("単一画面のグループでは見出しを表示する", () => {
    mockPathname = "/journal";
    render(<StoryBanner />);
    expect(screen.getByText(/現場メモ/)).toBeInTheDocument();
  });

  it("複数画面を持つグループ（相談）では表示しない（サブタブと重複するため）", () => {
    mockPathname = "/chat";
    const { container } = render(<StoryBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  // ユーザー要望「メンバータブを『チーム・メンバー』とし、左メニューでチーム・メンバーを
  // 切り替えられるようにしたい」対応。複数画面グループになったため、サブナビと
  // 見出しを重複させないよう表示しない（相談グループと同じ扱い）。
  it("複数画面を持つグループになった「チーム・メンバー」では表示しない", () => {
    mockPathname = "/people";
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
  it("複数画面グループでは配下画面への横タブを表示する", () => {
    mockPathname = "/chat";
    render(
      <AppShell>
        <div>page content</div>
      </AppShell>,
    );
    const subNav = screen.getByRole("navigation", { name: "相談" });
    expect(subNav.className).toContain("subTabs");
    expect(screen.getByRole("link", { name: "何でも相談" }).className).toContain("subTabBtnActive");
    expect(screen.getByRole("link", { name: "エージェント" }).className).toContain("subTabBtn");
    expect(screen.getByRole("link", { name: "エージェント" }).className).not.toContain("subTabBtnActive");
    expect(screen.getByText("page content")).toBeInTheDocument();
  });

  it("単一画面グループではサブナビを表示しない", () => {
    mockPathname = "/journal";
    render(
      <AppShell>
        <div>page content</div>
      </AppShell>,
    );
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.getByText("page content")).toBeInTheDocument();
  });

  it("複数画面グループになった「チーム・メンバー」（/people, /teams）では横タブを表示する", () => {
    mockPathname = "/people";
    render(
      <AppShell>
        <div>page content</div>
      </AppShell>,
    );
    expect(screen.getByRole("navigation", { name: "チーム・メンバー" }).className).toContain("subTabs");
    expect(screen.getByRole("link", { name: "メンバー" }).className).toContain("subTabBtnActive");
    expect(screen.getByRole("link", { name: "チーム" }).className).toContain("subTabBtn");
    expect(screen.getByRole("link", { name: "チーム" }).className).not.toContain("subTabBtnActive");
  });

  it("振り返りグループでは横タブを表示し、EMの成長が先頭になる", () => {
    mockPathname = "/growth";
    render(
      <AppShell>
        <div>page content</div>
      </AppShell>,
    );
    const subNav = screen.getByRole("navigation", { name: "振り返り" });
    expect(subNav.className).toContain("subTabs");
    const links = screen.getAllByRole("link");
    expect(links.map((el) => el.textContent)).toEqual(["EMの成長", "タイムライン", "レポート"]);
    expect(screen.getByRole("link", { name: "EMの成長" }).className).toContain("subTabBtnActive");
    expect(screen.queryByText("📍 振り返り")).not.toBeInTheDocument();
    expect(screen.getByText("page content")).toBeInTheDocument();
  });
});
