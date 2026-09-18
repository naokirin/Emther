// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DailyReflectionForm } from "./DailyReflectionForm";

describe("DailyReflectionForm", () => {
  const onCreated = vi.fn();

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/journal/local-summarize") {
          return {
            ok: true,
            json: async () => ({
              summary: "**【事実・出来事】**\n- Aさんと1on1\n\n**【EMの判断・対応】**\n- 追加面談設定",
            }),
          };
        }
        if (url === "/api/journal") {
          return {
            ok: true,
            json: async () => ({ entry: { id: "j-1" } }),
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

  it("振り返りの問いかけとテキストエリアが表示される", () => {
    render(<DailyReflectionForm onCreated={onCreated} />);
    expect(screen.getByText(/1日の終わりの振り返り/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/今日はAさんと評価面談/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /AIと整理・シグナル抽出する/ })).toBeDisabled();
  });

  it("テキストを入力すると整理ボタンが活性化し、AI整理結果が編集可能になる", async () => {
    const user = userEvent.setup();
    render(<DailyReflectionForm onCreated={onCreated} />);

    const textarea = screen.getByPlaceholderText(/今日はAさんと評価面談/);
    await user.type(textarea, "今日はAさんと面談した。");

    const structureBtn = screen.getByRole("button", { name: /AIと整理・シグナル抽出する/ });
    expect(structureBtn).toBeEnabled();

    await user.click(structureBtn);
    expect(await screen.findByText(/AI整理結果/)).toBeInTheDocument();

    const saveBtn = screen.getByRole("button", { name: /この内容でジャーナルに確定保存/ });
    await user.click(saveBtn);
    expect(onCreated).toHaveBeenCalled();
  });
});
