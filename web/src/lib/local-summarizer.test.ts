import { describe, expect, it, vi } from "vitest";
import { summarizeLogLocally, structureDailyReflectionLocally } from "./local-summarizer";

vi.mock("@/lib/local-model", () => ({
  runLocalChat: vi.fn(async (messages: { role: string; content: string }[]) => {
    const userContent = messages.find((m) => m.role === "user")?.content ?? "";
    if (userContent.includes("振り返り")) {
      return "**【事実・出来事】**\n- Aさんと1on1を実施した\n\n**【EMの判断・対応】**\n- 来週追加面談をセットした\n\n**【気づき・シグナル】**\n- 業務負荷が高まっている兆候あり";
    }
    return "**【決定事項・合意】**\n- 新機能リリースの延期を決定\n\n**【状況変化・シグナル】**\n- QAリソース不足の兆候\n\n**【ネクストアクション】**\n- ステークホルダーへ連絡";
  }),
}));

describe("local-summarizer", () => {
  it("空文字の場合は空文字を返す", async () => {
    expect(await summarizeLogLocally("   ")).toBe("");
    expect(await structureDailyReflectionLocally("")).toBe("");
  });

  it("議事録ログをローカル要約できる", async () => {
    const rawText = "本日の定例ミーティング。\n新機能リリースを来月に延期することで合意。\nQAのリソースが逼迫している。";
    const res = await summarizeLogLocally(rawText);
    expect(res).toContain("【決定事項・合意】");
    expect(res).toContain("【状況変化・シグナル】");
    expect(res).toContain("【ネクストアクション】");
  });

  it("EMの振り返りメモを構造化できる", async () => {
    const rawText = "今日Aさんと1on1。少し疲れている様子だった。来週もう一度フォローの時間を取ることにした。";
    const res = await structureDailyReflectionLocally(rawText);
    expect(res).toContain("【事実・出来事】");
    expect(res).toContain("【EMの判断・対応】");
    expect(res).toContain("【気づき・シグナル】");
  });
});
