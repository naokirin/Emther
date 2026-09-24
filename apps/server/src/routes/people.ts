import { Hono } from "hono";
import type {
  OkResponse,
  PeopleResponse,
  PersonConcernAckResponse,
  PersonEvaluationLogMutationResponse,
  PersonEvaluationLogsResponse,
  PersonMutationResponse,
  PersonProfileResponse,
} from "@emther/api-contract";
import type { PersonProfile } from "@emther/core/types";
import { deletePerson, registerName, renamePerson, setPersonArchived, listPeople } from "@emther/core/people-directory";
import { addPersonAlias, getPersonProfile, listPersonSummaries, mergePersons, removePersonAlias } from "@emther/core/people-hub";
import { reassignSelfPersonId } from "@emther/core/settings-store";
import { acknowledgePersonSuggestionConcern, clearPersonSuggestionConcernAck } from "@emther/core/person-concern-ack-store";
import {
  bundleEvaluationLogs,
  clearEvaluationLogNoActionNeeded,
  getEvaluationLog,
  listEvaluationLogsForPerson,
  setEvaluationLogNoActionNeeded,
  setEvaluationLogStatus,
  suggestEvaluationLogsFromRecentJournals,
  toEvaluationLogView,
  type EvaluationLens,
  type EvaluationLogStatus,
} from "@emther/core/person-evaluation-store";

// docs/2nd_architecture/plan.md フェーズ2.5:
// web/src/app/api/people/{route,[id]/route,[id]/merge/route,
// [id]/concern-acks/[suggestionId]/route,[id]/evaluation-logs/route,
// [id]/evaluation-logs/[logId]/route}.ts の移植。

function parseAliases(body: Record<string, unknown> | null): string[] {
  if (!body) return [];
  if (Array.isArray(body.aliases)) {
    return [
      ...new Set(
        body.aliases
          .filter((a): a is string => typeof a === "string")
          .map((a) => a.trim())
          .filter(Boolean),
      ),
    ];
  }
  if (typeof body.alias === "string" && body.alias.trim()) {
    return [body.alias.trim()];
  }
  return [];
}

