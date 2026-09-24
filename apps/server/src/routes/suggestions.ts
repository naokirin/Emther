import { Hono } from "hono";
import type { SuggestionDetailResponse, SuggestionMutationResponse, SuggestionsResponse } from "@emther/api-contract";
import {
  addMemo,
  adviceFieldsFromProposal,
  archiveSuggestion,
  createSuggestion,
  getSuggestion,
  listSuggestions,
  moveFocusSuggestion,
  setConfirmPriority,
  setReviewStatus,
  setSuggestionDetail,
  setSuggestionReviewDueAt,
  setSuggestionTeam,
  setSuggestionTheme,
  setSuggestionTitle,
  toSuggestionView,
  unarchiveSuggestion,
  updateSuggestionCharter,
  updateSuggestionDetail,
} from "@emther/core/suggestion-store";
import { buildSuggestionDraftTask, getRun, markRunReviewed, parkPendingUnmaskedSend, reactToSuggestionUpdate, startRun } from "@emther/core/agent-runtime/index";
import { isUnconfirmedNameCandidatesError } from "@emther/core/name-candidate-confirmation";
import { linkJournalToSuggestion, listSourceJournalsForSuggestion, toJournalEntryViews } from "@emther/core/journal-store";
import { buildSourceConsultIndex } from "@emther/core/journal-consult-index";
import { resolveUniqueByPrefix } from "@emther/core/id-resolve";
import { CONFIRM_PRIORITIES, SUGGESTION_REVIEW_STATUSES, type ConfirmPriority, type SuggestionReviewStatus } from "@emther/core/types";
import { jsonFromUnknownError, maskOptionsFromBody } from "../lib/name-candidate-response";

function resolveSuggestionForRead(id: string) {
  return resolveUniqueByPrefix(listSuggestions(), (s) => s.id, id);
}

function resolveSuggestionId(id: string): string | undefined {
  const exact = getSuggestion(id);
  if (exact) return exact.id;
  const resolved = resolveSuggestionForRead(id);
  if (resolved.status === "exact" || resolved.status === "unique") return resolved.item.id;
  return undefined;
}

