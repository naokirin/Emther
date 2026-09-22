import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@emther/core/test-helpers/store-env";

const ensureLocalModels = vi.fn(async () => undefined);

vi.mock("@emther/core/model-loader", () => ({
  ensureLocalModels: () => ensureLocalModels(),
}));

let dir: string;

beforeEach(() => {
  dir = setupIsolatedStoreEnv();
  ensureLocalModels.mockClear();
  vi.resetModules();
});

afterEach(() => {
  teardownIsolatedStoreEnv(dir);
});

function patch(body: unknown) {
  return { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

describe("GET /api/settings/rules", () => {
  it("既定値を返す", async () => {
    const { settingsRulesRoute } = await import("./settings-rules");
    const res = await settingsRulesRoute.request("/");
    const json = await res.json();
    expect(json.rules.maxParallelAgentRuns).toBe(2);
    expect(json.rules.perTurnBudgetUsd).toBe(0.5);
    expect(json.rules.teamParallelKickoffEnabled).toBe(true);
  });
});

describe("PATCH /api/settings/rules", () => {
  it("数値・真偽値・配列フィールドを部分更新できる", async () => {
    const { settingsRulesRoute } = await import("./settings-rules");
    const res = await settingsRulesRoute.request("/", patch({ teamWindowDays: 30, autoJournalBatchEnabled: true }));
    const json = await res.json();
    expect(json.rules.teamWindowDays).toBe(30);
    expect(json.rules.autoJournalBatchEnabled).toBe(true);
    expect(json.rules.maxParallelAgentRuns).toBe(2); // 未指定は既定値のまま
  });

  it("maxParallelAgentRunsは0以下にできない（デッドロック防止で最低1に丸める）", async () => {
    const { settingsRulesRoute } = await import("./settings-rules");
    const res = await settingsRulesRoute.request("/", patch({ maxParallelAgentRuns: 0 }));
    expect((await res.json()).rules.maxParallelAgentRuns).toBe(1);
  });

  it("perTurnBudgetUsdを更新でき、0以下は最低0.01に丸める", async () => {
    const { settingsRulesRoute } = await import("./settings-rules");
    const ok = await settingsRulesRoute.request("/", patch({ perTurnBudgetUsd: 2.5 }));
    expect((await ok.json()).rules.perTurnBudgetUsd).toBe(2.5);
    const clamped = await settingsRulesRoute.request("/", patch({ perTurnBudgetUsd: 0 }));
    expect((await clamped.json()).rules.perTurnBudgetUsd).toBe(0.01);
  });

  it("decisionQueueLimit/observationQueueLimit/staleInterventionDaysを更新できる", async () => {
    const { settingsRulesRoute } = await import("./settings-rules");
    const res = await settingsRulesRoute.request(
      "/",
      patch({ decisionQueueLimit: 5, observationQueueLimit: 10, staleInterventionDays: 3 }),
    );
    const json = await res.json();
    expect(json.rules.decisionQueueLimit).toBe(5);
    expect(json.rules.observationQueueLimit).toBe(10);
    expect(json.rules.staleInterventionDays).toBe(3);
  });

  it("Journal集約解釈バッチ／Issue自動分析のフラグと時刻を更新できる", async () => {
    const { settingsRulesRoute } = await import("./settings-rules");
    const res = await settingsRulesRoute.request(
      "/",
      patch({
        autoJournalBatchEnabled: true,
        autoJournalBatchHours: [9, 18],
        autoSuggestionUpdateAnalysisEnabled: true,
        autoDistillationWeekdays: [1, 4],
      }),
    );
    const json = await res.json();
    expect(json.rules.autoJournalBatchEnabled).toBe(true);
    expect(json.rules.autoJournalBatchHours).toEqual([9, 18]);
    expect(json.rules.autoDistillationWeekdays).toEqual([1, 4]);
    expect(json.rules.autoSuggestionUpdateAnalysisEnabled).toBe(true);
  });

  it("週次・月次レビューの自動起動フラグと曜日・日・時刻を更新できる", async () => {
    const { settingsRulesRoute } = await import("./settings-rules");
    const res = await settingsRulesRoute.request(
      "/",
      patch({
        autoWeeklyReportEnabled: true,
        autoWeeklyReportWeekday: 5,
        autoWeeklyReportHour: 9,
        autoMonthlyReportEnabled: true,
        autoMonthlyReportDay: 15,
        autoMonthlyReportHour: 10,
      }),
    );
    const json = await res.json();
    expect(json.rules.autoWeeklyReportEnabled).toBe(true);
    expect(json.rules.autoWeeklyReportWeekday).toBe(5);
    expect(json.rules.autoWeeklyReportHour).toBe(9);
    expect(json.rules.autoMonthlyReportEnabled).toBe(true);
    expect(json.rules.autoMonthlyReportDay).toBe(15);
    expect(json.rules.autoMonthlyReportHour).toBe(10);
  });

  it("月次レビューの起動日は1〜28にクランプする", async () => {
    const { settingsRulesRoute } = await import("./settings-rules");
    const high = await settingsRulesRoute.request("/", patch({ autoMonthlyReportDay: 31 }));
    expect((await high.json()).rules.autoMonthlyReportDay).toBe(28);
    const low = await settingsRulesRoute.request("/", patch({ autoMonthlyReportDay: 0 }));
    expect((await low.json()).rules.autoMonthlyReportDay).toBe(1);
  });

  it("旧キー autoJournalBatchHour / autoDistillationWeekday も配列へ移行して受け付ける", async () => {
    const { settingsRulesRoute } = await import("./settings-rules");
    const res = await settingsRulesRoute.request("/", patch({ autoJournalBatchHour: 9, autoDistillationWeekday: 3 }));
    const json = await res.json();
    expect(json.rules.autoJournalBatchHours).toEqual([9]);
    expect(json.rules.autoDistillationWeekdays).toEqual([3]);
  });

  it("teamParallelKickoffEnabledを更新できる", async () => {
    const { settingsRulesRoute } = await import("./settings-rules");
    const res = await settingsRulesRoute.request("/", patch({ teamParallelKickoffEnabled: false }));
    expect((await res.json()).rules.teamParallelKickoffEnabled).toBe(false);
  });

  it("型が不正な値は無視する（既定値のまま）", async () => {
    const { settingsRulesRoute } = await import("./settings-rules");
    const res = await settingsRulesRoute.request("/", patch({ teamWindowDays: "not-a-number" }));
    expect((await res.json()).rules.teamWindowDays).toBe(14);
  });

  // ユーザー指摘「AIツールの優先度設定が増えたことでフォールバック設定との競合が
  // 発生している」「エージェントごとに設定できる必要はない、全体で1つで大丈夫」
  // 「claude codeが外せないようになっている」対応。
  describe("cliOrder", () => {
    it("CLIの優先順位・除外を設定できる", async () => {
      const { settingsRulesRoute } = await import("./settings-rules");
      const res = await settingsRulesRoute.request("/", patch({ cliOrder: ["cursor", "claude", "agy"] }));
      expect((await res.json()).rules.cliOrder).toEqual(["cursor", "claude", "agy"]);
    });

    it("claudeを含まない配列も設定できる（claudeも除外できる）", async () => {
      const { settingsRulesRoute } = await import("./settings-rules");
      const res = await settingsRulesRoute.request("/", patch({ cliOrder: ["agy", "cursor"] }));
      expect((await res.json()).rules.cliOrder).toEqual(["agy", "cursor"]);
    });

    it("重複した値がある配列は無視する（既定値のまま）", async () => {
      const { settingsRulesRoute } = await import("./settings-rules");
      const res = await settingsRulesRoute.request("/", patch({ cliOrder: ["claude", "claude"] }));
      expect((await res.json()).rules.cliOrder).toEqual(["claude"]);
    });

    it("知らない値が含まれる配列は無視する（既定値のまま）", async () => {
      const { settingsRulesRoute } = await import("./settings-rules");
      const res = await settingsRulesRoute.request("/", patch({ cliOrder: ["claude", "bogus"] }));
      expect((await res.json()).rules.cliOrder).toEqual(["claude"]);
    });

    it("空配列は無視する（既定値のまま）", async () => {
      const { settingsRulesRoute } = await import("./settings-rules");
      const res = await settingsRulesRoute.request("/", patch({ cliOrder: [] }));
      expect((await res.json()).rules.cliOrder).toEqual(["claude"]);
    });
  });

  // ユーザー要望「エージェント種別ごとのモデル系統に関して、Cursor/agyについても調整
  // できるようにしたい」対応。
  describe("agentAgyModels / agentCursorModels", () => {
    it("エージェント種別ごとのモデル名を設定できる", async () => {
      const { settingsRulesRoute } = await import("./settings-rules");
      const res = await settingsRulesRoute.request(
        "/",
        patch({ agentAgyModels: { "Lead Agent": "gemini-custom" }, agentCursorModels: { "Lead Agent": "gpt-custom" } }),
      );
      const json = await res.json();
      expect(json.rules.agentAgyModels).toEqual({ "Lead Agent": "gemini-custom" });
      expect(json.rules.agentCursorModels).toEqual({ "Lead Agent": "gpt-custom" });
    });

    it("AGENT_OPTIONSに無いキーは落とす", async () => {
      const { settingsRulesRoute } = await import("./settings-rules");
      const res = await settingsRulesRoute.request("/", patch({ agentAgyModels: { "存在しないエージェント": "gemini-x" } }));
      expect((await res.json()).rules.agentAgyModels).toEqual({});
    });

    it("空文字列（trim後）のモデル名は落とす（既定モデルへ戻す）", async () => {
      const { settingsRulesRoute } = await import("./settings-rules");
      const res = await settingsRulesRoute.request("/", patch({ agentAgyModels: { "Lead Agent": "   " } }));
      expect((await res.json()).rules.agentAgyModels).toEqual({});
    });

    it("前後の空白はtrimして保存する", async () => {
      const { settingsRulesRoute } = await import("./settings-rules");
      const res = await settingsRulesRoute.request("/", patch({ agentAgyModels: { "Lead Agent": "  gemini-custom  " } }));
      expect((await res.json()).rules.agentAgyModels).toEqual({ "Lead Agent": "gemini-custom" });
    });
  });

  // ユーザー要望「この検索（Grow参考リンクのWebSearch）で使うモデル設定を追加してほしい。
  // 他のタスクに比べてもコストが低く軽量なモデルで良いはず」対応。
  describe("referenceLookupClaudeModel / referenceLookupCursorModel", () => {
    it("claudeはtierエイリアスで設定できる", async () => {
      const { settingsRulesRoute } = await import("./settings-rules");
      const res = await settingsRulesRoute.request("/", patch({ referenceLookupClaudeModel: "haiku" }));
      expect((await res.json()).rules.referenceLookupClaudeModel).toBe("haiku");
    });

    it("claudeはMODEL_TIER_OPTIONSに無い値を落とす（既定のまま）", async () => {
      const { settingsRulesRoute } = await import("./settings-rules");
      const res = await settingsRulesRoute.request("/", patch({ referenceLookupClaudeModel: "not-a-tier" }));
      expect((await res.json()).rules.referenceLookupClaudeModel).toBe("");
    });

    it("空文字列を送ると既定（CLIの既定のまま）へ戻せる", async () => {
      const { settingsRulesRoute } = await import("./settings-rules");
      await settingsRulesRoute.request("/", patch({ referenceLookupClaudeModel: "haiku" }));
      const res = await settingsRulesRoute.request("/", patch({ referenceLookupClaudeModel: "" }));
      expect((await res.json()).rules.referenceLookupClaudeModel).toBe("");
    });

    it("cursorは具体的なモデル名を自由入力で設定できる", async () => {
      const { settingsRulesRoute } = await import("./settings-rules");
      const res = await settingsRulesRoute.request("/", patch({ referenceLookupCursorModel: "gpt-5.2" }));
      expect((await res.json()).rules.referenceLookupCursorModel).toBe("gpt-5.2");
    });

    // ユーザー要望「Cursorでは、AutoはHooksの不具合のため指定できないようにしておいて
    // ほしい（設定しようとしたらユーザーにCursorの不具合で設定できない旨を表示）」対応。
    it.each(["auto", "Auto", "AUTO", "  auto  "])("cursorに%sを指定すると400エラーを返す", async (value) => {
      const { settingsRulesRoute } = await import("./settings-rules");
      const res = await settingsRulesRoute.request("/", patch({ referenceLookupCursorModel: value }));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("Auto");
    });

    it("cursorのAuto拒否時は他のフィールドも一切保存されない（部分的な不整合を避ける）", async () => {
      const { settingsRulesRoute } = await import("./settings-rules");
      const res = await settingsRulesRoute.request("/", patch({ referenceLookupCursorModel: "auto", maxParallelAgentRuns: 9 }));
      expect(res.status).toBe(400);
      const getRes = await settingsRulesRoute.request("/");
      expect((await getRes.json()).rules.maxParallelAgentRuns).toBe(2);
    });
  });

  // ユーザー要望「メンバーに自分自身を追加したいが区別できない」対応。
  describe("selfPersonId", () => {
    it("登録済み人物を利用者本人として設定・解除できる", async () => {
      const peopleDirectory = await import("@emther/core/people-directory");
      const id = peopleDirectory.registerName("EM本人");
      const { settingsRulesRoute } = await import("./settings-rules");
      const setRes = await settingsRulesRoute.request("/", patch({ selfPersonId: id }));
      expect((await setRes.json()).rules.selfPersonId).toBe(id);
      const clearRes = await settingsRulesRoute.request("/", patch({ selfPersonId: null }));
      expect((await clearRes.json()).rules.selfPersonId).toBeNull();
    });

    it("存在しない人物IDは400を返す", async () => {
      const { settingsRulesRoute } = await import("./settings-rules");
      const res = await settingsRulesRoute.request("/", patch({ selfPersonId: "PERSON_999" }));
      expect(res.status).toBe(400);
    });
  });

  // ユーザー要望「メモリに余裕がある場合にローカルAIをより大きいパラメータ数へ」対応。
  describe("localChatModelPreset", () => {
    it("既定は1.2b-jp", async () => {
      const { settingsRulesRoute } = await import("./settings-rules");
      const res = await settingsRulesRoute.request("/");
      expect((await res.json()).rules.localChatModelPreset).toBe("1.2b-jp");
    });

    it("350m / 0.5b / 1.2b / 1.5b に更新できる", async () => {
      const { settingsRulesRoute } = await import("./settings-rules");
      const to350 = await settingsRulesRoute.request("/", patch({ localChatModelPreset: "350m" }));
      expect((await to350.json()).rules.localChatModelPreset).toBe("350m");
      expect(ensureLocalModels).toHaveBeenCalled();
      ensureLocalModels.mockClear();
      const to05 = await settingsRulesRoute.request("/", patch({ localChatModelPreset: "0.5b" }));
      expect((await to05.json()).rules.localChatModelPreset).toBe("0.5b");
      expect(ensureLocalModels).toHaveBeenCalled();
      ensureLocalModels.mockClear();
      const to12 = await settingsRulesRoute.request("/", patch({ localChatModelPreset: "1.2b" }));
      expect((await to12.json()).rules.localChatModelPreset).toBe("1.2b");
      expect(ensureLocalModels).toHaveBeenCalled();
      ensureLocalModels.mockClear();
      const to15 = await settingsRulesRoute.request("/", patch({ localChatModelPreset: "1.5b" }));
      expect((await to15.json()).rules.localChatModelPreset).toBe("1.5b");
      expect(ensureLocalModels).toHaveBeenCalled();
    });

    it("不正な値は無視する（既定値のまま）", async () => {
      const { settingsRulesRoute } = await import("./settings-rules");
      const res = await settingsRulesRoute.request("/", patch({ localChatModelPreset: "7b" }));
      expect((await res.json()).rules.localChatModelPreset).toBe("1.2b-jp");
    });
  });

  describe("localRerankEnabled", () => {
    it("既定は false", async () => {
      const { settingsRulesRoute } = await import("./settings-rules");
      const res = await settingsRulesRoute.request("/");
      expect((await res.json()).rules.localRerankEnabled).toBe(false);
    });

    it("true に更新できる", async () => {
      const { settingsRulesRoute } = await import("./settings-rules");
      const res = await settingsRulesRoute.request("/", patch({ localRerankEnabled: true }));
      expect((await res.json()).rules.localRerankEnabled).toBe(true);
    });
  });
});
