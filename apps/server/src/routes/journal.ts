import { Hono } from "hono";
import { z } from "zod";
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
import { listSuggestions } from "@emther/core/suggestion-store";
import { requestJournalAnalysis } from "@emther/core/journal-analysis";
import { startJournalBatchAnalysis, toRunView } from "@emther/core/agent-runtime/index";
import { isUnconfirmedNameCandidatesError } from "@emther/core/name-candidate-confirmation";
import { jsonFromUnknownError, maskOptionsFromBody, maskOptionsFromBodyStrict } from "../lib/name-candidate-response";

// docs/2nd_architecture/plan.md フェーズ2.5:
// web/src/app/api/journal/{route,[id]/route,[id]/archive/route,
// [id]/no-action-needed/route,bulk/route,search/route,[id]/analyze/route,
// batch/route}.ts の移植。

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;
const URGENCIES: readonly Urgency[] = ["low", "mid", "high"];
const SENTIMENTS: readonly Sentiment[] = ["positive", "negative", "neutral"];

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const n = value !== undefined ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

// docs/2nd_architecture/plan.md フェーズ2.6: 手書きの typeof/Array.isArray ガードを
// Zod スキーマに置き換える。既存の「型が違う値は黙って undefined 扱いにする」寛容さを
// 1:1 で保つため、各フィールドに .catch() を付け、パース失敗時は例外を投げず
// フォールバック値（未指定と同じ扱い）にする。オブジェクト全体も .catch({}) で包み、
// body 自体が null/非オブジェクトでも全フィールド未指定として扱う（例外を投げない）。
const journalPostBodyObject = z.object({
  text: z.string().optional().catch(undefined),
  occurredAtDate: z.string().optional().catch(undefined),
  people: z.array(z.string()).optional().catch(undefined),
  teams: z.array(z.string()).optional().catch(undefined),
  teamIds: z.array(z.string()).optional().catch(undefined),
});
const journalPostBodySchema = journalPostBodyObject.catch({});
// POST /bulk はtextのみ使う。.pick()はZodObjectにしか使えないため、.catch()を
// 被せる前のjournalPostBodyObjectから派生させる。
const journalBulkBodySchema = journalPostBodyObject.pick({ text: true }).catch({});

const journalPatchBodySchema = z
  .object({
    rawText: z.string().optional().catch(undefined),
    tags: z.array(z.string()).optional().catch(undefined),
    people: z.array(z.string()).optional().catch(undefined),
    teams: z.array(z.string()).optional().catch(undefined),
    teamIds: z.array(z.string()).optional().catch(undefined),
    urgency: z.enum(["low", "mid", "high"]).optional().catch(undefined),
    sentiment: z.enum(["positive", "negative", "neutral"]).optional().catch(undefined),
    occurredAtDate: z.string().optional().catch(undefined),
    // resolvedSuggestionId/resolutionNoteは「未指定=変更しない」「null=解除」「文字列=設定」の
    // 3値。不正な型（数値・オブジェクト等）は「未指定」と同じ扱いに落とす（.catch(undefined)）。
    resolvedSuggestionId: z.string().nullable().optional().catch(undefined),
    resolutionNote: z.string().nullable().optional().catch(undefined),
  })
  .catch({});

