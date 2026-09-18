// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppShell, TopNav } from "./TopNav";

let mockPathname = "/";
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

describe("TopNav", () => {
  it("グループ単位（8個）のタブを指定された順番で表示する", () => {
    mockPathname = "/";
    render(<TopNav />);
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
    mockPathname = "/suggestions";
    render(<TopNav />);
    const suggestionsTab = screen.getByRole("link", { name: "提案" });
    const dashboardTab = screen.getByRole("link", { name: "今日" });
    expect(suggestionsTab.className).toContain("tabBtnActive");
    expect(dashboardTab.className).not.toContain("tabBtnActive");
  });

  it("トップページ以外のパスは前方一致で判定する（/suggestions/xxxも提案グループがactive）", () => {
    mockPathname = "/suggestions/some-id";
    render(<TopNav />);
    expect(screen.getByRole("link", { name: "提案" }).className).toContain("tabBtnActive");
  });

  it("ルートパス(\"/\")は完全一致のみ（他パスの前方一致に巻き込まれない）", () => {
    mockPathname = "/suggestions";
    render(<TopNav />);
    expect(screen.getByRole("link", { name: "今日" }).className).not.toContain("tabBtnActive");
  });

  it("/peopleは「提案」ではなく独立した「チーム・メンバー」タブがactiveになる", () => {
    mockPathname = "/people";
    render(<TopNav />);
    expect(screen.getByRole("link", { name: "チーム・メンバー" }).className).toContain("tabBtnActive");
    expect(screen.getByRole("link", { name: "提案" }).className).not.toContain("tabBtnActive");
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
    expect(screen.getByRole("link", { name: "個人・機密情報チェック" }).className).toContain("subTabBtn");
    expect(screen.getByRole("link", { name: "個人・機密情報チェック" }).className).not.toContain("subTabBtnActive");
    expect(screen.getByText("page content")).toBeInTheDocument();
  });

  it("/mask-check では個人・機密情報チェックのサブタブが active", () => {
    mockPathname = "/mask-check";
    render(
      <AppShell>
        <div>page content</div>
      </AppShell>,
    );
    expect(screen.getByRole("link", { name: "個人・機密情報チェック" }).className).toContain("subTabBtnActive");
    expect(screen.getByRole("link", { name: "何でも相談" }).className).not.toContain("subTabBtnActive");
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
