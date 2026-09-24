import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { SettingsPage } from "./SettingsPage";
import { makeRules } from "../../components/settings/test-fixtures";

// useSettingsRulesがTanStack Query化されているためQueryClientProviderで包む
function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  };
}

describe("SettingsPage", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // teamWindowDaysをfallback既定値（14、queries.tsのSETTINGS_RULES_FALLBACK参照）と
    // 意図的に変え、「保存済み」表示だけでは読み込み前後を区別できない
    // （isDirtyはseeded===falseの間も短絡でfalseになるため、フェッチ完了前から
    // 「保存済み」ボタンが出てしまう）落とし穴を踏まないようにする。
    // PATCH後のrefreshRules()（再GET）がdraftと一致する値を返すよう、状態を保持する
    // 素朴なサーバーもどきにする（固定レスポンスだとPATCH後もdirtyのままになり、
    // 保存成功メッセージの検証ができない）。
    let currentRules = makeRules({ teamWindowDays: 99 });
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        currentRules = { ...currentRules, ...JSON.parse(String(init.body)) };
        return { ok: true, json: async () => ({}) };
      }
      return { ok: true, json: async () => ({ rules: currentRules }) };
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("読み込み後は保存済みボタン（無効）を表示し、値を変えると保存できるようになる", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />, { wrapper: createWrapper() });

    // 実データ（teamWindowDays=99）で初期化されたことを確認してから操作する
    // （「保存済み」ボタンの表示だけでは読み込み前の初期状態と区別できないため）。
    const [teamWindowDaysInput] = await waitFor(() => {
      const [input] = screen.getAllByLabelText("判定に使う参照期間（日）");
      expect(input).toHaveValue(99);
      return [input];
    });
    expect(screen.getByRole("button", { name: "保存済み" })).toBeDisabled();

    fireEvent.change(teamWindowDaysInput, { target: { value: "21" } });

    expect(screen.getByText("⚠️ 未保存の変更があります")).toBeInTheDocument();
    const saveBtn = screen.getByRole("button", { name: "保存" });
    await user.click(saveBtn);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/settings/rules",
        expect.objectContaining({ method: "PATCH" }),
      ),
    );
    expect(await screen.findByText(/に保存しました/)).toBeInTheDocument();
  });

  it("サイドナビでグループを切り替えられる", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />, { wrapper: createWrapper() });
    await waitFor(() => expect(screen.getByRole("button", { name: "保存済み" })).toBeDisabled());

    await user.click(screen.getByRole("button", { name: "AIツール" }));
    expect(screen.getByText("利用するAIツールの優先順位・除外")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "データ" }));
    expect(screen.getByText("端末移行・データ管理")).toBeInTheDocument();
    // データタブでは保存ボタン自体を表示しない（DataMigrationPanel専用の操作のため）。
    expect(screen.queryByRole("button", { name: "保存済み" })).not.toBeInTheDocument();
  });
});
