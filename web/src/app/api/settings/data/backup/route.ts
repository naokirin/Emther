import { readFileSync } from "node:fs";
import { NextResponse } from "next/server";
import { createBackupArchive } from "@/lib/state-archive";

// 個人情報を含むアーカイブをブラウザへ返す。CLI `emther backup` と同形式。
export async function POST() {
  try {
    const { archivePath, fileName } = createBackupArchive();
    const body = readFileSync(archivePath);
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "application/gzip",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "X-Emther-Warning": "archive-contains-personal-data",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || "バックアップに失敗しました" },
      { status: 500 },
    );
  }
}
