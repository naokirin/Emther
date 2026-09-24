import type { LegacyRulesFile, RulesAndConstraints } from "./settings-types";

/** Settings（Rules_and_Constraints）の永続化ポート。単一ドキュメント。 */
export type SettingsRulesRepository = {
  load(): LegacyRulesFile;
  save(rules: RulesAndConstraints): void;
};
