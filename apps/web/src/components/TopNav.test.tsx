import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "@/router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AppShell, TopNav } from "./TopNav";

// 振り返りサブナビに「1日を締めくくる」追加
function renderAt(pathname: string, ui: React.ReactNode) {
  return render(<MemoryRouter initialEntries={[pathname]}>{ui}</MemoryRouter>);
}

function renderReflectionAt(pathname: string, ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[pathname]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
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
      "振り返り・レポート",
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

  it("振り返り・レポートタブの既定先は自己チェックイン", () => {
    renderAt("/", <TopNav />);
    expect(screen.getByRole("link", { name: "振り返り・レポート" })).toHaveAttribute("href", "/checkin");
  });

  it("/evening-review では振り返り・レポートグループがactive", () => {
    renderAt("/evening-review", <TopNav />);
    expect(screen.getByRole("link", { name: "振り返り・レポート" }).className).toContain("tabBtnActive");
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

  it("振り返り・レポートのサブナビは自己チェックイン／EM週次振り返り／レポート／1日を締めくくる", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ checkins: [{ id: "c1", createdAt: Date.now() }] }) }));
    renderReflectionAt(
      "/checkin",
      <AppShell>
        <div>page content</div>
      </AppShell>,
    );
    const subNav = screen.getByRole("navigation", { name: "振り返り・レポート" });
    expect(subNav.className).toContain("subTabs");
    const links = Array.from(subNav.querySelectorAll("a")).map((a) => a.textContent?.trim());
    expect(links).toEqual(["自己チェックイン", "EM週次振り返り", "レポート", "1日を締めくくる"]);
    expect(screen.getByRole("link", { name: "自己チェックイン" }).className).toContain("subTabBtnActive");
    expect(screen.getByRole("link", { name: "EM週次振り返り" })).toHaveAttribute("href", "/growth");
    expect(screen.getByRole("link", { name: "レポート" })).toHaveAttribute("href", "/reports");
    expect(screen.getByRole("link", { name: "1日を締めくくる" })).toHaveAttribute("href", "/evening-review");
    expect(screen.queryByRole("link", { name: "タイムライン" })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "1日を締めくくる" }).className).not.toContain("subTabBtnAttention");
    });
    vi.unstubAllGlobals();
  });

  it("チェックイン未記録なら「1日を締めくくる」を軽く強調する", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ checkins: [] }) }));
    renderReflectionAt(
      "/growth",
      <AppShell>
        <div>page content</div>
      </AppShell>,
    );
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "1日を締めくくる" }).className).toContain("subTabBtnAttention");
    });
    expect(screen.getByRole("link", { name: "EM週次振り返り" }).className).toContain("subTabBtnActive");
    vi.unstubAllGlobals();
  });

  it("/evening-review では「1日を締めくくる」がactive", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ checkins: [] }) }));
    renderReflectionAt(
      "/evening-review",
      <AppShell>
        <div>page content</div>
      </AppShell>,
    );
    expect(screen.getByRole("link", { name: "1日を締めくくる" }).className).toContain("subTabBtnActive");
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "1日を締めくくる" }).className).toContain("subTabBtnAttention");
    });
    vi.unstubAllGlobals();
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
