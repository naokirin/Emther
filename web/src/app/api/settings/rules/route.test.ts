import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@/lib/test-helpers/store-env";
import { jsonRequest } from "@/lib/test-helpers/api-route";

let dir: string;

beforeEach(() => {
  dir = setupIsolatedStoreEnv();
  vi.resetModules();
});

afterEach(() => {
  teardownIsolatedStoreEnv(dir);
});

describe("GET /api/settings/rules", () => {
  it("既定値を返す", async () => {
    const route = await import("./route");
    const res = await route.GET();
    const json = await res.json();
    expect(json.rules.maxParallelAgentRuns).toBe(2);
    expect(json.rules.perTurnBudgetUsd).toBe(0.5);
    expect(json.rules.teamParallelKickoffEnabled).toBe(true);
  });
});

describe("PATCH /api/settings/rules", () => {
  it("数値・真偽値・配列フィールドを部分更新できる", async () => {
    const route = await import("./route");
    const res = await route.PATCH(
      jsonRequest("http://localhost/x", "PATCH", {
        teamWindowDays: 30,
        autoAnomalyDetectionEnabled: true,
      }),
    );
    const json = await res.json();
    expect(json.rules.teamWindowDays).toBe(30);
    expect(json.rules.autoAnomalyDetectionEnabled).toBe(true);
    expect(json.rules.maxParallelAgentRuns).toBe(2); // 未指定は既定値のまま
  });

  it("maxParallelAgentRunsは0以下にできない（デッドロック防止で最低1に丸める）", async () => {
    const route = await import("./route");
    const res = await route.PATCH(jsonRequest("http://localhost/x", "PATCH", { maxParallelAgentRuns: 0 }));
    expect((await res.json()).rules.maxParallelAgentRuns).toBe(1);
  });

  it("perTurnBudgetUsdを更新でき、0以下は最低0.01に丸める", async () => {
    const route = await import("./route");
    const ok = await route.PATCH(jsonRequest("http://localhost/x", "PATCH", { perTurnBudgetUsd: 2.5 }));
    expect((await ok.json()).rules.perTurnBudgetUsd).toBe(2.5);
    const clamped = await route.PATCH(jsonRequest("http://localhost/x", "PATCH", { perTurnBudgetUsd: 0 }));
    expect((await clamped.json()).rules.perTurnBudgetUsd).toBe(0.01);
  });

  it("decisionQueueLimit/observationQueueLimit/staleInterventionDaysを更新できる", async () => {
    const route = await import("./route");
    const res = await route.PATCH(
      jsonRequest("http://localhost/x", "PATCH", {
        decisionQueueLimit: 5,
        observationQueueLimit: 10,
        staleInterventionDays: 3,
      }),
    );
    const json = await res.json();
    expect(json.rules.decisionQueueLimit).toBe(5);
    expect(json.rules.observationQueueLimit).toBe(10);
    expect(json.rules.staleInterventionDays).toBe(3);
  });

  it("Journal/Issue自動分析のフィルタとフラグを更新できる", async () => {
    const route = await import("./route");
    const res = await route.PATCH(
      jsonRequest("http://localhost/x", "PATCH", {
        autoAnomalyDetectionEnabled: true,
        autoJournalUrgencyFilter: "mid_or_higher",
        autoJournalSentimentFilter: "negative_only",
        autoIssueUpdateAnalysisEnabled: true,
      }),
    );
    const json = await res.json();
    expect(json.rules.autoAnomalyDetectionEnabled).toBe(true);
    expect(json.rules.autoJournalUrgencyFilter).toBe("mid_or_higher");
    expect(json.rules.autoJournalSentimentFilter).toBe("negative_only");
    expect(json.rules.autoIssueUpdateAnalysisEnabled).toBe(true);
  });

  it("teamParallelKickoffEnabledを更新できる", async () => {
    const route = await import("./route");
    const res = await route.PATCH(
      jsonRequest("http://localhost/x", "PATCH", { teamParallelKickoffEnabled: false }),
    );
    expect((await res.json()).rules.teamParallelKickoffEnabled).toBe(false);
  });

  it("不正なJournalフィルタ値は無視する", async () => {
    const route = await import("./route");
    const res = await route.PATCH(
      jsonRequest("http://localhost/x", "PATCH", {
        autoJournalUrgencyFilter: "bogus",
        autoJournalSentimentFilter: "positive_only",
      }),
    );
    const json = await res.json();
    expect(json.rules.autoJournalUrgencyFilter).toBe("high_only");
    expect(json.rules.autoJournalSentimentFilter).toBe("all");
  });

  it("型が不正な値は無視する（既定値のまま）", async () => {
    const route = await import("./route");
    const res = await route.PATCH(jsonRequest("http://localhost/x", "PATCH", { teamWindowDays: "not-a-number" }));
    expect((await res.json()).rules.teamWindowDays).toBe(14);
  });

  // ユーザー指摘「AIツールの優先度設定が増えたことでフォールバック設定との競合が
  // 発生している」「エージェントごとに設定できる必要はない、全体で1つで大丈夫」
  // 「claude codeが外せないようになっている」対応。以前のcliPriorityOrder
  // （全エージェント共通の並び順）+ agyFallbackAgents/cursorFallbackAgents
  // （エージェント種別ごとのON/OFF）を、全エージェント共通の単一のCLI優先順位
  // リストcliOrderへ統合した。claudeも他の2つと同様に除外できる。
  describe("cliOrder", () => {
    it("CLIの優先順位・除外を設定できる", async () => {
      const route = await import("./route");
      const res = await route.PATCH(jsonRequest("http://localhost/x", "PATCH", { cliOrder: ["cursor", "claude", "agy"] }));
      expect((await res.json()).rules.cliOrder).toEqual(["cursor", "claude", "agy"]);
    });

    it("claudeを含まない配列も設定できる（claudeも除外できる）", async () => {
      const route = await import("./route");
      const res = await route.PATCH(jsonRequest("http://localhost/x", "PATCH", { cliOrder: ["agy", "cursor"] }));
      expect((await res.json()).rules.cliOrder).toEqual(["agy", "cursor"]);
    });

    it("重複した値がある配列は無視する（既定値のまま）", async () => {
      const route = await import("./route");
      const res = await route.PATCH(jsonRequest("http://localhost/x", "PATCH", { cliOrder: ["claude", "claude"] }));
      expect((await res.json()).rules.cliOrder).toEqual(["claude"]);
    });

    it("知らない値が含まれる配列は無視する（既定値のまま）", async () => {
      const route = await import("./route");
      const res = await route.PATCH(jsonRequest("http://localhost/x", "PATCH", { cliOrder: ["claude", "bogus"] }));
      expect((await res.json()).rules.cliOrder).toEqual(["claude"]);
    });

    it("空配列は無視する（既定値のまま）", async () => {
      const route = await import("./route");
      const res = await route.PATCH(jsonRequest("http://localhost/x", "PATCH", { cliOrder: [] }));
      expect((await res.json()).rules.cliOrder).toEqual(["claude"]);
    });
  });

  // ユーザー要望「エージェント種別ごとのモデル系統に関して、Cursor/agyについても調整
  // できるようにしたい」対応。
  describe("agentAgyModels / agentCursorModels", () => {
    it("エージェント種別ごとのモデル名を設定できる", async () => {
      const route = await import("./route");
      const res = await route.PATCH(
        jsonRequest("http://localhost/x", "PATCH", {
          agentAgyModels: { "Lead Agent": "gemini-custom" },
          agentCursorModels: { "Lead Agent": "gpt-custom" },
        }),
      );
      const json = await res.json();
      expect(json.rules.agentAgyModels).toEqual({ "Lead Agent": "gemini-custom" });
      expect(json.rules.agentCursorModels).toEqual({ "Lead Agent": "gpt-custom" });
    });

    it("AGENT_OPTIONSに無いキーは落とす", async () => {
      const route = await import("./route");
      const res = await route.PATCH(
        jsonRequest("http://localhost/x", "PATCH", { agentAgyModels: { "存在しないエージェント": "gemini-x" } }),
      );
      expect((await res.json()).rules.agentAgyModels).toEqual({});
    });

    it("空文字列（trim後）のモデル名は落とす（既定モデルへ戻す）", async () => {
      const route = await import("./route");
      const res = await route.PATCH(jsonRequest("http://localhost/x", "PATCH", { agentAgyModels: { "Lead Agent": "   " } }));
      expect((await res.json()).rules.agentAgyModels).toEqual({});
    });

    it("前後の空白はtrimして保存する", async () => {
      const route = await import("./route");
      const res = await route.PATCH(
        jsonRequest("http://localhost/x", "PATCH", { agentAgyModels: { "Lead Agent": "  gemini-custom  " } }),
      );
      expect((await res.json()).rules.agentAgyModels).toEqual({ "Lead Agent": "gemini-custom" });
    });
  });

  // ユーザー要望「メンバーに自分自身を追加したいが区別できない」対応。
  describe("selfPersonId", () => {
    it("登録済み人物を利用者本人として設定・解除できる", async () => {
      const peopleDirectory = await import("@/lib/people-directory");
      const id = peopleDirectory.registerName("EM本人");
      const route = await import("./route");
      const setRes = await route.PATCH(jsonRequest("http://localhost/x", "PATCH", { selfPersonId: id }));
      expect((await setRes.json()).rules.selfPersonId).toBe(id);
      const clearRes = await route.PATCH(jsonRequest("http://localhost/x", "PATCH", { selfPersonId: null }));
      expect((await clearRes.json()).rules.selfPersonId).toBeNull();
    });

    it("存在しない人物IDは400を返す", async () => {
      const route = await import("./route");
      const res = await route.PATCH(jsonRequest("http://localhost/x", "PATCH", { selfPersonId: "PERSON_999" }));
      expect(res.status).toBe(400);
    });
  });
});
