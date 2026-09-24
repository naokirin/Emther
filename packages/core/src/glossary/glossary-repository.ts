import type { GlossaryEntry } from "./glossary-types";

/**
 * 用語集の永続化ポート。ドメインはファイル名・I/O 詳細を知らない。
 * docs/architecture_boundary_refactor.md Phase D。
 */
export type GlossaryRepository = {
  load(): GlossaryEntry[];
  save(entries: GlossaryEntry[]): void;
};
