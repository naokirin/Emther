import { NextResponse } from "next/server";
import { listRunsPage, type AgentStatus } from "@/lib/agent-runtime";

// ユーザー要望「一覧の全件取得をページネーション化したい」対応。/agents画面の
// Inbox一覧（フィルタ＋ページ送り）専用の軽量エンドポイント。Fleet状態・Activity Streamは
// 引き続き既存の/api/agents（全件取得）を使う——それらは「直近の状態」を横断的に見る
// 集計用途であり、今回のスコープ外（別タスク）とする。

const DEFAULT_PAGE_SIZE = 5;
const MAX_PAGE_SIZE = 50;
const VALID_STATUSES: readonly AgentStatus[] = ["active", "queued", "yield", "idle", "error"];

function parsePositiveInt(value: string | null, fallback: number): number {
  const n = value !== null ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const pageSize = Math.min(MAX_PAGE_SIZE, parsePositiveInt(params.get("pageSize"), DEFAULT_PAGE_SIZE));
  const page = parsePositiveInt(params.get("page"), 1);
  const statusParam = params.get("status");
  const status = statusParam && (VALID_STATUSES as readonly string[]).includes(statusParam) ? (statusParam as AgentStatus) : undefined;
  const showDismissed = params.get("showDismissed") === "1";

  const { runs, total } = listRunsPage({ status, showDismissed }, { limit: pageSize, offset: (page - 1) * pageSize });
  return NextResponse.json({ runs, total, page, pageSize });
}
