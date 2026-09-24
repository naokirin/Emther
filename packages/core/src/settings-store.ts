// 公開ファサード。deep import `@emther/core/settings-store` 互換。

import { createSettingsService, normalizeHourList, normalizeWeekdayList } from "./settings/settings-domain";
import { createJsonSettingsRulesRepository } from "./persistence/adapters/json-settings-rules-repository";

export type { RulesAndConstraints } from "./settings/settings-types";
export { normalizeHourList, normalizeWeekdayList };

const service = createSettingsService(createJsonSettingsRulesRepository());

export const getRulesAndConstraints = service.getRulesAndConstraints;
export const updateRulesAndConstraints = service.updateRulesAndConstraints;
export const getSelfPersonId = service.getSelfPersonId;
export const setSelfPersonId = service.setSelfPersonId;
export const reassignSelfPersonId = service.reassignSelfPersonId;
