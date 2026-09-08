import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@/lib/test-helpers/store-env";
import { dataFilePath, loadJSON, loadSecureJSON, saveJSON, saveSecureJSON } from "@/lib/persistence";

let dir: string;

beforeEach(() => {
  dir = setupIsolatedStoreEnv();
});

afterEach(() => {
  teardownIsolatedStoreEnv(dir);
});

describe("loadJSON / saveJSON", () => {
  it("存在しないファイルはfallbackを返す", () => {
    expect(loadJSON("missing.json", { ok: true })).toEqual({ ok: true });
  });

  it("保存した内容をそのまま読み戻せる", () => {
    saveJSON("thing.json", { a: 1, b: ["x", "y"] });
    expect(loadJSON("thing.json", null)).toEqual({ a: 1, b: ["x", "y"] });
  });

  it("EM_DATA_DIR配下にファイルを書き込む（実データディレクトリを汚さない）", () => {
    saveJSON("thing.json", { a: 1 });
    const path = join(process.env.EM_DATA_DIR!, "thing.json");
    expect(existsSync(path)).toBe(true);
  });

  it("壊れたJSONを読んだ場合はfallbackを返す", () => {
    saveJSON("broken.json", "not valid json start");
    const path = join(process.env.EM_DATA_DIR!, "broken.json");
    // 手動で不正な内容に書き換える
    writeFileSync(path, "{ this is not json", "utf8");
    expect(loadJSON("broken.json", { fallback: true })).toEqual({ fallback: true });
  });
});

describe("dataFilePath", () => {
  it("EM_DATA_DIR配下の絶対パスを返し、ディレクトリを作成する", () => {
    const path = dataFilePath("app.db");
    expect(path).toBe(join(process.env.EM_DATA_DIR!, "app.db"));
    expect(existsSync(process.env.EM_DATA_DIR!)).toBe(true);
  });
});

describe("loadSecureJSON / saveSecureJSON", () => {
  it("EM_SECURE_DATA_DIR配下に0600権限で保存する", () => {
    saveSecureJSON("people-directory.json", { entries: [["Aさん", "PERSON_1"]], counter: 1 });
    const path = join(process.env.EM_SECURE_DATA_DIR!, "people-directory.json");
    expect(existsSync(path)).toBe(true);
    const mode = statSync(path).mode & 0o777;
    expect(mode).toBe(0o600);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ entries: [["Aさん", "PERSON_1"]], counter: 1 });
  });

  it("存在しなければfallbackを返す", () => {
    expect(loadSecureJSON("missing.json", { entries: [], counter: 0 })).toEqual({ entries: [], counter: 0 });
  });

  it("data用ディレクトリとsecure用ディレクトリは物理的に分離されている", () => {
    saveJSON("a.json", { x: 1 });
    saveSecureJSON("b.json", { y: 2 });
    expect(existsSync(join(process.env.EM_DATA_DIR!, "b.json"))).toBe(false);
    expect(existsSync(join(process.env.EM_SECURE_DATA_DIR!, "a.json"))).toBe(false);
  });
});