export const peopleRoute = new Hono()
  // docs/memo.md「J. Peopleを第一級ハブに」対応。
  .get("/", (c) => {
    const body = { people: listPersonSummaries() } satisfies PeopleResponse;
    return c.json(body);
  })
  // People画面・ヘッダーのクイック追加からの直接登録。チーム非所属の人物も明示的に
  // 追加できるようにする。aliases があれば同じ人物へ別名として足す（既存人物の再登録時も可）。
  .post("/", async (c) => {
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name) {
      return c.json({ error: "nameは必須です" }, 400);
    }

    const id = registerName(name);
    const aliases = parseAliases(body);
    for (const alias of aliases) {
      addPersonAlias(id, alias);
    }
    // getPersonProfile はここまでの registerName/addPersonAlias 直後は常にヒットする想定。
    // listPersonSummaries のフォールバックはPersonSummary止まりでPersonProfileの必須フィールド
    // （facts等）を持たないため、実行時の挙動は変えずに型だけPersonProfileに合わせる。
    const person = (getPersonProfile(id) ?? listPersonSummaries().find((p) => p.id === id)) as PersonProfile | undefined;
    if (!person) {
      return c.json({ error: "登録に失敗しました" }, 500);
    }
    const resBody = { person } satisfies PersonMutationResponse;
    return c.json(resBody, 201);
  })
  .get("/:id", (c) => {
    const profile = getPersonProfile(c.req.param("id"));
    if (!profile) {
      return c.json({ error: "not found" }, 404);
    }
    const body = { person: profile } satisfies PersonProfileResponse;
    return c.json(body);
  })
  // ユーザー要望「メンバーの表記揺れに対応できる仕組みが欲しい」対応。addAlias/removeAlias
  // はどちらか一方を指定する想定（両方来た場合はaddAliasを先に処理する）。
  .patch("/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    const addAliasName = typeof body?.addAlias === "string" ? body.addAlias : undefined;
    const removeAliasName = typeof body?.removeAlias === "string" ? body.removeAlias : undefined;
    const newName = typeof body?.name === "string" ? body.name : undefined;

    if (newName !== undefined) {
      const result = renamePerson(id, newName);
      if (!result.ok) return c.json({ error: result.error }, 400);
    } else if (addAliasName !== undefined) {
      const result = addPersonAlias(id, addAliasName);
      if (!result.ok) return c.json({ error: result.error }, 400);
    } else if (removeAliasName !== undefined) {
      const removed = removePersonAlias(id, removeAliasName);
      if (!removed) return c.json({ error: "指定された別名が見つかりません" }, 400);
    } else {
      return c.json({ error: "name、addAlias、removeAliasのいずれかが必要です" }, 400);
    }

    const profile = getPersonProfile(id);
    if (!profile) return c.json({ error: "not found" }, 404);
    const resBody = { person: profile } satisfies PersonMutationResponse;
    return c.json(resBody);
  })
  // docs/em_human_story_and_ux.md P2-12対応。ローカルNERの誤登録をEMが確認・削除できる
  // ようにする「最後の安全弁」。
  .delete("/:id", (c) => {
    const id = c.req.param("id");
    const removed = deletePerson(id);
    if (!removed) {
      return c.json({ error: "not found" }, 404);
    }
    // 利用者本人として紐付いていた場合は解除する（幽霊IDを残さない）。
    reassignSelfPersonId({ deletedId: id });
    const resBody = { ok: true } satisfies OkResponse;
    return c.json(resBody);
  })
  // ユーザー要望「誤って複数登録されてしまったメンバーを統合する機能が欲しい」対応。
  // URLの:idが統合先（残る側）、body.duplicateIdが統合元（消える側）。People詳細画面で
  // 開いている人物へ、検索して選んだ別の人物を統合する、というUIの向きに合わせている。
  .post("/:id/merge", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    const duplicateId = typeof body?.duplicateId === "string" ? body.duplicateId : "";
    if (!duplicateId) {
      return c.json({ error: "duplicateIdは必須です" }, 400);
    }

    const result = mergePersons(duplicateId, id);
    if (!result.ok) return c.json({ error: result.error }, 400);

    const profile = getPersonProfile(id);
    if (!profile) return c.json({ error: "not found" }, 404);
    const resBody = { person: profile } satisfies PersonMutationResponse;
    return c.json(resBody);
  })
  // 退職等。誤登録削除（DELETE）とは別。一覧の既定表示・1on1 Coverage等から外すが、
  // 名簿・マスク対象には残す（過去Journalの実名復元のため）。
  .post("/:id/archive", async (c) => {
    const id = c.req.param("id");
    const current = listPeople().find((p) => p.id === id);
    if (!current) {
      return c.json({ error: "not found" }, 404);
    }
    const body = await c.req.json().catch(() => null);
    const archived = typeof body?.archived === "boolean" ? body.archived : !current.archived;
    const updated = setPersonArchived(id, archived);
    if (!updated) {
      return c.json({ error: "not found" }, 404);
    }
    const profile = getPersonProfile(id);
    if (!profile) return c.json({ error: "not found" }, 404);
    const resBody = { person: profile } satisfies PersonMutationResponse;
    return c.json(resBody);
  })
  // ユーザー指摘「メンバーのアラート表示（関連提案の停滞・確認保留）を確認したが
  // 対応不要だった、を示せず強調を減らせない」対応。提案自体の状態（停滞・確認保留）は
  // 書き換えず、「この人物にとってこの提案は対応不要と確認済み」という人物×提案単位の
  // 判断だけを記録する。
  .patch("/:id/concern-acks/:suggestionId", async (c) => {
    const id = c.req.param("id");
    const suggestionId = c.req.param("suggestionId");
    const profile = getPersonProfile(id);
    if (!profile) return c.json({ error: "not found" }, 404);

    const body = await c.req.json().catch(() => null);
    if (body?.acknowledged === true) {
      const note = typeof body?.note === "string" ? body.note : undefined;
      const ack = await acknowledgePersonSuggestionConcern(profile.id, suggestionId, note);
      const resBody = { ack } satisfies PersonConcernAckResponse;
      return c.json(resBody);
    }
    if (body?.acknowledged === false) {
      clearPersonSuggestionConcernAck(profile.id, suggestionId);
      const resBody = { ok: true } satisfies OkResponse;
      return c.json(resBody);
    }
    return c.json({ error: "acknowledged（true/false）を指定してください" }, 400);
  })
  .get("/:id/evaluation-logs", (c) => {
    const id = c.req.param("id");
    const profile = getPersonProfile(id);
    if (!profile) return c.json({ error: "not found" }, 404);

    const lens = c.req.query("lens") as EvaluationLens | undefined;
    const status = c.req.query("status") as EvaluationLogStatus | undefined;
    const since = c.req.query("since");
    const until = c.req.query("until");
    const bundle = c.req.query("bundle") === "1";

    if (bundle) {
      const result = bundleEvaluationLogs(id, {
        since: since ? Number(since) : undefined,
        until: until ? Number(until) : undefined,
      });
      return c.json({
        outcome: result.outcome.map(toEvaluationLogView),
        value: result.value.map(toEvaluationLogView),
        missing: result.missing,
      });
    }

    const logs = listEvaluationLogsForPerson(id, {
      lens: lens === "outcome" || lens === "value" ? lens : undefined,
      status: status === "provisional" || status === "confirmed" || status === "discarded" ? status : undefined,
      since: since ? Number(since) : undefined,
      until: until ? Number(until) : undefined,
    });
    const body = { logs: logs.map(toEvaluationLogView) } satisfies PersonEvaluationLogsResponse;
    return c.json(body);
  })
  .post("/:id/evaluation-logs", async (c) => {
    const id = c.req.param("id");
    const profile = getPersonProfile(id);
    if (!profile) return c.json({ error: "not found" }, 404);

    const body = await c.req.json().catch(() => ({}));
    if (body?.action === "suggest-from-journal") {
      const created = await suggestEvaluationLogsFromRecentJournals(id, profile.name);
      const resBody = { logs: created.map(toEvaluationLogView) } satisfies PersonEvaluationLogsResponse;
      return c.json(resBody, 201);
    }

    return c.json({ error: "action は suggest-from-journal です" }, 400);
  })
  // ユーザー指摘「懸念を確認したが対応不要だった、を示せず強調を減らせない」対応。
  // status（provisional/confirmed/discarded）とは独立に、polarity: concernの強調だけを
  // 弱める noActionNeeded を持たせる。bodyにどちらか一方だけでも、両方でも指定できる。
  .patch("/:id/evaluation-logs/:logId", async (c) => {
    const logId = c.req.param("logId");
    const body = await c.req.json().catch(() => null);
    const existing = getEvaluationLog(logId);
    if (!existing) return c.json({ error: "not found" }, 404);

    if (body?.status === undefined && body?.noActionNeeded === undefined) {
      return c.json({ error: "status または noActionNeeded のいずれかを指定してください" }, 400);
    }

    if (body?.status !== undefined) {
      const status = body.status as EvaluationLogStatus;
      if (status !== "provisional" && status !== "confirmed" && status !== "discarded") {
        return c.json({ error: "status は provisional / confirmed / discarded です" }, 400);
      }
      setEvaluationLogStatus(logId, status);
    }

    if (body?.noActionNeeded === true) {
      const note = typeof body?.noActionNeededNote === "string" ? body.noActionNeededNote : undefined;
      await setEvaluationLogNoActionNeeded(logId, note);
    } else if (body?.noActionNeeded === false) {
      clearEvaluationLogNoActionNeeded(logId);
    }

    const updated = getEvaluationLog(logId);
    const resBody = { log: toEvaluationLogView(updated!) } satisfies PersonEvaluationLogMutationResponse;
    return c.json(resBody);
  });
