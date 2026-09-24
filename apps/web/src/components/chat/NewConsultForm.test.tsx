import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "@/router";
import { NewConsultForm } from "./NewConsultForm";

// localStorageへの下書き退避・復元と
// 送信フローを検証する。PageTitleRow（HelpLink）がreact-routerのLinkを使うためMemoryRouterで包む

const DRAFT_KEY = "em-chat-new-consult-draft";

function renderForm(props: React.ComponentProps<typeof NewConsultForm>) {
  return render(
    <MemoryRouter>
      <NewConsultForm {...props} />
    </MemoryRouter>,
  );
}

describe("NewConsultForm", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it("initialTaskがあればそれを初期値にする", () => {
    renderForm({ initialTask: "プリフィルされた内容", queryJournalId: null, fetchWithNameConfirm: vi.fn(), onStarted: vi.fn() });
    expect(screen.getByLabelText("相談したいこと")).toHaveValue("プリフィルされた内容");
  });

  it("initialTaskが無ければlocalStorageの下書きを初期値にする", () => {
    window.localStorage.setItem(DRAFT_KEY, "退避された下書き");
    renderForm({ initialTask: "", queryJournalId: null, fetchWithNameConfirm: vi.fn(), onStarted: vi.fn() });
    expect(screen.getByLabelText("相談したいこと")).toHaveValue("退避された下書き");
  });

  it("入力するたびにlocalStorageへ下書きを保存する", async () => {
    const user = userEvent.setup();
    renderForm({ initialTask: "", queryJournalId: null, fetchWithNameConfirm: vi.fn(), onStarted: vi.fn() });
    await user.type(screen.getByLabelText("相談したいこと"), "新しい内容");
    expect(window.localStorage.getItem(DRAFT_KEY)).toBe("新しい内容");
  });

  it("送信するとfetchWithNameConfirmを呼び、成功したら下書きを消してonStartedを呼ぶ", async () => {
    const fetchWithNameConfirm = vi.fn().mockResolvedValue({ res: { ok: true }, data: { run: { id: "run-new" } } });
    const onStarted = vi.fn();
    const user = userEvent.setup();
    renderForm({ initialTask: "相談内容", queryJournalId: "journal-1", fetchWithNameConfirm, onStarted });
    await user.click(screen.getByRole("button", { name: "相談を始める" }));

    expect(fetchWithNameConfirm).toHaveBeenCalledWith(
      "/api/agents",
      {
        method: "POST",
        body: { agentName: "Lead Agent", task: "相談内容", sourceJournalId: "journal-1", requireExecConsult: undefined },
      },
      "送信する",
    );
    expect(onStarted).toHaveBeenCalledWith("run-new");
    expect(screen.getByLabelText("相談したいこと")).toHaveValue("");
    expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it("失敗時はエラーメッセージを表示する", async () => {
    const fetchWithNameConfirm = vi.fn().mockResolvedValue({ res: { ok: false }, data: { error: "開始に失敗しました" } });
    const user = userEvent.setup();
    renderForm({ initialTask: "相談内容", queryJournalId: null, fetchWithNameConfirm, onStarted: vi.fn() });
    await user.click(screen.getByRole("button", { name: "相談を始める" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("開始に失敗しました");
  });

  it("経営／役員目線のチェックを付けるとrequireExecConsultがtrueで送信される", async () => {
    const fetchWithNameConfirm = vi.fn().mockResolvedValue({ res: { ok: true }, data: { run: { id: "run-new" } } });
    const user = userEvent.setup();
    renderForm({ initialTask: "相談内容", queryJournalId: null, fetchWithNameConfirm, onStarted: vi.fn() });
    await user.click(screen.getByLabelText(/経営／役員目線の厳しいレビューも聞く/));
    await user.click(screen.getByRole("button", { name: "相談を始める" }));

    expect(fetchWithNameConfirm).toHaveBeenCalledWith(
      "/api/agents",
      expect.objectContaining({ body: expect.objectContaining({ requireExecConsult: true }) }),
      "送信する",
    );
  });
});
