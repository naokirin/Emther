import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { createBackupArchive } from "@emther/core/state-archive";

// docs/2nd_architecture/plan.md フェーズ2.5（高リスク バッチ8）: web/src/app/api/settings/data/backup/route.ts の移植。
// settings/data/reset・settings/data/restoreは scheduleProcessExit()（process.exit）を
// 呼ぶため、並走期間はあえて移植しない（同ファイルのコメント・plan.md参照）。
// 個人情報を含むアーカイブをブラウザへ返す。CLI `emther backup` と同形式。
export const settingsDataBackupRoute = new Hono().post("/", (c) => {
  try {
    const { archivePath, fileName } = createBackupArchive();
    const body = readFileSync(archivePath);
    return new Response(new Uint8Array(body), {
      status: 200,
      headers: {
        "Content-Type": "application/gzip",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "X-Emther-Warning": "archive-contains-personal-data",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return c.json({ error: (err as Error).message || "バックアップに失敗しました" }, 500);
  }
});
