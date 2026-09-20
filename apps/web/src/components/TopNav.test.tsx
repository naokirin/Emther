import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { AppShell, TopNav } from "./TopNav";

// web/src/components/TopNav.test.tsx（Next.js版）からの移植（フェーズ3.5、ルートシェル）。
// next/navigationのusePathnameモックの代わりにMemoryRouterのinitialEntriesで
// 現在パスを指定する以外、検証内容は変更していない。
function renderAt(pathname: string, ui: React.ReactNode) {
  return render(<MemoryRouter initialEntries={[pathname]}>{ui}</MemoryRouter>);
}

describe("TopNav", () => {
  it("グループ単位（8個）のタブを指定された順番で表示する", () => {
    renderAt("/", <TopNav />);
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.textContent?.trim())).toEqual([
      "今日",
      "ジャーナル",
      "提案",
      "相談",
      "振り返り",
      "チーム・メンバー",
      "方針・目標",
      "設定",
    ]);
  });

  it("現在のパスに応じたグループのタブだけactiveクラスを持つ", () => {
    renderAt("/suggestions", <TopNav />);
    const suggestionsTab = screen.getByRole("link", { name: "提案" });
    const dashboardTab = screen.getByRole("link", { name: "今日" });
    expect(suggestionsTab.className).toContain("tabBtnActive");
    expect(dashboardTab.className).not.toContain("tabBtnActive");
  });

  it("トップページ以外のパスは前方一致で判定する（/suggestions/xxxも提案グループがactive）", () => {
    renderAt("/suggestions/some-id", <TopNav />);
    expect(screen.getByRole("link", { name: "提案" }).className).toContain("tabBtnActive");
  });

  it('ルートパス("/")は完全一致のみ（他パスの前方一致に巻き込まれない）', () => {
    renderAt("/suggestions", <TopNav />);
    expect(screen.getByRole("link", { name: "今日" }).className).not.toContain("tabBtnActive");
  });

  it("振り返りタブの既定先はEMの成長", () => {
    renderAt("/", <TopNav />);
    expect(screen.getByRole("link", { name: "振り返り" })).toHaveAttribute("href", "/growth");
  });
});

describe("AppShell", () => {
  it("複数画面グループでは配下画面への横タブを表示する", () => {
    renderAt(
      "/chat",
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
    renderAt(
      "/journal",
      <AppShell>
        <div>page content</div>
      </AppShell>,
    );
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.getByText("page content")).toBeInTheDocument();
  });

  it("複数画面グループになった「チーム・メンバー」（/people, /teams）では横タブを表示する", () => {
    renderAt(
      "/people",
      <AppShell>
        <div>page content</div>
      </AppShell>,
    );
    expect(screen.getByRole("navigation", { name: "チーム・メンバー" }).className).toContain("subTabs");
    expect(screen.getByRole("link", { name: "メンバー" }).className).toContain("subTabBtnActive");
    expect(screen.getByRole("link", { name: "チーム" }).className).not.toContain("subTabBtnActive");
  });
});
