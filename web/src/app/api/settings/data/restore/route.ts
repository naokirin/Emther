import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { NextResponse } from "next/server";
import { restoreFromArchive, scheduleProcessExit } from "@/lib/state-archive";

export async function POST(request: Request) {
  let tmpDir: string | undefined;
  try {
    const form = await request.formData().catch(() => null);
    if (!form) {
      return NextResponse.json({ error: "multipart form が必要です" }, { status: 400 });
    }
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file フィールドが必要です" }, { status: 400 });
    }
    const name = basename(file.name || "upload.tar.gz");
    if (!name.endsWith(".tar.gz") && !name.endsWith(".tgz")) {
      return NextResponse.json({ error: "バックアップは .tar.gz である必要があります" }, { status: 400 });
    }

    tmpDir = mkdtempSync(join(tmpdir(), "emther-upload-"));
    const archivePath = join(tmpDir, name);
    const bytes = Buffer.from(await file.arrayBuffer());
    writeFileSync(archivePath, bytes);

    restoreFromArchive(archivePath);
    scheduleProcessExit();
    return NextResponse.json({ ok: true, requiresRestart: true });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || "復元に失敗しました" },
      { status: 500 },
    );
  } finally {
    if (tmpDir) {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }
}
