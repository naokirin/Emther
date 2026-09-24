import { createPersonEvaluationService } from "./person-evaluation/person-evaluation-domain";
import { createSqlitePersonEvaluationRepository } from "./persistence/adapters/sqlite-person-evaluation-repository";

export type {
  EvaluationLens,
  EvaluationLogStatus,
  EvaluationPolarity,
  PersonEvaluationLog,
} from "./person-evaluation/person-evaluation-types";

const service = createPersonEvaluationService(createSqlitePersonEvaluationRepository());

export const toEvaluationLogView = service.toEvaluationLogView;
export const createEvaluationLog = service.createEvaluationLog;
export const listEvaluationLogsForPerson = service.listEvaluationLogsForPerson;
export const getEvaluationLog = service.getEvaluationLog;
export const setEvaluationLogStatus = service.setEvaluationLogStatus;
export const setEvaluationLogNoActionNeeded = service.setEvaluationLogNoActionNeeded;
export const clearEvaluationLogNoActionNeeded = service.clearEvaluationLogNoActionNeeded;
export const suggestEvaluationLogsFromRecentJournals = service.suggestEvaluationLogsFromRecentJournals;
export const bundleEvaluationLogs = service.bundleEvaluationLogs;
