import { NextResponse } from "next/server";
import {
  ensureLocalModels,
  getModelLoadSnapshot,
  retryFailedLocalModels,
} from "@/lib/model-loader";

// ローカルモデル（チャット／埋め込み）のキャッシュ確認・未取得時ダウンロード進捗。
// GET は状態を返すと同時に ensure を起動する（ブラウザが開いたタイミングで進めるため）。
// POST は失敗スロットの再試行用。

export async function GET() {
  void ensureLocalModels();
  return NextResponse.json(getModelLoadSnapshot());
}

export async function POST() {
  await retryFailedLocalModels();
  return NextResponse.json(getModelLoadSnapshot());
}
