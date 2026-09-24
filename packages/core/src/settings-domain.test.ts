import { describe, expect, it } from "vitest";
import { createSettingsService } from "./settings/settings-domain";
import type { SettingsRulesRepository } from "./settings/settings-repository";
import type { LegacyRulesFile, RulesAndConstraints } from "./settings/settings-types";

function createMemorySettingsRepository(initial: LegacyRulesFile = {}): SettingsRulesRepository {
  let stored: LegacyRulesFile | RulesAndConstraints = { ...initial };
  return {
    load: () => ({ ...stored }),
    save: (rules) => {
      stored = { ...rules };
    },
  };
}

describe("settings-domain (in-memory repository)", () => {
  it("ファイル I/O なしで既定値取得とパッチ更新ができる", () => {
    const repo = createMemorySettingsRepository();
    const service = createSettingsService(repo);

    expect(service.getRulesAndConstraints().teamWindowDays).toBe(14);
    expect(service.getRulesAndConstraints().cliOrder).toEqual(["claude"]);

    service.updateRulesAndConstraints({ teamWindowDays: 21, autoMorningSummaryEnabled: true });
    expect(service.getRulesAndConstraints().teamWindowDays).toBe(21);
    expect(service.getRulesAndConstraints().autoMorningSummaryEnabled).toBe(true);
    expect((repo.load() as RulesAndConstraints).teamWindowDays).toBe(21);
  });

  it("旧キー autoJournalBatchHour を hydrate する", () => {
    const service = createSettingsService(
      createMemorySettingsRepository({ autoJournalBatchHour: 9 }),
    );
    expect(service.getRulesAndConstraints().autoJournalBatchHours).toEqual([9]);
  });
});
