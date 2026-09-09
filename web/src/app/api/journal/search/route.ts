import { NextResponse } from "next/server";
import {
  findJournalEntryOffset,
  listJournalEntriesPage,
  listJournalFacets,
  toJournalEntryView,
  type JournalListFilter,
  type Sentiment,
  type Urgency,
} from "@/lib/journal-store";

// ユーザー要望「一覧の全件取得をページネーション化したい」対応。/journal（一覧・検索画面）
// 専用のエンドポイント。既存の/api/journal（全件取得）はDashboard・Organization Context画面
// （直近5件表示・チームVitalsの集計）が引き続き使うため変更しない——今回のスコープは
// 一覧・検索画面のページ送りのみ。

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;
const URGENCIES: readonly Urgency[] = ["low", "mid", "high"];
const SENTIMENTS: readonly Sentiment[] = ["positive", "negative", "neutral"];

function parsePositiveInt(value: string | null, fallback: number): number {
  const n = value !== null ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const pageSize = Math.min(MAX_PAGE_SIZE, parsePositiveInt(params.get("pageSize"), DEFAULT_PAGE_SIZE));

  const urgencyParam = params.get("urgency");
  const sentimentParam = params.get("sentiment");
  const filter: JournalListFilter = {
    query: params.get("query")?.trim() || undefined,
    tag: params.get("tag")?.trim() || undefined,
    person: params.get("person")?.trim() || undefined,
    urgency: urgencyParam && (URGENCIES as readonly string[]).includes(urgencyParam) ? (urgencyParam as Urgency) : undefined,
    sentiment:
      sentimentParam && (SENTIMENTS as readonly string[]).includes(sentimentParam) ? (sentimentParam as Sentiment) : undefined,
    excludeResolved: params.get("excludeResolved") === "1",
  };
  const periodDays = params.get("periodDays");
  if (periodDays && periodDays !== "all") {
    const days = Number(periodDays);
    if (Number.isFinite(days) && days > 0) filter.sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;
  }

  // ユーザー指摘「Dashboardから特定のJournalエントリへ直接飛ぶ深いリンクを、ページネーション後も
  // 保ちたい」対応。focusIdが指定されていれば、そのエントリが載っているページをサーバー側で
  // 求め、pageクエリより優先する（見つからなければ通常通りpageクエリに従う）。
  const focusId = params.get("focusId");
  let page = parsePositiveInt(params.get("page"), 1);
  if (focusId) {
    const offset = findJournalEntryOffset(focusId, filter);
    if (offset !== undefined) page = Math.floor(offset / pageSize) + 1;
  }

  const { entries, total } = listJournalEntriesPage(filter, { limit: pageSize, offset: (page - 1) * pageSize });
  const facets = listJournalFacets();
  return NextResponse.json({ entries: entries.map(toJournalEntryView), total, page, pageSize, facets });
}
