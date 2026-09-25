import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  summarizeLogLocally,
  structureDailyReflectionLocally,
  generateNextReflectionQuestionLocally,
} from "./local-summarizer";

const mockRunLocalChat = vi.fn();
vi.mock("./local-model", () => ({
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

  it("構造化プロンプトは system + 入力のみ（few-shot ターンを注入しない）", async () => {
    const rawText = "今日はリリース準備で忙しかった。明日のスコープを少し削ることにした。";
    mockRunLocalChat.mockResolvedValueOnce(
      "**【事実・出来事】**\n- リリース準備で忙しかった\n\n**【EMの判断・対応】**\n- 明日のスコープを削る\n\n**【気づき・シグナル】**\n- なし",
    );
    await structureDailyReflectionLocally(rawText);
    const messages = mockRunLocalChat.mock.calls[0][0] as { role: string; content: string }[];
    expect(messages).toEqual([
      { role: "system", content: expect.any(String) },
      { role: "user", content: rawText },
    ]);
  });

  it("構造化: 入力にない人名を含む出力は棄却してフォールバックする", async () => {
    mockRunLocalChat.mockResolvedValueOnce(
      "**【事実・出来事】**\n- 田中さんの1on1がスキップされた\n\n**【EMの判断・対応】**\n- 明日声かけする\n\n**【気づき・シグナル】**\n- 抱え込み気味",
    );
    const rawText = "今日はリリース準備で忙しかった。明日のスコープを少し削ることにした。";
    const res = await structureDailyReflectionLocally(rawText);
    expect(res).not.toContain("田中");
    expect(res).toContain("【事実・出来事】");
    expect(res).toContain("リリース準備で忙しかった");
  });

  it("1on1対話: 最初の問いかけ（Turn 0）で1日の全体感を優しく尋ねる", async () => {
    const q0 = await generateNextReflectionQuestionLocally([]);
    expect(q0).toContain("お疲れ様でした！今日も一日お疲れ様でした。今日はどんな一日でしたか？");
  });

  it("ローカルLLM連携: EMの発言を受けた文脈に即した問いかけを生成して返す", async () => {
    mockRunLocalChat.mockResolvedValueOnce(
      "普段遅刻のない田中さんがスキップされたとなると、何か急なトラブルがないか心配になりますね。\n最近の田中さんの業務負荷で、気になる変化や兆候は思い当たりますか？",
    );
    const history = [
      { role: "assistant" as const, content: "今日はどんな一日でしたか？" },
      {
        role: "user" as const,
        content: "本日は田中さんの1on1がスキップされたことに気づきました。普段は遅刻もしないメンバーなので少し心配です。",
      },
    ];
    const res = await generateNextReflectionQuestionLocally(history);
    expect(res).toContain("普段遅刻のない田中さんがスキップされたとなると");
    expect(res).toContain("最近の田中さんの業務負荷で、気になる変化や兆候は思い当たりますか？");
    expect(mockRunLocalChat).toHaveBeenCalled();
    // Journal・few-shot は渡さず、system + チャット履歴だけを材料にする
    const messages = mockRunLocalChat.mock.calls[0][0] as { role: string; content: string }[];
    expect(messages[0]?.role).toBe("system");
    expect(messages.some((m) => m.content.includes("今日のメモ"))).toBe(false);
    expect(messages.filter((m) => m.role === "user" || m.role === "assistant")).toEqual(history);
  });

  it("問いかけプロンプトは system + 対話履歴のみ（few-shot ターンを注入しない）", async () => {
    mockRunLocalChat.mockResolvedValueOnce(
      "共有ありがとうございます。今日特に印象に残ったことはありますか？",
    );
    const history = [
      { role: "assistant" as const, content: "今日はどんな一日でしたか？" },
      { role: "user" as const, content: "今日は忙しかったです。" },
    ];
    await generateNextReflectionQuestionLocally(history);
    const messages = mockRunLocalChat.mock.calls[0][0] as { role: string; content: string }[];
    expect(messages).toHaveLength(1 + history.length);
    expect(messages[0]?.role).toBe("system");
    expect(messages.slice(1)).toEqual(history);
  });

  it("問いかけ: 対話にない人名を含む出力は棄却してフォールバックする", async () => {
    mockRunLocalChat.mockResolvedValueOnce(
      "佐藤さんの様子が気になりますね。最近の業務負荷で思い当たることはありますか？",
    );
    const history = [
      { role: "assistant" as const, content: "今日はどんな一日でしたか？" },
      {
        role: "user" as const,
        content: "今日は田中さんと1on1を実施し、元気な様子を確認することができました。",
      },
    ];
    const res = await generateNextReflectionQuestionLocally(history);
    expect(res).not.toContain("佐藤");
    expect(res).toContain("田中さんとの1on1の様子を共有いただき");
  });

  it("1on1対話: オープニングにJournalメモへの言及を含めない", async () => {
    const q0 = await generateNextReflectionQuestionLocally([]);
    expect(q0).not.toContain("今日のメモ");
  });

  it("1on1対話フォールバック: 実施できた1on1をスキップ扱いしない", async () => {
    mockRunLocalChat.mockRejectedValueOnce(new Error("local model error"));
    const q1 = await generateNextReflectionQuestionLocally([
      { role: "assistant", content: "今日はどんな一日でしたか？" },
      {
        role: "user",
        content: "今日は田中さんと1on1を実施し、元気な様子を確認することができました。",
      },
    ]);
    expect(q1).not.toContain("スキップ");
    expect(q1).toContain("田中さんとの1on1の様子を共有いただき");
    expect(q1).toContain("印象に残った発言や、日頃と少し違う変化・兆候などはありましたか？");
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

