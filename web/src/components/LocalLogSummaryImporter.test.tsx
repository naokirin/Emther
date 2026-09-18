// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LocalLogSummaryImporter } from "./LocalLogSummaryImporter";

describe("LocalLogSummaryImporter", () => {
  const onCreated = vi.fn();

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/journal/local-summarize") {
          return {
            ok: true,
            json: async () => ({
              summary: "**【決定事項・合意】**\n- リリース日決定\n\n**【状況変化・シグナル】**\n- リソース逼迫",
            }),
          };
        }
        if (url === "/api/journal") {
          return {
            ok: true,
            json: async () => ({ entry: { id: "j-2" } }),
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

  it("機微情報保護バナーとテキストエリアが表示される", () => {
    render(<LocalLogSummaryImporter onCreated={onCreated} />);
    expect(screen.getByText(/機微情報保護・ローカル要約/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/議事録やチャットログ等のテキストを貼り付けてください/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ローカルLLMで要約・シグナル抽出/ })).toBeDisabled();
  });

  it("テキストを入力して要約を実行すると、手直し可能な要約が表示され保存できる", async () => {
    const user = userEvent.setup();
    render(<LocalLogSummaryImporter onCreated={onCreated} />);

    const textarea = screen.getByPlaceholderText(/議事録やチャットログ等のテキストを貼り付けてください/);
    await user.type(textarea, "定例会議の議事録テキスト。");

    const summarizeBtn = screen.getByRole("button", { name: /ローカルLLMで要約・シグナル抽出/ });
    expect(summarizeBtn).toBeEnabled();

    await user.click(summarizeBtn);
    expect(await screen.findByText(/抽出された要約シグナル/)).toBeInTheDocument();

    const saveBtn = screen.getByRole("button", { name: /手直ししてジャーナルに登録/ });
    await user.click(saveBtn);
    expect(onCreated).toHaveBeenCalled();
  });
});
