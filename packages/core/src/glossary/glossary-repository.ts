import type { GlossaryEntry } from "./glossary-types";

/**
 * 用語集の永続化ポート。ドメインはファイル名・I/O 詳細を知らない。
 */
export type GlossaryRepository = {
  load(): GlossaryEntry[];
  save(entries: GlossaryEntry[]): void;
};
