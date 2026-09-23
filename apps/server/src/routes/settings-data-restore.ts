import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { Hono } from "hono";
import type { DataMutationResponse } from "@emther/api-contract";
import { restoreFromArchive, scheduleProcessExit } from "@emther/core/state-archive";

// docs/2nd_architecture/plan.md フェーズ4.3a: web/src/app/api/settings/data/restore/route.ts
// から移植（reset同様、単一プロセス配信化により未移植の理由が解消したため）。
export const settingsDataRestoreRoute = new Hono().post("/", async (c) => {
  let tmpDir: string | undefined;
  try {
    const form = await c.req.formData().catch(() => null);
    if (!form) {
      return c.json({ error: "multipart form が必要です" }, 400);
    }
    const file = form.get("file");
    if (!(file instanceof File)) {
      return c.json({ error: "file フィールドが必要です" }, 400);
    }
    const name = basename(file.name || "upload.tar.gz");
    if (!name.endsWith(".tar.gz") && !name.endsWith(".tgz")) {
      return c.json({ error: "バックアップは .tar.gz である必要があります" }, 400);
    }

    tmpDir = mkdtempSync(join(tmpdir(), "emther-upload-"));
    const archivePath = join(tmpDir, name);
    const bytes = Buffer.from(await file.arrayBuffer());
    writeFileSync(archivePath, bytes);

    restoreFromArchive(archivePath);
    scheduleProcessExit();
    const resBody = { ok: true, requiresRestart: true } satisfies DataMutationResponse;
    return c.json(resBody);
  } catch (err) {
    return c.json({ error: (err as Error).message || "復元に失敗しました" }, 500);
  } finally {
    if (tmpDir) {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }
});
