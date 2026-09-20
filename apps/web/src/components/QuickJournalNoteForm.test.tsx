import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QuickJournalNoteForm } from "./QuickJournalNoteForm";

describe("QuickJournalNoteForm", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ entry: { id: "new" } }),
    }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("最初から入力欄が表示されている", () => {
    render(<QuickJournalNoteForm onCreated={vi.fn()} />);
    expect(screen.getByPlaceholderText(/1on1/)).toBeInTheDocument();
  });

  it("テキストを入力し保存すると、/api/journalへPOSTしonCreatedを呼ぶ", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    render(<QuickJournalNoteForm onCreated={onCreated} />);

    const textarea = screen.getByPlaceholderText(/1on1/);
    await user.type(textarea, "テストメモ");
    await user.click(screen.getByRole("button", { name: "保存する" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/journal",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const call = fetchMock.mock.calls[0];
    expect(JSON.parse(String(call[1]?.body))).toEqual(expect.objectContaining({ text: "テストメモ" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect((textarea as HTMLTextAreaElement).value).toBe("");
  });

  it("空欄では保存ボタンが無効", () => {
    render(<QuickJournalNoteForm onCreated={vi.fn()} />);
    expect(screen.getByRole("button", { name: "保存する" })).toBeDisabled();
  });

  it("409の人名確認ダイアログで『このまま保存する』を選ぶと再POSTして保存する", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/journal" && init?.method === "POST") {
        const body = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
        if (body.allowUnmaskedNameCandidates === true || body.registerNameCandidates === true) {
          return { ok: true, status: 201, json: async () => ({ entry: { id: "new", people: [] }, nameCandidates: [] }) };
        }
        return {
          ok: false,
          status: 409,
          json: async () => ({
            code: "NAME_CANDIDATE_CONFIRMATION_REQUIRED",
            candidates: ["新人さん"],
            message: "確認が必要です",
          }),
        };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const user = userEvent.setup();
    const onCreated = vi.fn();
    render(<QuickJournalNoteForm onCreated={onCreated} />);
    await user.type(screen.getByPlaceholderText(/1on1/), "新人さんと1on1した");
    await user.click(screen.getByRole("button", { name: "保存する" }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("新人さん")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "このまま保存する" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "＋ 新人さん" })).not.toBeInTheDocument();
  });

  it("失敗時はエラーメッセージを表示する", async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, json: async () => ({ error: "保存失敗" }) }));
    const user = userEvent.setup();
    render(<QuickJournalNoteForm onCreated={vi.fn()} />);
    await user.type(screen.getByPlaceholderText(/1on1/), "テストメモ");
    await user.click(screen.getByRole("button", { name: "保存する" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("保存失敗");
  });
});
