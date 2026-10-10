import { randomUUID } from "node:crypto";
import { maskForStorage, unmaskNames } from "../people-directory";
import { containsEvaluativeAttribute, WorldModelValidationError, type createWorldModelService } from "./world-model-domain";
import type { WorldModelUpdateRepository } from "./world-model-update-repository";
import type {
  SuggestedWorldModelChange,
  WorldModelIngestResult,
  WorldModelUpdate,
  WorldModelUpdateStatus,
} from "./world-model-update-types";
import type { WorldModelElement, WorldModelEvidence } from "./world-model-types";

const MAX_NEW_PER_RUN = 5;
const MAX_UPDATES_PER_RUN = 10;
const TARGETABLE = new Set(["adopted", "pinned", "stale"]);

type ModelService = ReturnType<typeof createWorldModelService>;

function normalizeEvidence(e: Partial<WorldModelEvidence> | undefined): WorldModelEvidence {
  const ids = (xs: string[] | undefined) => Array.from(new Set((xs ?? []).filter(Boolean)));
  return {
    eventIds: ids(e?.eventIds),
    journalIds: ids(e?.journalIds),
    suggestionIds: ids(e?.suggestionIds),
    themeIds: ids(e?.themeIds),
  };
}

export function createWorldModelUpdateService(repo: WorldModelUpdateRepository, model: ModelService) {
  const updates = repo.load();

  function persist(): void {
    repo.save(updates);
  }

  function list(filter?: { status?: WorldModelUpdateStatus }): WorldModelUpdate[] {
    return updates
      .filter((u) => !filter?.status || u.status === filter.status)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  function toView(u: WorldModelUpdate): WorldModelUpdate {
    return {
      ...u,
      reason: unmaskNames(u.reason),
      statement: u.statement !== undefined ? unmaskNames(u.statement) : undefined,
    };
  }

  // 不正な項目は例外にせず skipped として数える（1件の不正で差分全体を失わない）。
  async function ingest(
    changes: SuggestedWorldModelChange[],
    opts: { sourceRunId?: string } = {},
  ): Promise<WorldModelIngestResult> {
    const result: WorldModelIngestResult = { created: 0, proposals: 0, skipped: 0 };
    for (const change of changes) {
      const reason = change.reason.trim();
      if (!reason) {
        result.skipped++;
        continue;
      }
      if (change.action === "new") {
        if (result.created >= MAX_NEW_PER_RUN || !change.kind || !change.title || !change.statement) {
          result.skipped++;
          continue;
        }
        try {
          await model.create({
            kind: change.kind,
            title: change.title,
            statement: change.statement,
            teamIds: change.teamIds,
            personIds: change.personIds,
            relationship: change.relationship,
            evidence: change.evidence,
            confidence: change.confidence,
            origin: "ai",
            status: "candidate",
            sourceRunId: opts.sourceRunId,
          });
          result.created++;
        } catch (err) {
          if (!(err instanceof WorldModelValidationError)) throw err;
          result.skipped++;
        }
        continue;
      }

      const target = change.targetId ? model.get(change.targetId) : undefined;
      const text = `${reason}\n${change.statement ?? ""}`;
      const duplicate = updates.some(
        (u) => u.status === "pending" && u.targetId === change.targetId && u.action === change.action,
      );
      const needsStatement = change.action === "refine" && !change.statement?.trim();
      if (
        result.proposals >= MAX_UPDATES_PER_RUN ||
        !target ||
        !TARGETABLE.has(target.status) ||
        duplicate ||
        needsStatement ||
        containsEvaluativeAttribute(text)
      ) {
        result.skipped++;
        continue;
      }
      updates.push({
        id: randomUUID(),
        targetId: target.id,
        action: change.action,
        reason: await maskForStorage(reason),
        statement: change.statement?.trim() ? await maskForStorage(change.statement.trim()) : undefined,
        evidence: normalizeEvidence(change.evidence),
        status: "pending",
        sourceRunId: opts.sourceRunId,
        createdAt: Date.now(),
      });
      result.proposals++;
    }
    if (result.proposals > 0) persist();
    return result;
  }

  function resolve(u: WorldModelUpdate, status: WorldModelUpdateStatus): void {
    u.status = status;
    u.resolvedAt = Date.now();
  }

  // 訂正を伴う適用は旧版を置き換えるため、同じ対象の他の pending は参照先を失う。
  async function apply(
    id: string,
  ): Promise<{ update: WorldModelUpdate; element?: WorldModelElement } | undefined> {
    const u = updates.find((x) => x.id === id);
    if (!u || u.status !== "pending") return undefined;
    const target = model.get(u.targetId);
    if (!target) return undefined;

    let element: WorldModelElement | undefined;
    if (u.action === "confirm") {
      model.addEvidence(target.id, u.evidence);
      element = model.confirm(target.id);
    } else if (u.statement && (u.action === "refine" || u.action === "contradict")) {
      element = await model.revise(target.id, { statement: unmaskNames(u.statement) });
      if (element) {
        model.addEvidence(element.id, u.evidence);
        for (const other of updates) {
          if (other.id !== u.id && other.status === "pending" && other.targetId === target.id) {
            resolve(other, "dismissed");
          }
        }
      }
    } else {
      model.addEvidence(target.id, u.evidence);
      element = model.markStale(target.id);
    }
    if (!element) return undefined;
    resolve(u, "applied");
    persist();
    return { update: u, element };
  }

  function dismiss(id: string): WorldModelUpdate | undefined {
    const u = updates.find((x) => x.id === id);
    if (!u || u.status !== "pending") return undefined;
    resolve(u, "dismissed");
    persist();
    return u;
  }

  return { list, toView, ingest, apply, dismiss };
}
