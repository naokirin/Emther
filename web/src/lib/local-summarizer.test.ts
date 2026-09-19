import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  summarizeLogLocally,
  structureDailyReflectionLocally,
  generateNextReflectionQuestionLocally,
} from "./local-summarizer";

const mockRunLocalChat = vi.fn();
vi.mock("@core/local-model", () => ({
  runLocalChat: (...args: unknown[]) => mockRunLocalChat(...args),
}));

describe("local-summarizer", () => {
  beforeEach(() => {
    mockRunLocalChat.mockReset();
    // デフォルトは要約用モック、対話・構造化はテストごとに指定
    mockRunLocalChat.mockImplementation(async (messages: { role: string; content: string }[]) => {
      const userContent = messages.find((m) => m.role === "user")?.content ?? "";
      if (userContent.includes("要約")) {
        return "**【決定事項・合意】**\n- 新機能リリースの延期を決定\n\n**【状況変化・シグナル】**\n- QAリソース不足の兆候\n\n**【ネクストアクション】**\n- ステークホルダーへ連絡";
      }
      return "";
    });
  });

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

  it("EMの振り返りメモを構造化できる（ローカルLLM）", async () => {
    mockRunLocalChat.mockResolvedValueOnce(
      "**【事実・出来事】**\n- Aさんと1on1を実施\n\n**【EMの判断・対応】**\n- 来週追加面談をセット\n\n**【気づき・シグナル】**\n- 業務負荷の兆候あり",
    );
    const rawText = "今日Aさんと1on1。少し疲れている様子だった。来週もう一度フォローの時間を取ることにした。";
    const res = await structureDailyReflectionLocally(rawText);
    expect(res).toContain("【事実・出来事】");
    expect(res).toContain("【EMの判断・対応】");
    expect(res).toContain("【気づき・シグナル】");
  });

  it("1on1対話: 最初の問いかけ（Turn 0）で1日の全体感を優しく尋ねる", async () => {
    const q0 = await generateNextReflectionQuestionLocally([]);
    expect(q0).toContain("お疲れ様でした！今日も一日お疲れ様でした。今日はどんな一日でしたか？");
  });

  it("ローカルLLM連携: EMの発言を受けた文脈に即した問いかけを生成して返す", async () => {
    mockRunLocalChat.mockResolvedValueOnce(
      "普段遅刻のない田中さんがスキップされたとなると、何か急なトラブルがないか心配になりますね。\n最近の田中さんの業務負荷で、気になる変化や兆候は思い当たりますか？",
    );
    const res = await generateNextReflectionQuestionLocally([
      { role: "assistant", content: "今日はどんな一日でしたか？" },
      { role: "user", content: "本日は田中さんの1on1がスキップされたことに気づきました。普段は遅刻もしないメンバーなので少し心配です。" },
    ]);
    expect(res).toContain("普段遅刻のない田中さんがスキップされたとなると");
    expect(res).toContain("最近の田中さんの業務負荷で、気になる変化や兆候は思い当たりますか？");
    expect(mockRunLocalChat).toHaveBeenCalled();
  });

  it("1on1対話フォールバック: 1on1スキップの報告（Turn 1）に対して詰問せず受容し、相手の業務負荷や兆候を深掘りする", async () => {
    mockRunLocalChat.mockRejectedValueOnce(new Error("local model error"));
    const q1 = await generateNextReflectionQuestionLocally([
      { role: "assistant", content: "今日はどんな一日でしたか？" },
      { role: "user", content: "本日は田中さんの1on1がスキップされたことに気づきました。" },
    ]);
    // 田中さんへの共感・受容
    expect(q1).toContain("田中さんとの1on1がスキップになっていたのですね");
    // なぜスキップしたか詰問しない
    expect(q1).not.toContain("なぜこのスキップになったのか");
    expect(q1).not.toContain("学びたいこと");
    // 業務負荷や兆候など背景を深掘りする
    expect(q1).toContain("最近の業務負荷や様子などで何か気になっているサインや、スキップに至った背景として思い当たることはありますか？");
  });

  it("1on1対話フォールバック: 背景・要因の共有（Turn 2）を受け、その洞察を肯定しつつEM自身の次の一手・フォローへ視点を進める", async () => {
    mockRunLocalChat.mockRejectedValueOnce(new Error("local model error"));
    const q2 = await generateNextReflectionQuestionLocally([
      { role: "assistant", content: "..." },
      { role: "user", content: "本日は田中さんの1on1がスキップされたことに気づきました。" },
      { role: "assistant", content: "..." },
      { role: "user", content: "新しい案件が重なっていて少し抱え込み気味だったようです。" },
    ]);
    expect(q2).toContain("田中さんに関して「新しい案件が重なっていて少し抱え込み気味」という背景やサインに気づかれたのですね");
    expect(q2).toContain("田中さんへどんなフォローや声かけをしてみようと思いますか？");
  });

  it("1on1対話フォールバック: EMのアクション（Turn 3）を受け、深まった思考を労いながら違和感や明日への引き継ぎを促す", async () => {
    mockRunLocalChat.mockRejectedValueOnce(new Error("local model error"));
    const q3 = await generateNextReflectionQuestionLocally([
      { role: "assistant", content: "..." },
      { role: "user", content: "本日は田中さんの1on1がスキップされたことに気づきました。" },
      { role: "assistant", content: "..." },
      { role: "user", content: "新しい案件が重なっていて少し抱え込み気味だったようです。" },
      { role: "assistant", content: "..." },
      { role: "user", content: "明日朝イチで田中さんに声かけして案件の棚卸しを一緒にやろうと思います。" },
    ]);
    expect(q3).toContain("次の一手や判断を明確に描けていらっしゃいますね");
    expect(q3).toContain("頭の片隅に引っかかっている違和感や、明日以降に意識しておきたいモヤモヤ・課題などはありますか？");
  });

  it("対話のまとめフォールバック: 各ターンの発言を事実・EMの判断・気づきに構造化できる", async () => {
    mockRunLocalChat.mockRejectedValueOnce(new Error("local model error"));
    const text = [
      "本日は田中さんの1on1がスキップされたことに気づきました。",
      "QAの残業が少し増えているのが気になりました。",
      "ロードマップの優先度を見直してスコープを削る合意を取りました。",
    ].join("\n\n");

    const res = await structureDailyReflectionLocally(text);
    expect(res).toContain("**【事実・出来事】**\n- 本日は田中さんの1on1がスキップされたことに気づきました。");
    expect(res).toContain("**【EMの判断・対応】**\n- ロードマップの優先度を見直してスコープを削る合意を取りました。");
    expect(res).toContain("**【気づき・シグナル】**\n- QAの残業が少し増えているのが気になりました。");
  });
});

