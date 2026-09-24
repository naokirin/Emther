import { randomUUID } from "node:crypto";
import { recordChangeEvent } from "../knowledge-store";
import { maskForStorage, unmaskNames } from "../people-directory";
import type { PolicyRepository } from "./policy-repository";
import type { NewPolicyInput, PolicyCategory, PolicyEntry } from "./policy-types";

function normalizeCategory(value: unknown): PolicyCategory | undefined {
  return value === "value" || value === "priority" || value === "avoid" || value === "principle" || value === "other"
    ? value
    : undefined;
}

export function createPolicyService(repo: PolicyRepository) {
  const policies: PolicyEntry[] = [...repo.load()];

  function persist(): void {
    repo.save(policies);
  }

  function listPolicies(): PolicyEntry[] {
    return [...policies].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  function listActivePolicies(): PolicyEntry[] {
    return listPolicies().filter((p) => !p.archivedAt);
  }

  function getPolicy(id: string): PolicyEntry | undefined {
    return policies.find((p) => p.id === id);
  }

  async function addPolicy(input: NewPolicyInput): Promise<PolicyEntry> {
    const text = input.text.trim();
    if (!text) {
      throw new Error("textは必須です");
    }
    const now = Date.now();
    const elaboration = input.elaboration?.trim();
    const entry: PolicyEntry = {
      id: randomUUID(),
      text: await maskForStorage(text),
      ...(elaboration ? { elaboration: await maskForStorage(elaboration) } : {}),
      category: normalizeCategory(input.category),
      createdAt: now,
      updatedAt: now,
    };
    policies.push(entry);
    persist();
    recordChangeEvent("org", entry.id, `Policyを作成: 「${entry.text}」`);
    return entry;
  }

  async function updatePolicy(
    id: string,
    patch: {
      text?: string;
      elaboration?: string | null;
      category?: PolicyCategory | null;
      archivedAt?: number | null;
    },
  ): Promise<PolicyEntry | undefined> {
    const entry = getPolicy(id);
    if (!entry) return undefined;
    const changes: string[] = [];

    if (patch.text !== undefined) {
      const next = await maskForStorage(patch.text.trim());
      if (next && next !== entry.text) {
        changes.push(`内容を更新しました: 「${entry.text}」→「${next}」`);
        entry.text = next;
      }
    }
    if (patch.elaboration !== undefined) {
      const next =
        patch.elaboration === null || !patch.elaboration.trim()
          ? undefined
          : await maskForStorage(patch.elaboration.trim());
      if (next !== entry.elaboration) {
        changes.push(next ? "補足を更新しました" : "補足を削除しました");
        if (next) entry.elaboration = next;
        else delete entry.elaboration;
      }
    }
    if (patch.category !== undefined) {
      const next = patch.category === null ? undefined : normalizeCategory(patch.category);
      if (next !== entry.category) {
        changes.push(next ? `カテゴリ: ${next}` : "カテゴリを解除しました");
        entry.category = next;
      }
    }
    if (patch.archivedAt !== undefined) {
      const next = patch.archivedAt === null ? undefined : Date.now();
      if (next !== entry.archivedAt) {
        changes.push(next ? "アーカイブしました" : "有効に戻しました");
        if (next) entry.archivedAt = next;
        else delete entry.archivedAt;
      }
    }

    if (changes.length === 0) return entry;
    entry.updatedAt = Date.now();
    persist();
    recordChangeEvent("org", entry.id, changes.join(" / "));
    return entry;
  }

  function removePolicy(id: string): boolean {
    const idx = policies.findIndex((p) => p.id === id);
    if (idx === -1) return false;
    const entry = policies[idx];
    policies.splice(idx, 1);
    persist();
    recordChangeEvent("org", entry.id, `Policyを削除しました: 「${entry.text}」`);
    return true;
  }

  function toPolicyView(entry: PolicyEntry): PolicyEntry {
    return {
      ...entry,
      text: unmaskNames(entry.text),
      ...(entry.elaboration !== undefined ? { elaboration: unmaskNames(entry.elaboration) } : {}),
    };
  }

  return {
    listPolicies,
    listActivePolicies,
    getPolicy,
    addPolicy,
    updatePolicy,
    removePolicy,
    toPolicyView,
  };
}

export type PolicyService = ReturnType<typeof createPolicyService>;
