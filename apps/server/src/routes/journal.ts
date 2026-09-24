import { Hono } from "hono";
import {
  journalBulkBodySchema,
  journalPatchBodySchema,
  journalPostBodySchema,
} from "@emther/api-contract/journal";
import type {
  AgentRunMutationResponse,
  JournalAnalyzeResponse,
  JournalBatchStatusResponse,
  JournalBulkResponse,
  JournalCreateResponse,
  JournalEntryResponse,
  JournalListResponse,
  JournalSearchResponse,
  PendingUnmaskedResponse,
} from "@emther/api-contract";
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
  markJournalSensitive,
  setJournalNoActionNeeded,
  toJournalEntryView,
  toJournalEntryViews,
  unarchiveJournalEntry,
  unmarkJournalSensitive,
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
import { countPendingForNextJournalBatch } from "@emther/core/agent-runtime/journal-batch-window";
import { isUnconfirmedNameCandidatesError } from "@emther/core/name-candidate-confirmation";
import { jsonFromUnknownError, maskOptionsFromBody, maskOptionsFromBodyStrict } from "../lib/name-candidate-response";

// 入力スキーマは @emther/api-contract（寛容パース。.catch で不正型→未指定）。

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;
const URGENCIES: readonly Urgency[] = ["low", "mid", "high"];
const SENTIMENTS: readonly Sentiment[] = ["positive", "negative", "neutral"];

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const n = value !== undefined ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export const journalRoute = new Hono()
  .get("/", async (c) => {
    const body = {
      entries: toJournalEntryViews(listJournalEntries(), await buildSourceConsultIndex()),
    } satisfies JournalListResponse;
    return c.json(body);
  })
  .post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = journalPostBodySchema.parse(body);
    const text = parsed.text?.trim() ?? "";

    if (!text) {
      return c.json({ error: "textは必須です" }, 400);
    }

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
      ...(parsed.sensitive === true ? { sensitive: true } : {}),
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
      // profileCandidateは投稿直後だけの一度きりのヒント（永続化しない）。
      const resBody = {
        entry: toJournalEntryView(entry, new Map()),
        nameCandidates,
        profileCandidate,
      } satisfies JournalCreateResponse;
      return c.json(resBody, 201);
    } catch (err) {
      return jsonFromUnknownError(err);
    }
  })
  // まとめて記録する専用エンドポイント（1件ずつ Submit する負担を減らす）。
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
      const resBody = {
        entries: toJournalEntryViews(entries, new Map()),
        skippedLines,
        nameCandidateSuggestions,
      } satisfies JournalBulkResponse;
      return c.json(resBody, 201);
    } catch (err) {
      return jsonFromUnknownError(err);
    }
  })
  // /journal（一覧・検索）専用のページネーション。既存の /api/journal（全件）は
  // Dashboard・Organization Context（直近5件・チームVitals集計）が使うため変更しない。
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
      includeSensitive: c.req.query("includeSensitive") === "1",
    };
    const periodDays = c.req.query("periodDays");
    if (periodDays && periodDays !== "all") {
      const days = Number(periodDays);
      if (Number.isFinite(days) && days > 0) filter.sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;
    }

    // focusId 指定時は、そのエントリが載っているページをサーバー側で求め page クエリより優先する
    // （見つからなければ通常通り page クエリに従う）。深いリンクをページネーション後も保つため。
    const focusId = c.req.query("focusId");
    let page = parsePositiveInt(c.req.query("page"), 1);
    if (focusId) {
      const offset = findJournalEntryOffset(focusId, filter);
      if (offset !== undefined) page = Math.floor(offset / pageSize) + 1;
    }

    const { entries, total } = listJournalEntriesPage(filter, { limit: pageSize, offset: (page - 1) * pageSize });
    const facets = listJournalFacets();
    const body = {
      entries: toJournalEntryViews(entries, await buildSourceConsultIndex()),
      total,
      page,
      pageSize,
      facets,
    } satisfies JournalSearchResponse;
    return c.json(body);
  })
  // 集約解釈のオンデマンド起動（/api/themes/distill と同型）。
  // GET は未解釈があるときだけストリップ表示するための件数。
  // /:id より前に置く（"batch" が id として解釈されないようにする）。
  .get("/batch", (c) => {
    const pendingCount = countPendingForNextJournalBatch(listJournalEntries());
    const body = { pendingCount } satisfies JournalBatchStatusResponse;
    return c.json(body);
  })
  .post("/batch", async (c) => {
    try {
      const run = await startJournalBatchAnalysis({ manual: true });
      if (!run) {
        const pendingBody = { pendingUnmasked: true } satisfies PendingUnmaskedResponse;
        return c.json(pendingBody, 202);
      }
      const resBody = { run: toRunView(run) } satisfies AgentRunMutationResponse;
      return c.json(resBody, 201);
    } catch (err) {
      if (isUnconfirmedNameCandidatesError(err)) {
        return c.json({ error: err.message, candidates: err.candidates }, 409);
      }
      return c.json({ error: (err as Error).message }, 500);
    }
  })
  .get("/:id", async (c) => {
    const id = c.req.param("id");
    const exact = getCurrentJournalEntry(id);
    if (exact) {
      const body = {
        entry: toJournalEntryView(exact, await buildSourceConsultIndex()),
      } satisfies JournalEntryResponse;
      return c.json(body);
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
    const body = {
      entry: toJournalEntryView(resolved.item, await buildSourceConsultIndex()),
    } satisfies JournalEntryResponse;
    return c.json(body);
  })
  // AI抽出（tags/people/urgency）をEMがその場で校正する。内部的には supersedes で
  // 新しいイベントを繋ぐだけで、元のジャーナルは削除・上書きしない。
  .patch("/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    const parsed = journalPatchBodySchema.parse(body);

    // occurredAtDateは"YYYY-MM-DD"（日付レベルのみ）。
    let occurredAt: number | undefined;
    if (parsed.occurredAtDate) {
      occurredAt = resolveJournalOccurredAtFromDateInput(parsed.occurredAtDate, Date.now());
      if (occurredAt === undefined) {
        return c.json({ error: "occurredAtDateの形式が不正です（YYYY-MM-DD）" }, 400);
      }
    }

    // 記録時の言い間違い等の訂正用。空文字での更新はPOST同様に拒否する。
    if (parsed.rawText !== undefined && !parsed.rawText.trim()) {
      return c.json({ error: "rawTextは空にできません" }, 400);
    }

    // resolvedSuggestionId: 未指定（キー無し）=変更しない、null=解除、文字列=設定。
    // 現状この経路を呼ぶのは「提案を起票してこの件を追跡する」（作成直後の提案への自動紐付け、
    // 常に suggestion.id 自体を渡すため完全一致でヒット）のみ。プレフィックス解決は
    // /go/<fragment> 等と共通の汎用ロジックのため残している。
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
      const resBody = { entry: toJournalEntryView(entry, await buildSourceConsultIndex()) } satisfies JournalEntryResponse;
      return c.json(resBody);
    } catch (err) {
      return jsonFromUnknownError(err);
    }
  })
  // 重複・誤入力等を一覧・AIの判断材料から除外する（PATCH/supersedes とは別の in-place 更新）。
  .post("/:id/archive", async (c) => {
    const id = c.req.param("id");
    const entry = archiveJournalEntry(id);
    if (!entry) return c.json({ error: "not found" }, 404);
    const resBody = { entry: toJournalEntryView(entry, await buildSourceConsultIndex()) } satisfies JournalEntryResponse;
    return c.json(resBody);
  })
  .delete("/:id/archive", async (c) => {
    const id = c.req.param("id");
    const entry = unarchiveJournalEntry(id);
    if (!entry) return c.json({ error: "not found" }, 404);
    const resBody = { entry: toJournalEntryView(entry, await buildSourceConsultIndex()) } satisfies JournalEntryResponse;
    return c.json(resBody);
  })
  // Journal センシティブ設定。UI 一覧から既定で除外する（アーカイブと同型の in-place）。
  .post("/:id/sensitive", async (c) => {
    const id = c.req.param("id");
    const entry = markJournalSensitive(id);
    if (!entry) return c.json({ error: "not found" }, 404);
    const resBody = { entry: toJournalEntryView(entry, await buildSourceConsultIndex()) } satisfies JournalEntryResponse;
    return c.json(resBody);
  })
  .delete("/:id/sensitive", async (c) => {
    const id = c.req.param("id");
    const entry = unmarkJournalSensitive(id);
    if (!entry) return c.json({ error: "not found" }, 404);
    const resBody = { entry: toJournalEntryView(entry, await buildSourceConsultIndex()) } satisfies JournalEntryResponse;
    return c.json(resBody);
  })
  // sentiment は書き換えず、「EMが確認し対応不要と判断した」事実だけを別途記録する。
  // 内容の訂正ではないため PATCH（supersedes）とは別の専用エンドポイントで in-place 更新。
  .post("/:id/no-action-needed", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    const note = typeof body?.note === "string" ? body.note : undefined;
    try {
      const entry = await setJournalNoActionNeeded(id, note);
      if (!entry) return c.json({ error: "not found" }, 404);
      const resBody = { entry: toJournalEntryView(entry, await buildSourceConsultIndex()) } satisfies JournalEntryResponse;
      return c.json(resBody);
    } catch (err) {
      return jsonFromUnknownError(err);
    }
  })
  .delete("/:id/no-action-needed", async (c) => {
    const id = c.req.param("id");
    const entry = clearJournalNoActionNeeded(id);
    if (!entry) return c.json({ error: "not found" }, 404);
    const resBody = { entry: toJournalEntryView(entry, await buildSourceConsultIndex()) } satisfies JournalEntryResponse;
    return c.json(resBody);
  })
  // EMが明示した手動分析。投稿時・自動フィルタとは独立に起動する。
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
      const resBody = {
        entry: { ...toJournalEntryView(result.entry, new Map()), sourceConsultRunId: result.run.id },
        run: toRunView(result.run),
      } satisfies JournalAnalyzeResponse;
      return c.json(resBody, 201);
    } catch (err) {
      return jsonFromUnknownError(err);
    }
  });
