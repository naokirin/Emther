import type { SettingsRulesRepository } from "../../settings/settings-repository";
import type { LegacyRulesFile, RulesAndConstraints } from "../../settings/settings-types";
import { createJsonSingletonDocument } from "../json-document";

const doc = createJsonSingletonDocument<LegacyRulesFile>("settings-rules.json", {});

export function createJsonSettingsRulesRepository(): SettingsRulesRepository {
  return {
    load: () => doc.load(),
    save: (rules: RulesAndConstraints) => doc.save(rules),
  };
}
