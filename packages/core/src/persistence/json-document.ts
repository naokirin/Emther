import {
  loadJSON,
  loadSecureJSON,
  peekSecureJSON,
  saveJSON,
  saveSecureJSON,
  type SaveJsonOptions,
} from "./persistence";

/**
 * JSON 配列ドキュメント用の共通 load/save。
 * ドメイン固有の Repository 型は各ドメインに残し、アダプタ実装の重複だけをここに寄せる。
 */
export function createJsonArrayDocument<T>(
  filename: string,
  opts: SaveJsonOptions = {},
): {
  load(): T[];
  save(items: T[]): void;
} {
  return {
    load(): T[] {
      return loadJSON<T[]>(filename, []);
    },
    save(items: T[]): void {
      saveJSON(filename, items, opts);
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

/**
 * secure 配下の単一 JSON ドキュメント（people-directory 等）。
 */
export function createSecureJsonSingletonDocument<T>(filename: string, emptyDefault: T): {
  load(): T;
  peek(): T | undefined;
  save(doc: T, opts?: SaveJsonOptions): void;
} {
  return {
    load(): T {
      return loadSecureJSON<T>(filename, emptyDefault);
    },
    peek(): T | undefined {
      return peekSecureJSON<T>(filename);
    },
    save(doc: T, opts: SaveJsonOptions = {}): void {
      saveSecureJSON(filename, doc, opts);
    },
  };
}
