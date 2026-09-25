import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DailyReflectionForm } from "./DailyReflectionForm";

describe("DailyReflectionForm", () => {
  const onCreated = vi.fn();

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, opts?: RequestInit) => {
        if (url === "/api/journal/local-summarize") {
          const body = opts?.body ? JSON.parse(opts.body as string) : {};
          if (body.mode === "question") {
            return {
              ok: true,
              json: async () => ({
                question:
                  body.history?.length > 0
                    ? "なるほど、そのようなことがあったのですね。チームメンバーの様子や変化はどうでしたか？"
                    : "お疲れ様でした。今日一日を振り返って、印象に残っている出来事や進んだことはありますか？会議、1on1、トラブル対応など、事実ベースでざっと挙げていただいて構いません。",
              }),
            };
          }
          return {
            ok: true,
            json: async () => ({
              summary: "**【今日やったこと・進めたこと】**\n- Aさんと面談\n\n**【気づき】**\n- 順調",
            }),
          };
        }
        if (url === "/api/journal") {
          return {
            ok: true,
            json: async () => ({ entry: { id: "j-1" }, entries: [] }),
          };
        }
        return { ok: true, json: async () => ({}) };
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    onCreated.mockClear();
  });

  it("初期待機画面では「振り返りを始める」ボタンが表示される", () => {
    render(<DailyReflectionForm onCreated={onCreated} />);
    expect(screen.getByText(/1日の終わりの振り返り/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "✨ 振り返りを始める" })).toBeInTheDocument();
  });

  it("「振り返りを始める」を押すとAIの問いかけが始まり、対話を進めてまとめることができる", async () => {
    const user = userEvent.setup();
    render(<DailyReflectionForm onCreated={onCreated} />);

    // 開始
    await user.click(screen.getByRole("button", { name: "✨ 振り返りを始める" }));

    // AIの最初の問いかけ（定型: 出来事・事実）が表示される
    expect(await screen.findByText(/印象に残っている出来事や進んだこと/)).toBeInTheDocument();

    // ユーザーが返答を入力して送信
    const input = screen.getByPlaceholderText(/回答を入力/);
    await user.type(input, "今日はAさんと評価面談をしました。");
    await user.click(screen.getByRole("button", { name: /送信/ }));

    // AIの次の問いかけが表示される
    expect(await screen.findByText(/チームメンバーの様子や変化はどうでしたか？/)).toBeInTheDocument();

    // 「振り返りをまとめる」を押す
    const summarizeBtn = screen.getByRole("button", { name: /この内容で振り返りをまとめる/ });
    await user.click(summarizeBtn);

    // 構造化された振り返りメモが表示される
    expect(await screen.findByText(/対話内容を構造化しました/)).toBeInTheDocument();
    expect(screen.getByDisplayValue(/Aさんと面談/)).toBeInTheDocument();

    // 保存する
    const saveBtn = screen.getByRole("button", { name: /この内容でジャーナルに保存/ });
    await user.click(saveBtn);

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalled();
    });
  });
});
