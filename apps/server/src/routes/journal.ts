import { Hono } from "hono";
import {
  addJournalEntriesBulk,
  addJournalEntryWithProfileCandidate,
  archiveJournalEntry,
  clearJournalNoActionNeeded,
  findJournalEntryOffset,
  getCurrentJournalEntry,
  listJournalEntries,
  listJournalEntriesPage,
  listJournalFacets,
  setJournalNoActionNeeded,
  toJournalEntryView,
  toJournalEntryViews,
  unarchiveJournalEntry,
  updateJournalEntry,
  type JournalListFilter,
  type Sentiment,
  type Urgency,
} from "@emther/core/journal-store";
import { buildSourceConsultIndex } from "@emther/core/journal-consult-index";
import { resolveJournalOccurredAtFromDateInput } from "@emther/core/journal-date-parser";
import { resolveUniqueByPrefix } from "@emther/core/id-resolve";
import { listIssues } from "@emther/core/issue-store";
import { jsonFromUnknownError, maskOptionsFromBodyStrict } from "../lib/name-candidate-response";

// docs/2nd_architecture/plan.md フェーズ2.5:
// web/src/app/api/journal/{route,[id]/route,[id]/archive/route,
// [id]/no-action-needed/route,bulk/route,search/route}.ts の移植。

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;
const URGENCIES: readonly Urgency[] = ["low", "mid", "high"];
const SENTIMENTS: readonly Sentiment[] = ["positive", "negative", "neutral"];

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const n = value !== undefined ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export const journalRoute = new Hono()
  .get("/", async (c) => c.json({ entries: toJournalEntryViews(listJournalEntries(), await buildSourceConsultIndex()) }))
  .post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    const text = typeof body?.text === "string" ? body.text.trim() : "";

    if (!text) {
      return c.json({ error: "textは必須です" }, 400);
    }

    // docs/em_human_story_and_ux.md 改修依頼「通常投入でも日付レベルの訂正を検討」対応。
    // occurredAtDateは"YYYY-MM-DD"（日付レベルのみ・時刻は求めない）。省略時はこれまで通り
    // Date.now()（＝今日）を使う。
    let occurredAt: number | undefined;
    if (typeof body?.occurredAtDate === "string" && body.occurredAtDate) {
      occurredAt = resolveJournalOccurredAtFromDateInput(body.occurredAtDate, Date.now());
      if (occurredAt === undefined) {
        return c.json({ error: "occurredAtDateの形式が不正です（YYYY-MM-DD）" }, 400);
      }
    }

    // 人物詳細など「このメンバーに紐づけて書く」導線向け。EMが明示した人物名は
    // NER抽出に頼らず作成時から people に入れる（未指定時は従来どおり抽出のみ）。
    const people = Array.isArray(body?.people)
      ? body.people.filter((p: unknown): p is string => typeof p === "string" && p.trim().length > 0)
      : undefined;
    const teams = Array.isArray(body?.teams)
      ? body.teams.filter((t: unknown): t is string => typeof t === "string" && t.trim().length > 0)
      : undefined;
    const teamIds = Array.isArray(body?.teamIds)
      ? body.teamIds.filter((t: unknown): t is string => typeof t === "string" && t.trim().length > 0)
      : undefined;

    const opts = {
      ...maskOptionsFromBodyStrict(body),
      ...(people && people.length > 0 ? { people } : {}),
      ...(teams && teams.length > 0 ? { teams } : {}),
      ...(teamIds && teamIds.length > 0 ? { teamIds } : {}),
    };

    try {
      // 既登録の人物名は本文の名簿照合で addJournalEntry 内の people へ紐付ける。
      // 未登録の人名候補（形態素／ルール＋ローカル抽出の和集合）は保存前に
      // maskOptionsFromBodyStrict 経由で1回の確認ダイアログに出す。保存後の
      // nameCandidates ヒントは出さない（常に空・API互換のためフィールドは残す）。
      const { entry, profileCandidate, nameCandidates } =
        occurredAt !== undefined
          ? await addJournalEntryWithProfileCandidate(text, occurredAt, opts)
          : await addJournalEntryWithProfileCandidate(text, Date.now(), opts);
      // docs/memo.md「JournalのAIでの分析結果として、メンバーの長期プロファイルに入れる」対応。
      // profileCandidateは投稿直後だけの一度きりのヒント（永続化しない）。
      return c.json({ entry: toJournalEntryView(entry, new Map()), nameCandidates, profileCandidate }, 201);
    } catch (err) {
      return jsonFromUnknownError(err);
    }
  })
  // docs/em_human_story_and_ux.md 改修依頼「まとめて記録する仕組み」対応。EMが忙しくて
  // 後からまとめて書く場合に、1件ずつSubmitさせる負担を無くすための専用エンドポイント。
  .post("/bulk", async (c) => {
    const body = await c.req.json().catch(() => null);
    const text = typeof body?.text === "string" ? body.text.trim() : "";

    if (!text) {
      return c.json({ error: "textは必須です" }, 400);
    }

    try {
      const { entries, skippedLines, nameCandidateSuggestions } = await addJournalEntriesBulk(text, {
        ...maskOptionsFromBodyStrict(body),
      });
      return c.json({ entries: toJournalEntryViews(entries, new Map()), skippedLines, nameCandidateSuggestions }, 201);
    } catch (err) {
      return jsonFromUnknownError(err);
    }
  })
  // ユーザー要望「一覧の全件取得をページネーション化したい」対応。/journal（一覧・検索画面）
  // 専用のエンドポイント。既存の/api/journal（全件取得）はDashboard・Organization Context画面
  // （直近5件表示・チームVitalsの集計）が引き続き使うため変更しない——今回のスコープは
  // 一覧・検索画面のページ送りのみ。
  .get("/search", async (c) => {
    const pageSize = Math.min(MAX_PAGE_SIZE, parsePositiveInt(c.req.query("pageSize"), DEFAULT_PAGE_SIZE));

    const urgencyParam = c.req.query("urgency");
    const sentimentParam = c.req.query("sentiment");
    const filter: JournalListFilter = {
      query: c.req.query("query")?.trim() || undefined,
      tag: c.req.query("tag")?.trim() || undefined,
      person: c.req.query("person")?.trim() || undefined,
      urgency: urgencyParam && (URGENCIES as readonly string[]).includes(urgencyParam) ? (urgencyParam as Urgency) : undefined,
      sentiment:
        sentimentParam && (SENTIMENTS as readonly string[]).includes(sentimentParam) ? (sentimentParam as Sentiment) : undefined,
      excludeResolved: c.req.query("excludeResolved") === "1",
      includeArchived: c.req.query("includeArchived") === "1",
      quarantinedOnly: c.req.query("quarantinedOnly") === "1",
    };
    const periodDays = c.req.query("periodDays");
    if (periodDays && periodDays !== "all") {
      const days = Number(periodDays);
      if (Number.isFinite(days) && days > 0) filter.sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;
    }

    // ユーザー指摘「Dashboardから特定のJournalエントリへ直接飛ぶ深いリンクを、ページネーション後も
    // 保ちたい」対応。focusIdが指定されていれば、そのエントリが載っているページをサーバー側で
    // 求め、pageクエリより優先する（見つからなければ通常通りpageクエリに従う）。
    const focusId = c.req.query("focusId");
    let page = parsePositiveInt(c.req.query("page"), 1);
    if (focusId) {
      const offset = findJournalEntryOffset(focusId, filter);
      if (offset !== undefined) page = Math.floor(offset / pageSize) + 1;
    }

    const { entries, total } = listJournalEntriesPage(filter, { limit: pageSize, offset: (page - 1) * pageSize });
    const facets = listJournalFacets();
    return c.json({
      entries: toJournalEntryViews(entries, await buildSourceConsultIndex()),
      total,
      page,
      pageSize,
      facets,
    });
  })
  .get("/:id", async (c) => {
    const id = c.req.param("id");
    const exact = getCurrentJournalEntry(id);
    if (exact) {
      return c.json({ entry: toJournalEntryView(exact, await buildSourceConsultIndex()) });
    }
    const resolved = resolveUniqueByPrefix(listJournalEntries(), (e) => e.id, id);
    if (resolved.status === "none") {
      return c.json({ error: "not found" }, 404);
    }
    if (resolved.status === "ambiguous") {
      return c.json(
        {
          error: "ambiguous",
          candidates: resolved.items.map((e) => ({
            id: e.id,
            label: e.summary || e.rawText.slice(0, 80),
            href: `/journal?focus=${encodeURIComponent(e.id)}`,
          })),
        },
        409,
      );
    }
    return c.json({ entry: toJournalEntryView(resolved.item, await buildSourceConsultIndex()) });
  })
  // docs/memo.md「C. Journalセンシング→行動」対応。AI抽出（tags/people/urgency）を
  // EMがその場で校正するためのエンドポイント。内部的には新しいイベントをsupersedesで
  // 繋いで記録するだけで、元のジャーナルは削除・上書きしない。
  .patch("/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);

    // docs/em_human_story_and_ux.md 改修依頼「まとめ入力・通常投入どちらでも日付レベルの
    // 訂正を扱えるように」対応。occurredAtDateは"YYYY-MM-DD"（日付レベルのみ）。
    let occurredAt: number | undefined;
    if (typeof body?.occurredAtDate === "string" && body.occurredAtDate) {
      occurredAt = resolveJournalOccurredAtFromDateInput(body.occurredAtDate, Date.now());
      if (occurredAt === undefined) {
        return c.json({ error: "occurredAtDateの形式が不正です（YYYY-MM-DD）" }, 400);
      }
    }

    // docs/em_human_story_and_ux.md 改修依頼「Journalの本文を編集できるようにする」対応。
    // 記録時の言い間違い等の訂正用。空文字での更新はPOST同様に拒否する。
    if (typeof body?.rawText === "string" && !body.rawText.trim()) {
      return c.json({ error: "rawTextは空にできません" }, 400);
    }

    // docs/em_human_story_and_ux.md 改修依頼「Journalをurgency:highのまま解決済みにできない」
    // 対応。未指定（キー自体が無い）=変更しない、null=解除、文字列=設定、の3値。
    // docs/2nd_pivot_version.md Phase 3対応。既存Issueへの手動紐付けUIは廃止し、現在この経路を
    // 呼ぶのは「Issueを起票してこの件を追跡する」（作成直後のIssueへの自動紐付け、常にissue.id
    // 自体を渡すため完全一致でヒットする）のみ。プレフィックス解決は他のID参照
    // （/go/<fragment>等）と共通の汎用ロジックのため、そのまま残している。
    let resolvedIssueId: string | null | undefined;
    if (body?.resolvedIssueId === undefined) {
      resolvedIssueId = undefined;
    } else if (body.resolvedIssueId === null) {
      resolvedIssueId = null;
    } else if (typeof body.resolvedIssueId === "string") {
      const resolved = resolveUniqueByPrefix(listIssues(), (i) => i.id, body.resolvedIssueId);
      if (resolved.status === "none") {
        return c.json({ error: "指定された提案が見つかりません" }, 400);
      }
      if (resolved.status === "ambiguous") {
        return c.json(
          {
            error: "ambiguous",
            candidates: resolved.items.map((i) => ({ id: i.id, label: i.title, href: `/issues/${i.id}` })),
          },
          409,
        );
      }
      resolvedIssueId = resolved.item.id;
    } else {
      resolvedIssueId = undefined;
    }
    const resolutionNote =
      body?.resolutionNote === undefined
        ? undefined
        : body.resolutionNote === null
          ? null
          : typeof body.resolutionNote === "string"
            ? body.resolutionNote
            : undefined;

    try {
      const entry = await updateJournalEntry(
        id,
        {
          rawText: typeof body?.rawText === "string" && body.rawText.trim() ? body.rawText : undefined,
          tags: Array.isArray(body?.tags) ? body.tags.filter((t: unknown): t is string => typeof t === "string") : undefined,
          people: Array.isArray(body?.people)
            ? body.people.filter((p: unknown): p is string => typeof p === "string")
            : undefined,
          teams: Array.isArray(body?.teams)
            ? body.teams.filter((t: unknown): t is string => typeof t === "string")
            : undefined,
          teamIds: Array.isArray(body?.teamIds)
            ? body.teamIds.filter((t: unknown): t is string => typeof t === "string")
            : undefined,
          urgency: body?.urgency === "low" || body?.urgency === "mid" || body?.urgency === "high" ? body.urgency : undefined,
          sentiment:
            body?.sentiment === "positive" || body?.sentiment === "negative" || body?.sentiment === "neutral"
              ? body.sentiment
              : undefined,
          occurredAt,
          resolvedIssueId,
          resolutionNote,
        },
        maskOptionsFromBodyStrict(body),
      );
      if (!entry) {
        return c.json({ error: "not found" }, 404);
      }
      return c.json({ entry: toJournalEntryView(entry, await buildSourceConsultIndex()) });
    } catch (err) {
      return jsonFromUnknownError(err);
    }
  })
  // docs/memo.md「相談、Journal、提案を削除（アーカイブ）したい」対応。重複記録・誤入力等の
  // Journalを、内容の訂正（PATCH・supersedesチェーン）とは別に、一覧・AIの判断材料から
  // 除外する専用エンドポイント（no-action-neededと同じ思想のin-place更新）。
  .post("/:id/archive", async (c) => {
    const id = c.req.param("id");
    const entry = archiveJournalEntry(id);
    if (!entry) return c.json({ error: "not found" }, 404);
    return c.json({ entry: toJournalEntryView(entry, await buildSourceConsultIndex()) });
  })
  .delete("/:id/archive", async (c) => {
    const id = c.req.param("id");
    const entry = unarchiveJournalEntry(id);
    if (!entry) return c.json({ error: "not found" }, 404);
    return c.json({ entry: toJournalEntryView(entry, await buildSourceConsultIndex()) });
  })
  // ユーザー指摘「確認したが対応不要だった、をEM側から示せない・UI上の強調を減らせない」対応。
  // sentimentの値そのものは書き換えず、「EMが確認し対応不要と判断した」という事実だけを
  // 別途記録する。内容の訂正ではないため、通常のPATCH（supersedesチェーン）とは別の
  // 専用エンドポイントにし、in-placeで更新する。
  .post("/:id/no-action-needed", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    const note = typeof body?.note === "string" ? body.note : undefined;
    try {
      const entry = await setJournalNoActionNeeded(id, note);
      if (!entry) return c.json({ error: "not found" }, 404);
      return c.json({ entry: toJournalEntryView(entry, await buildSourceConsultIndex()) });
    } catch (err) {
      return jsonFromUnknownError(err);
    }
  })
  .delete("/:id/no-action-needed", async (c) => {
    const id = c.req.param("id");
    const entry = clearJournalNoActionNeeded(id);
    if (!entry) return c.json({ error: "not found" }, 404);
    return c.json({ entry: toJournalEntryView(entry, await buildSourceConsultIndex()) });
  });
