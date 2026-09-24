import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { SuggestionsPage } from "./SuggestionsPage";
import { IdResolveProvider } from "../../components/IdFragmentLink";
import type { Suggestion } from "@emther/core/types";
import { copyTextToClipboard } from "../../lib/clipboard";
import { downloadTextFile } from "../../lib/downloadTextFile";

vi.mock("../../lib/clipboard", () => ({
  copyTextToClipboard: vi.fn(async () => true),
}));

vi.mock("../../lib/downloadTextFile", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/downloadTextFile")>();
  return {
    ...actual,
    downloadTextFile: vi.fn(() => true),
  };
});

// テーマメニュー・絞り込みポップオーバー・4列表・デフォルトの確認済み非表示に絞る

function suggestion(overrides: Partial<Suggestion> = {}): Suggestion {
  return {
    id: `sug-${Math.random()}`,
    title: "提案タイトル",
    reviewStatus: "unreviewed",
    confirmPriority: "normal",
    memos: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

function createWrapper(onPeekOpen?: (id: string) => void) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <IdResolveProvider openSuggestionInPeek={onPeekOpen}>
            {children}
            <LocationProbe />
          </IdResolveProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );
  };
}

describe("SuggestionsPage", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    window.localStorage.clear();
    fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/suggestions") {
        return {
          ok: true,
          json: async () => ({
            suggestions: [
              suggestion({ id: "sug-open", title: "未確認の提案" }),
              suggestion({ id: "sug-done", title: "確認済みの提案", reviewStatus: "done" }),
              suggestion({
                id: "sug-theme",
                title: "テーマ付き提案",
                themeId: "theme-1",
              }),
            ],
          }),
        };
      }
      if (url === "/api/themes") {
        return {
          ok: true,
          json: async () => ({
            themes: [
              {
                id: "theme-1",
                title: "優先度の高いセキュリティリスクの排除とリスク運用実現",
                summary: "重大インシデントにつながる穴を先に潰す",
                rationale: "",
                facts: [],
                evidenceJournalIds: [],
                evidenceSuggestionIds: [],
                status: "adopted",
                createdAt: 1,
                updatedAt: 1,
                adoptedAt: 1,
              },
            ],
          }),
        };
      }
      if (url === "/api/teams") return { ok: true, json: async () => ({ teams: [] }) };
      if (url === "/api/agents") return { ok: true, json: async () => ({ runs: [], pendingAgentStarts: [], pendingUnmaskedSends: [] }) };
      if (url === "/api/settings/rules") return { ok: true, json: async () => ({ rules: { agentStaleAfterSeconds: 120 } }) };
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
    vi.mocked(copyTextToClipboard).mockClear();
    vi.mocked(downloadTextFile).mockClear();
  });

  it("デフォルトでは確認済み（done）の提案を表示しない", async () => {
    render(<SuggestionsPage />, { wrapper: createWrapper() });
    expect(await screen.findByText("未確認の提案")).toBeInTheDocument();
    expect(screen.queryByText("確認済みの提案")).not.toBeInTheDocument();
  });

  it("「確認済みも表示する」と確認状態フィルタの両方をONにすると表示される", async () => {
    const user = userEvent.setup();
    render(<SuggestionsPage />, { wrapper: createWrapper() });
    await screen.findByText("未確認の提案");
    await user.click(screen.getByRole("button", { name: "絞り込み" }));
    const dialog = screen.getByRole("dialog", { name: "絞り込み" });
    await user.click(within(dialog).getByLabelText(/確認済み（もう追わない）も表示する/));
    await user.click(within(dialog).getByRole("checkbox", { name: "✅ 確認済み" }));
    await user.click(within(dialog).getByRole("button", { name: /適用する/ }));
    expect(await screen.findByText("確認済みの提案")).toBeInTheDocument();
  });

  it("キーワード検索でタイトルが一致しない提案を除外する", async () => {
    const user = userEvent.setup();
    render(<SuggestionsPage />, { wrapper: createWrapper() });
    await screen.findByText("未確認の提案");
    await user.type(screen.getByLabelText(/このテーマ内を検索/), "存在しないキーワード");
    expect(screen.queryByText("未確認の提案")).not.toBeInTheDocument();
    expect(screen.getByText("条件に一致する提案はありません。")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("q=");
  });

  it("テーマ選択と絞り込みが URL に残り、初期エントリから復元できる", async () => {
    const user = userEvent.setup();
    render(<SuggestionsPage />, { wrapper: createWrapper() });
    await screen.findByText("未確認の提案");
    await user.click(screen.getByRole("combobox", { name: "いま向き合うテーマ" }));
    await user.click(await screen.findByRole("option", { name: /優先度の高いセキュリティリスク/ }));
    expect(screen.getByTestId("location")).toHaveTextContent("theme=theme-1");

    await user.click(screen.getByRole("button", { name: "絞り込み" }));
    const dialog = screen.getByRole("dialog", { name: "絞り込み" });
    await user.click(within(dialog).getByLabelText(/確認済み（もう追わない）も表示する/));
    await user.click(within(dialog).getByRole("button", { name: /適用する/ }));
    expect(screen.getByTestId("location")).toHaveTextContent("done=1");
  });

  it("URL の theme/q から初期状態を復元する", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={["/suggestions?theme=theme-1&q=テーマ付き"]}>
            <IdResolveProvider>{children}</IdResolveProvider>
            <LocationProbe />
          </MemoryRouter>
        </QueryClientProvider>
      );
    }
    render(<SuggestionsPage />, { wrapper: Wrapper });
    expect(await screen.findByText("テーマ付き提案")).toBeInTheDocument();
    expect(screen.queryByText("未確認の提案")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/このテーマ内を検索/)).toHaveValue("テーマ付き");
  });

  it("タイトルをクリックするとサイドピークを開く", async () => {
    const onPeekOpen = vi.fn();
    const user = userEvent.setup();
    render(<SuggestionsPage />, { wrapper: createWrapper(onPeekOpen) });
    await user.click(await screen.findByText("未確認の提案"));
    expect(onPeekOpen).toHaveBeenCalledWith("sug-open");
  });

  it("テーマメニューで特定テーマを選ぶとそのテーマの提案だけ残る", async () => {
    const user = userEvent.setup();
    render(<SuggestionsPage />, { wrapper: createWrapper() });
    await screen.findByText("未確認の提案");
    await user.click(screen.getByRole("combobox", { name: "いま向き合うテーマ" }));
    await user.click(await screen.findByRole("option", { name: /優先度の高いセキュリティリスク/ }));
    expect(await screen.findByText("テーマ付き提案")).toBeInTheDocument();
    expect(screen.queryByText("未確認の提案")).not.toBeInTheDocument();
  });

  it("提案未作成のLead Agent Runをクリックすると、その相談をrunIdで指定して/chatへ遷移する", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/suggestions") return { ok: true, json: async () => ({ suggestions: [] }) };
      if (url === "/api/themes") return { ok: true, json: async () => ({ themes: [] }) };
      if (url === "/api/teams") return { ok: true, json: async () => ({ teams: [] }) };
      if (url === "/api/agents") {
        return {
          ok: true,
          json: async () => ({
            runs: [
              {
                id: "run-lead-1",
                agentName: "Lead Agent",
                task: "相談内容",
                status: "idle",
                log: [],
                totalCostUsd: 0,
                createdAt: 0,
                updatedAt: 0,
                origin: "manual",
                reviewed: true,
              },
            ],
            pendingAgentStarts: [],
            pendingUnmaskedSends: [],
          }),
        };
      }
      if (url === "/api/settings/rules") return { ok: true, json: async () => ({ rules: { agentStaleAfterSeconds: 120 } }) };
      return { ok: true, json: async () => ({}) };
    });
    const user = userEvent.setup();
    render(<SuggestionsPage />, { wrapper: createWrapper() });
    await user.click(await screen.findByText("Lead Agent"));
    expect(screen.getByTestId("location")).toHaveTextContent("/chat?runId=run-lead-1");
  });

  it("未選択時はフィルタ結果をTSVでコピーする", async () => {
    const user = userEvent.setup();
    render(<SuggestionsPage />, { wrapper: createWrapper() });
    await screen.findByText("未確認の提案");
    await user.click(screen.getByRole("button", { name: /^エクスポート/ }));
    await user.click(screen.getByRole("button", { name: "表をコピー（TSV）" }));
    expect(await screen.findByText(/2件をコピーしました/)).toBeInTheDocument();
    expect(copyTextToClipboard).toHaveBeenCalled();
    const text = vi.mocked(copyTextToClipboard).mock.calls[0]![0];
    expect(text.split("\n")[0]).toBe(
      "タイトル\t結論\t根拠\t判断ロジック\t進め方のアドバイス\tメモ\tテーマ\tチーム\t確認優先度\t確認状態\t確認期日\tEmther ID\tEmther URL",
    );
    expect(text).toContain("未確認の提案");
    expect(text).toContain("テーマ付き提案");
    expect(text).not.toContain("確認済みの提案");
  });

  it("列設定でidだけにしてからコピーするとヘッダーが変わる", async () => {
    const user = userEvent.setup();
    render(<SuggestionsPage />, { wrapper: createWrapper() });
    await screen.findByText("未確認の提案");
    await user.click(screen.getByRole("button", { name: /^エクスポート/ }));
    await user.click(screen.getByRole("button", { name: "列の順・表示" }));
    for (;;) {
      const removers = screen
        .getAllByRole("button", { name: /を外す$/ })
        .filter((b) => b.getAttribute("aria-label") !== "Emther IDを外す");
      if (removers.length === 0) break;
      await user.click(removers[0]!);
    }
    await user.click(screen.getByRole("button", { name: "‹ エクスポート" }));
    await user.click(screen.getByRole("button", { name: "表をコピー（TSV）" }));
    expect(await screen.findByText(/2件をコピーしました/)).toBeInTheDocument();
    const text = vi.mocked(copyTextToClipboard).mock.calls.at(-1)![0];
    expect(text.split("\n")[0]).toBe("Emther ID");
  });

  it("すべての列を追加すると未選択列が消える", async () => {
    const user = userEvent.setup();
    render(<SuggestionsPage />, { wrapper: createWrapper() });
    await screen.findByText("未確認の提案");
    await user.click(screen.getByRole("button", { name: /^エクスポート/ }));
    await user.click(screen.getByRole("button", { name: "列の順・表示" }));
    expect(screen.getByText("追加できる列")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "＋ AI結論" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "すべての列を追加" }));
    expect(screen.queryByText("追加できる列")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "すべての列を追加" })).toBeDisabled();
  });

  it("CSV を保存するとファイルダウンロードを起動する", async () => {
    const user = userEvent.setup();
    render(<SuggestionsPage />, { wrapper: createWrapper() });
    await screen.findByText("未確認の提案");
    await user.click(screen.getByRole("button", { name: /^エクスポート/ }));
    await user.click(screen.getByRole("button", { name: "CSV を保存" }));
    expect(await screen.findByText(/2件を emther-suggestions-.*\.csv に保存しました/)).toBeInTheDocument();
    expect(downloadTextFile).toHaveBeenCalled();
    const [fileName, body] = vi.mocked(downloadTextFile).mock.calls[0]!;
    expect(fileName).toMatch(/^emther-suggestions-\d{8}-\d{6}\.csv$/);
    expect(String(body).startsWith("\uFEFF")).toBe(true);
    expect(String(body)).toContain(
      "タイトル,結論,根拠,判断ロジック,進め方のアドバイス,メモ,テーマ,チーム,確認優先度,確認状態,確認期日,Emther ID,Emther URL",
    );
  });
});
