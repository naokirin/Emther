// 公開ファサード。deep import `@emther/core/glossary-store` 互換。
// ドメインは glossary/、永続化は persistence/adapters/。既定アダプタをここで束ねる。

import { createGlossaryService } from "./glossary/glossary-domain";
import { createJsonGlossaryRepository } from "./persistence/adapters/json-glossary-repository";

export type { GlossaryEntry, NewGlossaryInput } from "./glossary/glossary-types";

const service = createGlossaryService(createJsonGlossaryRepository());

export const listGlossaryEntries = service.listGlossaryEntries;
export const getGlossaryEntry = service.getGlossaryEntry;
export const addGlossaryEntry = service.addGlossaryEntry;
export const updateGlossaryEntry = service.updateGlossaryEntry;
export const deleteGlossaryEntry = service.deleteGlossaryEntry;
export const buildGlossaryContextBlock = service.buildGlossaryContextBlock;
