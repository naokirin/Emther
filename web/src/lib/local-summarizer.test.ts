import { describe, expect, it, vi } from "vitest";
import {
  summarizeLogLocally,
  structureDailyReflectionLocally,
  generateNextReflectionQuestionLocally,
} from "./local-summarizer";

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

  it("1on1対話: 最初の問いかけ（Turn 0）で1日の全体感を優しく尋ねる", async () => {
    const q0 = await generateNextReflectionQuestionLocally([]);
    expect(q0).toContain("お疲れ様でした！今日も一日お疲れ様でした。今日はどんな一日でしたか？");
  });

  it("1on1対話: 1on1スキップの報告（Turn 1）に対して詰問せず受容し、その相手以外のチーム全体へと優しく視野を広げる", async () => {
    const q1 = await generateNextReflectionQuestionLocally([
      { role: "assistant", content: "今日はどんな一日でしたか？" },
      { role: "user", content: "本日は田中さんの1on1がスキップされたことに気づきました。" },
    ]);
    // 田中さんへの共感・受容
    expect(q1).toContain("田中さんとの1on1がスキップになっていたのですね");
    // なぜスキップしたか詰問しない
    expect(q1).not.toContain("なぜこのスキップになったのか");
    expect(q1).not.toContain("学びたいこと");
    // 相手の名前を受け取り、その相手以外のメンバーやチーム全体へ視野を広げる
    expect(q1).toContain("その田中さん以外のメンバーやチーム全体の様子はどうでしたか？");
  });

  it("1on1対話: チーム動向の共有（Turn 2）を受け、その状況を問いかけに組み込みながらEM自身の判断・アクションへ視点を移す", async () => {
    const q2 = await generateNextReflectionQuestionLocally([
      { role: "assistant", content: "..." },
      { role: "user", content: "本日は田中さんの1on1がスキップされたことに気づきました。" },
      { role: "assistant", content: "..." },
      { role: "user", content: "QAの残業が少し増えているのが気になりました。" },
    ]);
    expect(q2).toContain("QAの状況や残業をしっかりキャッチされていますね");
    expect(q2).toContain("そうしたQAの状況や残業に向き合い、チームを支えられる中で");
    expect(q2).toContain("『判断・決定したこと』");
  });

  it("1on1対話: EM自身の判断（Turn 3）を受け、違和感やモヤモヤ・明日への引き継ぎを促す", async () => {
    const q3 = await generateNextReflectionQuestionLocally([
      { role: "assistant", content: "..." },
      { role: "user", content: "本日は田中さんの1on1がスキップされたことに気づきました。" },
      { role: "assistant", content: "..." },
      { role: "user", content: "QAの残業が少し増えているのが気になりました。" },
      { role: "assistant", content: "..." },
      { role: "user", content: "ロードマップの優先度を見直してスコープを削る合意を取りました。" },
    ]);
    expect(q3).toContain("重要な意思決定を前に進められたのですね");
    expect(q3).toContain("頭の片隅に引っかかっている違和感や、明日以降に意識しておきたいモヤモヤ");
  });

  it("対話のまとめ: 各ターンの発言を事実・EMの判断・気づきに構造化できる", async () => {
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