export const suggestionsRoute = new Hono()
  .get("/", (c) => {
    const body = { suggestions: listSuggestions().map(toSuggestionView) } satisfies SuggestionsResponse;
    return c.json(body);
  })
  // 相談／Journal／未紐付け Run から提案を残す入口
  // - agentRunId あり: その Run を提案の主分析として紐付け、reviewed 化（Inbox 等からの起票）
  // - sourceRunId のみ: 相談スレッドは相談履歴に残し、提案専用の新規分析 Run は起動しない
  // - どちらも無し: Lead Agent の分析 Run を自動起動する（旧 Issue 起票と同じ）
  .post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    const title = typeof body?.title === "string" ? body.title.trim() : "";
    const agentRunId = typeof body?.agentRunId === "string" && body.agentRunId ? body.agentRunId : undefined;

    if (!title) {
      return c.json({ error: "titleは必須です" }, 400);
    }

    const themeId = typeof body?.themeId === "string" && body.themeId ? body.themeId : undefined;
    const teamId = typeof body?.teamId === "string" && body.teamId ? body.teamId : undefined;
    const charter = {
      why: typeof body?.why === "string" ? body.why : undefined,
      what: typeof body?.what === "string" ? body.what : undefined,
      how: typeof body?.how === "string" ? body.how : undefined,
    };
    const confirmPriority =
      typeof body?.confirmPriority === "string" && CONFIRM_PRIORITIES.includes(body.confirmPriority as ConfirmPriority)
        ? (body.confirmPriority as ConfirmPriority)
        : typeof body?.priority === "string" && CONFIRM_PRIORITIES.includes(body.priority as ConfirmPriority)
          ? (body.priority as ConfirmPriority)
          : undefined;
    const opts = maskOptionsFromBody(body);
    const sourceRunId = typeof body?.sourceRunId === "string" && body.sourceRunId.trim() ? body.sourceRunId.trim() : agentRunId;
    const sourceRun = agentRunId ? getRun(agentRunId) : sourceRunId ? getRun(sourceRunId) : undefined;
    const sourceJournalId =
      typeof body?.sourceJournalId === "string" && body.sourceJournalId.trim() ? body.sourceJournalId.trim() : sourceRun?.sourceJournalId;

    // （マスク済み）にproposalがあれば、起票直後にそのままdetailとして持たせる。判断・提案
    // （Agent）パネルは紐づくAgent Runが差し替わると内容も変わりうるため、起票時点の結論・
    // 根拠・ロジック・アドバイスを提案自体に固定するのがねらい
    const detail = sourceRun?.proposal
      ? {
          conclusion: sourceRun.proposal.conclusion,
          facts: sourceRun.proposal.facts,
          logic: sourceRun.proposal.logic,
          ...(sourceRun.proposal.expansions?.length ? { expansions: sourceRun.proposal.expansions } : {}),
          ...(sourceRun.proposal.challenges?.length ? { challenges: sourceRun.proposal.challenges } : {}),
          ...adviceFieldsFromProposal(sourceRun.proposal),
        }
      : undefined;

    try {
      const suggestion = await createSuggestion(title, {
        ...opts,
        agentRunId,
        sourceRunId,
        sourceJournalId,
        themeId,
        teamId,
        confirmPriority,
        detail,
      });
      const why = charter.why?.trim() ?? "";
      const what = charter.what?.trim() ?? "";
      const how = charter.how?.trim() ?? "";
      if (why || what || how) {
        const parts = [why ? `Why: ${why}` : "", what ? `What: ${what}` : "", how ? `How: ${how}` : ""].filter(Boolean);
        await addMemo(suggestion.id, `（旧 Why/What/How）\n${parts.join("\n")}`, { ...opts, source: "agent" });
      }
      if (agentRunId) {
        markRunReviewed(agentRunId);
        if (sourceJournalId) {
          await linkJournalToSuggestion(sourceJournalId, suggestion.id, opts).catch(() => {
            // Journal 紐付け失敗で提案作成自体は失敗させない。
          });
        }
      } else if (sourceRunId) {
        // 相談からの提案化: 相談 Run を提案の主分析に吸収せず、履歴・続きの壁打ちを残す。
        markRunReviewed(sourceRunId);
        if (sourceJournalId) {
          await linkJournalToSuggestion(sourceJournalId, suggestion.id, opts).catch(() => {
            // Journal 紐付け失敗で提案作成自体は失敗させない。
          });
        }
      } else {
        const task = buildSuggestionDraftTask(title, charter);
        try {
          await startRun("Lead Agent", task, "manual", suggestion.id, { ...opts, sourceJournalId });
        } catch (err) {
          if (isUnconfirmedNameCandidatesError(err)) {
            parkPendingUnmaskedSend({
              id: `unmasked-start:${suggestion.id}:${Date.now()}`,
              kind: "start-run",
              candidates: err.candidates,
              label: "提案作成直後の分析送信確認",
              suggestionId: suggestion.id,
              suggestionTitle: title,
              agentName: "Lead Agent",
              task,
              origin: "manual",
              linkedSuggestionId: suggestion.id,
              sourceJournalId,
            });
          }
        }
      }
      const resBody = { suggestion: toSuggestionView(suggestion) } satisfies SuggestionMutationResponse;
      return c.json(resBody, 201);
    } catch (err) {
      return jsonFromUnknownError(err, 400);
    }
  })
  .get("/:id", async (c) => {
    const id = c.req.param("id");
    const resolved = resolveSuggestionForRead(id);
    if (resolved.status === "none") {
      return c.json({ error: "not found" }, 404);
    }
    if (resolved.status === "ambiguous") {
      return c.json(
        { error: "ambiguous", candidates: resolved.items.map((s) => ({ id: s.id, title: s.title, href: `/suggestions/${s.id}` })) },
        409,
      );
    }
    const suggestion = resolved.item;
    const body = {
      suggestion: toSuggestionView(suggestion),
      sourceJournals: toJournalEntryViews(listSourceJournalsForSuggestion(suggestion.id, suggestion.sourceJournalId), await buildSourceConsultIndex()),
    } satisfies SuggestionDetailResponse;
    return c.json(body);
  })
  .patch("/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    const opts = maskOptionsFromBody(body);

    if (typeof body?.title === "string" && !body.title.trim()) {
      return c.json({ error: "titleは必須です" }, 400);
    }
    if ("reviewStatus" in (body ?? {}) && !SUGGESTION_REVIEW_STATUSES.includes(body.reviewStatus)) {
      return c.json({ error: "reviewStatusの値が不正です" }, 400);
    }
    if ("confirmPriority" in (body ?? {}) && !CONFIRM_PRIORITIES.includes(body.confirmPriority)) {
      return c.json({ error: "confirmPriorityの値が不正です" }, 400);
    }
    if ("moveFocus" in (body ?? {}) && body.moveFocus !== "up" && body.moveFocus !== "down") {
      return c.json({ error: "moveFocusは up または down です" }, 400);
    }
    if ("archived" in (body ?? {}) && typeof body.archived !== "boolean") {
      return c.json({ error: "archivedはtrue/falseです" }, 400);
    }
    if ("reviewDueAt" in (body ?? {}) && body.reviewDueAt !== null && typeof body.reviewDueAt !== "number") {
      return c.json({ error: "reviewDueAtは数値（タイムスタンプ）またはnullです" }, 400);
    }
    if ("detail" in (body ?? {})) {
      const d = body.detail;
      if (!d || typeof d !== "object") {
        return c.json({ error: "detailはオブジェクトです" }, 400);
      }
      if ("conclusion" in d && typeof d.conclusion !== "string") {
        return c.json({ error: "detail.conclusionは文字列です" }, 400);
      }
      if ("logic" in d && typeof d.logic !== "string") {
        return c.json({ error: "detail.logicは文字列です" }, 400);
      }
      if ("facts" in d && (!Array.isArray(d.facts) || !d.facts.every((f: unknown) => typeof f === "string"))) {
        return c.json({ error: "detail.factsは文字列の配列です" }, 400);
      }
      if ("advice" in d && typeof d.advice !== "string") {
        return c.json({ error: "detail.adviceは文字列です" }, 400);
      }
    }

    const suggestionId = resolveSuggestionId(id);
    if (!suggestionId) {
      return c.json({ error: "not found" }, 404);
    }

    try {
      let suggestion = getSuggestion(suggestionId)!;

      if (typeof body?.title === "string" && body.title.trim()) {
        suggestion =
          (await setSuggestionTitle(suggestionId, body.title, {
            ...opts,
            onUpdated: (sid, _trigger, detail) => reactToSuggestionUpdate(sid, "charter", detail),
          })) ?? suggestion;
      }
      if (
        typeof body?.why === "string" ||
        typeof body?.what === "string" ||
        typeof body?.how === "string"
      ) {
        suggestion =
          (await updateSuggestionCharter(
            suggestionId,
            {
              why: typeof body?.why === "string" ? body.why : undefined,
              what: typeof body?.what === "string" ? body.what : undefined,
              how: typeof body?.how === "string" ? body.how : undefined,
            },
            { ...opts, onUpdated: (sid, _trigger, detail) => reactToSuggestionUpdate(sid, "charter", detail) },
          )) ?? suggestion;
      }
      if ("reviewStatus" in (body ?? {})) {
        suggestion = setReviewStatus(suggestionId, body.reviewStatus as SuggestionReviewStatus) ?? suggestion;
      }
      if ("confirmPriority" in (body ?? {})) {
        suggestion = setConfirmPriority(suggestionId, body.confirmPriority as ConfirmPriority) ?? suggestion;
      }
      if (body?.moveFocus === "up" || body?.moveFocus === "down") {
        suggestion = moveFocusSuggestion(suggestionId, body.moveFocus) ?? suggestion;
      }
      if ("themeId" in (body ?? {})) {
        const themeId = typeof body.themeId === "string" && body.themeId ? body.themeId : null;
        suggestion = setSuggestionTheme(suggestionId, themeId) ?? suggestion;
      }
      if ("teamId" in (body ?? {})) {
        const teamId = typeof body.teamId === "string" && body.teamId ? body.teamId : null;
        suggestion = setSuggestionTeam(suggestionId, teamId) ?? suggestion;
      }
      if ("archived" in (body ?? {})) {
        suggestion = (body.archived ? archiveSuggestion(suggestionId) : unarchiveSuggestion(suggestionId)) ?? suggestion;
      }
      if ("reviewDueAt" in (body ?? {})) {
        suggestion = setSuggestionReviewDueAt(suggestionId, typeof body.reviewDueAt === "number" ? body.reviewDueAt : null) ?? suggestion;
      }
      // AI由来のsetSuggestionDetailと
      // 違い、EMの自由記述なのでensureNameCandidatesAllowed／maskForStorageを通す
      // （updateSuggestionDetail内部で実施）。未指定のフィールドは現在値を保持する部分更新
      if ("detail" in (body ?? {})) {
        const d = body.detail as { conclusion?: string; facts?: string[]; logic?: string; advice?: string };
        suggestion =
          (await updateSuggestionDetail(
            suggestionId,
            {
              ...(d.conclusion !== undefined ? { conclusion: d.conclusion } : {}),
              ...(d.facts !== undefined ? { facts: d.facts } : {}),
              ...(d.logic !== undefined ? { logic: d.logic } : {}),
              ...(d.advice !== undefined ? { advice: d.advice } : {}),
            },
            opts,
          )) ?? suggestion;
      }
      // 判断・提案（Agent）の内容が起票時から変わった場合に、EMが明示して詳細を更新し直す
      if (typeof body?.refreshDetailFromRunId === "string" && body.refreshDetailFromRunId.trim()) {
        const run = getRun(body.refreshDetailFromRunId.trim());
        if (!run || !run.proposal) {
          return c.json({ error: "指定されたAgent Runに判断・提案がありません" }, 400);
        }
        suggestion =
          setSuggestionDetail(suggestionId, {
            conclusion: run.proposal.conclusion,
            facts: run.proposal.facts,
            logic: run.proposal.logic,
            ...(run.proposal.expansions?.length ? { expansions: run.proposal.expansions } : {}),
            ...(run.proposal.challenges?.length ? { challenges: run.proposal.challenges } : {}),
            ...adviceFieldsFromProposal(run.proposal),
          }) ?? suggestion;
      }

      const resBody = { suggestion: toSuggestionView(suggestion) } satisfies SuggestionMutationResponse;
      return c.json(resBody);
    } catch (err) {
      // updateSuggestionDetailの「結論と判断ロジックは必須です」等、入力起因のエラーは
      // 4xxとして返す（jsonFromUnknownErrorはUnconfirmedNameCandidatesErrorなら409、
      // それ以外はここで渡すfallbackStatusを使う）。
      return jsonFromUnknownError(err, 400);
    }
  })
  .post("/:id/memo", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    const text = typeof body?.text === "string" ? body.text.trim() : "";

    if (!text) {
      return c.json({ error: "textは必須です" }, 400);
    }

    const exact = getSuggestion(id);
    const resolved = exact ? ({ status: "exact" as const, item: exact } as const) : resolveSuggestionForRead(id);
    if (resolved.status !== "exact" && resolved.status !== "unique") {
      return c.json({ error: "not found" }, 404);
    }

    try {
      const suggestion = await addMemo(resolved.item.id, text, {
        ...maskOptionsFromBody(body),
        source: "user",
        onUpdated: (sid, _trigger, detail) => reactToSuggestionUpdate(sid, "log", detail),
      });
      if (!suggestion) {
        return c.json({ error: "not found" }, 404);
      }
      const resBody = { suggestion: toSuggestionView(suggestion) } satisfies SuggestionMutationResponse;
      return c.json(resBody, 201);
    } catch (err) {
      return jsonFromUnknownError(err);
    }
  });