export const journalRoute = new Hono()
  .get("/", async (c) => c.json({ entries: toJournalEntryViews(listJournalEntries(), await buildSourceConsultIndex()) }))
  .post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = journalPostBodySchema.parse(body);
    const text = parsed.text?.trim() ?? "";

    if (!text) {
      return c.json({ error: "textは必須です" }, 400);
    }

    // docs/em_human_story_and_ux.md 改修依頼「通常投入でも日付レベルの訂正を検討」対応。
    // occurredAtDateは"YYYY-MM-DD"（日付レベルのみ・時刻は求めない）。省略時はこれまで通り
    // Date.now()（＝今日）を使う。
    let occurredAt: number | undefined;
    if (parsed.occurredAtDate) {
      occurredAt = resolveJournalOccurredAtFromDateInput(parsed.occurredAtDate, Date.now());
      if (occurredAt === undefined) {
        return c.json({ error: "occurredAtDateの形式が不正です（YYYY-MM-DD）" }, 400);
      }
    }

    // 人物詳細など「このメンバーに紐づけて書く」導線向け。EMが明示した人物名は
    // NER抽出に頼らず作成時から people に入れる（未指定時は従来どおり抽出のみ）。
    const people = parsed.people?.filter((p) => p.trim().length > 0);
    const teams = parsed.teams?.filter((t) => t.trim().length > 0);
    const teamIds = parsed.teamIds?.filter((t) => t.trim().length > 0);

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
    const text = journalBulkBodySchema.parse(body).text?.trim() ?? "";

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
    const parsed = journalPatchBodySchema.parse(body);

    // docs/em_human_story_and_ux.md 改修依頼「まとめ入力・通常投入どちらでも日付レベルの
    // 訂正を扱えるように」対応。occurredAtDateは"YYYY-MM-DD"（日付レベルのみ）。
    let occurredAt: number | undefined;
    if (parsed.occurredAtDate) {
      occurredAt = resolveJournalOccurredAtFromDateInput(parsed.occurredAtDate, Date.now());
      if (occurredAt === undefined) {
        return c.json({ error: "occurredAtDateの形式が不正です（YYYY-MM-DD）" }, 400);
      }
    }

    // docs/em_human_story_and_ux.md 改修依頼「Journalの本文を編集できるようにする」対応。
    // 記録時の言い間違い等の訂正用。空文字での更新はPOST同様に拒否する。
    if (parsed.rawText !== undefined && !parsed.rawText.trim()) {
      return c.json({ error: "rawTextは空にできません" }, 400);
    }

    // docs/em_human_story_and_ux.md 改修依頼「Journalをurgency:highのまま解決済みにできない」
    // 対応。未指定（キー自体が無い）=変更しない、null=解除、文字列=設定、の3値。
    // docs/2nd_pivot_version.md Phase 3対応。既存提案への手動紐付けUIは廃止し、現在この経路を
    // 呼ぶのは「提案を起票してこの件を追跡する」（作成直後の提案への自動紐付け、常にsuggestion.id
    // 自体を渡すため完全一致でヒットする）のみ。プレフィックス解決は他のID参照
    // （/go/<fragment>等）と共通の汎用ロジックのため、そのまま残している。
    let resolvedSuggestionId: string | null | undefined;
    if (parsed.resolvedSuggestionId === undefined) {
      resolvedSuggestionId = undefined;
    } else if (parsed.resolvedSuggestionId === null) {
      resolvedSuggestionId = null;
    } else {
      const resolved = resolveUniqueByPrefix(listSuggestions(), (s) => s.id, parsed.resolvedSuggestionId);
      if (resolved.status === "none") {
        return c.json({ error: "指定された提案が見つかりません" }, 400);
      }
      if (resolved.status === "ambiguous") {
        return c.json(
          {
            error: "ambiguous",
            candidates: resolved.items.map((s) => ({ id: s.id, label: s.title, href: `/suggestions/${s.id}` })),
          },
          409,
        );
      }
      resolvedSuggestionId = resolved.item.id;
    }
    const resolutionNote = parsed.resolutionNote;

    try {
      const entry = await updateJournalEntry(
        id,
        {
          rawText: parsed.rawText && parsed.rawText.trim() ? parsed.rawText : undefined,
          tags: parsed.tags,
          people: parsed.people,
          teams: parsed.teams,
          teamIds: parsed.teamIds,
          urgency: parsed.urgency,
          sentiment: parsed.sentiment,
          occurredAt,
          resolvedSuggestionId,
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
  })
  // docs/usage_issues U16。EMが明示した手動分析。投稿時・自動フィルタとは独立に起動する。
  .post("/:id/analyze", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);

    const current = getCurrentJournalEntry(id);
    if (!current) {
      return c.json({ error: "not found" }, 404);
    }
    if (!current.confirmed) {
      return c.json({ error: "未確認のJournalは分析できません。先に内容を確定してください。" }, 400);
    }

    try {
      const result = await requestJournalAnalysis(id, maskOptionsFromBody(body));
      if (!result) {
        return c.json({ error: "not found" }, 404);
      }
      return c.json(
        {
          entry: { ...toJournalEntryView(result.entry, new Map()), sourceConsultRunId: result.run.id },
          run: toRunView(result.run),
        },
        201,
      );
    } catch (err) {
      return jsonFromUnknownError(err);
    }
  })
  // ユーザー要望「現場メモ（Journal）ページから、集約解釈を手動実行できるボタンを置きたい」
  // 対応。/api/themes/distillと同型のオンデマンド起動。
  .post("/batch", async (c) => {
    try {
      const run = await startJournalBatchAnalysis({ manual: true });
      if (!run) {
        return c.json({ pendingUnmasked: true }, 202);
      }
      return c.json({ run: toRunView(run) }, 201);
    } catch (err) {
      if (isUnconfirmedNameCandidatesError(err)) {
        return c.json({ error: err.message, candidates: err.candidates }, 409);
      }
      return c.json({ error: (err as Error).message }, 500);
    }
  });
