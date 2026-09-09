import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@/lib/test-helpers/store-env";

let dir: string;

beforeEach(() => {
  dir = setupIsolatedStoreEnv();
  vi.resetModules();
});

afterEach(() => {
  teardownIsolatedStoreEnv(dir);
});

describe("getRulesAndConstraints", () => {
  it("永続化ファイルが無ければ既定値を返す", async () => {
    const { getRulesAndConstraints } = await import("@/lib/settings-store");
    const rules = getRulesAndConstraints();
    expect(rules.teamWindowDays).toBe(14);
    expect(rules.maxParallelAgentRuns).toBe(2);
    expect(rules.autoAnomalyDetectionEnabled).toBe(false);
    expect(rules.autoJournalUrgencyFilter).toBe("high_only");
    expect(rules.autoJournalSentimentFilter).toBe("all");
    expect(rules.autoIssueUpdateAnalysisEnabled).toBe(false);
    expect(rules.decisionQueueLimit).toBe(3);
    expect(rules.observationQueueLimit).toBe(3);
    expect(rules.staleInterventionDays).toBe(14);
    // ユーザー要望「エージェント種別ごとのモデル系統に関して、Cursor/agyについても調整
    // できるようにしたい」対応。既定は全エージェント未設定。
    expect(rules.agentAgyModels).toEqual({});
    expect(rules.agentCursorModels).toEqual({});
    // ユーザー指摘「AIツールの優先度設定が増えたことでフォールバック設定との競合が
    // 発生している」「エージェントごとに設定できる必要はない、全体で1つで大丈夫」対応。
    // 既定は["claude"]（＝claudeのみが候補、既存の挙動を変えない）。
    expect(rules.cliOrder).toEqual(["claude"]);
  });
});

describe("updateRulesAndConstraints", () => {
  it("パッチした項目だけを更新し、他は既定値のまま残す", async () => {
    const { getRulesAndConstraints, updateRulesAndConstraints } = await import("@/lib/settings-store");
    const updated = updateRulesAndConstraints({ maxParallelAgentRuns: 5 });
    expect(updated.maxParallelAgentRuns).toBe(5);
    expect(updated.teamWindowDays).toBe(14);
    expect(getRulesAndConstraints().maxParallelAgentRuns).toBe(5);
  });

  it("更新内容を永続化し、モジュール再読み込み後も反映されている", async () => {
    const mod1 = await import("@/lib/settings-store");
    mod1.updateRulesAndConstraints({ autoAnomalyDetectionEnabled: true, cliOrder: ["claude", "agy"] });

    vi.resetModules();
    const mod2 = await import("@/lib/settings-store");
    const rules = mod2.getRulesAndConstraints();
    expect(rules.autoAnomalyDetectionEnabled).toBe(true);
    expect(rules.cliOrder).toEqual(["claude", "agy"]);
  });
});
