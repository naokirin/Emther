import { loadJSON, saveJSON } from "./persistence";

/**
 * JSON 配列ドキュメント用の共通 load/save。
 * ドメイン固有の Repository 型は各ドメインに残し、アダプタ実装の重複だけをここに寄せる。
 * docs/architecture_boundary_refactor.md Phase D3。
 */
export function createJsonArrayDocument<T>(filename: string): {
  load(): T[];
  save(items: T[]): void;
} {
  return {
    load(): T[] {
      return loadJSON<T[]>(filename, []);
    },
    save(items: T[]): void {
      saveJSON(filename, items);
    },
  };
}

/**
 * JSON 単一ドキュメント用の共通 load/save。
 */
export function createJsonSingletonDocument<T>(filename: string, emptyDefault: T): {
  load(): T;
  save(doc: T): void;
} {
  return {
    load(): T {
      return loadJSON<T>(filename, emptyDefault);
    },
    save(doc: T): void {
      saveJSON(filename, doc);
    },
  };
}
