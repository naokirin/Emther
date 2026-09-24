import { describe, expect, it } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "../test-helpers/store-env";
import { createJsonArrayDocument, createJsonSingletonDocument } from "./json-document";

describe("json-document helpers", () => {
  let dir: string;

  it("createJsonArrayDocument は空既定で load/save する", () => {
    dir = setupIsolatedStoreEnv();
    try {
      const doc = createJsonArrayDocument<{ id: string }>("helper-array.json");
      expect(doc.load()).toEqual([]);
      doc.save([{ id: "a" }]);
      expect(doc.load()).toEqual([{ id: "a" }]);
    } finally {
      teardownIsolatedStoreEnv(dir);
    }
  });

  it("createJsonSingletonDocument は emptyDefault で load/save する", () => {
    dir = setupIsolatedStoreEnv();
    try {
      const doc = createJsonSingletonDocument<{ n: number }>("helper-singleton.json", { n: 0 });
      expect(doc.load()).toEqual({ n: 0 });
      doc.save({ n: 3 });
      expect(doc.load()).toEqual({ n: 3 });
    } finally {
      teardownIsolatedStoreEnv(dir);
    }
  });
});
