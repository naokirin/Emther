import { describe, expect, it, vi } from "vitest";
import { parseOkrTextHeuristic } from "@/lib/okr-parse";

describe("parseOkrTextHeuristic", () => {
  it("Objective / メモ / 箇条書きKRを分解する", () => {
    const text = [
      "Objective: プロダクトの信頼性を上げる",
      "メモ: インシデントが四半期で増えたため",
      "- 重大インシデントを半期で50%削減する",
      "- デプロイ失敗率を1%未満にする",
    ].join("\n");
    expect(parseOkrTextHeuristic(text)).toEqual([
      {
        title: "プロダクトの信頼性を上げる",
        note: "インシデントが四半期で増えたため",
        keyResults: ["重大インシデントを半期で50%削減する", "デプロイ失敗率を1%未満にする"],
      },
    ]);
  });

  it("空行区切りと O/KR 接頭辞で複数Objectiveを分解する", () => {
    const text = [
      "O1: 顧客体験を改善する",
      "KR1: NPSを+10",
      "KR2: サポート初回解決率を80%へ",
      "",
      "O2: エンジニアリング速度を上げる",
      "KR1: リードタイムを2週間以内に",
    ].join("\n");
    expect(parseOkrTextHeuristic(text)).toEqual([
      {
        title: "顧客体験を改善する",
        keyResults: ["NPSを+10", "サポート初回解決率を80%へ"],
      },
      {
        title: "エンジニアリング速度を上げる",
        keyResults: ["リードタイムを2週間以内に"],
      },
    ]);
  });

  it("空文字は空配列", () => {
    expect(parseOkrTextHeuristic("   ")).toEqual([]);
  });
});

describe("parseOkrText", () => {
  it("モデル結果があればそれを使い、無ければヒューリスティックへ落とす", async () => {
    vi.resetModules();
    vi.doMock("@/lib/local-model", () => ({
      runLocalChat: vi.fn(async () => "not json"),
      extractFirstJsonObject: () => undefined,
    }));
    const { parseOkrText } = await import("@/lib/okr-parse");
    const result = await parseOkrText("Objective: 売上を伸ばす\n- 新規10件");
    expect(result.source).toBe("heuristic");
    expect(result.objectives[0]?.title).toBe("売上を伸ばす");
    expect(result.objectives[0]?.keyResults).toEqual(["新規10件"]);
  });
});
