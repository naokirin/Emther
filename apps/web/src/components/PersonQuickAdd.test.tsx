import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PERSON_REGISTERED_EVENT } from "./personQuickAddEvents";
import { PersonQuickAdd } from "./PersonQuickAdd";

// web/src/components/PersonQuickAdd.tsx（Next.js版）はNextに依存しない実装（stylesの
// importパスのみ変更）のため移植は単純だが、専用テストが元々無かったため新規に追加する
// （フェーズ3.5、ルートシェル）。
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PersonQuickAdd", () => {
  it("「＋人を追加」クリックでダイアログを開き、正式名未入力では登録ボタンが無効", async () => {
    const user = userEvent.setup();
    render(<PersonQuickAdd />);
    await user.click(screen.getByRole("button", { name: "＋ 人を追加" }));
    expect(screen.getByRole("button", { name: "登録する" })).toBeDisabled();
  });

  it("登録に成功すると人物登録イベントを発火し、成功メッセージを表示する", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ person: { name: "山田さん", aliases: ["Yamada"] } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const onRegistered = vi.fn();
    window.addEventListener(PERSON_REGISTERED_EVENT, onRegistered);

    const user = userEvent.setup();
    render(<PersonQuickAdd />);
    await user.click(screen.getByRole("button", { name: "＋ 人を追加" }));
    await user.type(screen.getByLabelText("正式名"), "山田さん");
    await user.click(screen.getByRole("button", { name: "登録する" }));

    expect(await screen.findByText("「山田さん」を登録しました（別名 1 件）")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/people",
      expect.objectContaining({ method: "POST" }),
    );
    expect(onRegistered).toHaveBeenCalledTimes(1);
    window.removeEventListener(PERSON_REGISTERED_EVENT, onRegistered);
  });
});
