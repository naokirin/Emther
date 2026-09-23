import { randomUUID } from "node:crypto";
import { loadJSON, saveJSON } from "../persistence";
import { recordChangeEvent } from "../knowledge-store";
import { maskForStorage, unmaskNames } from "../people-directory";

// docs/goal_policy_model.md / docs/goal_policy_model_plan.md Decision 2。
// Goalに向かう際に守りたい判断原則（大切にすること／優先すること／やらないこと／
// 判断に迷ったときの原則、など）。MVV（OrgStrategy）のような固定欄にはせず、
// OrgBackgroundEntryに近い「1件ずつ追加できる自由記述リスト」にする。
// categoryは分類のヒントであり、必須の構造ではない（方針4「入力項目を埋めることを
// 目的にしない」に合わせ、未設定を許容する）。
export type PolicyCategory = "value" | "priority" | "avoid" | "principle" | "other";

export type PolicyEntry = {
  id: string;
  text: string;
  /** 補足（解釈を閉じる説明・任意） */
  elaboration?: string;
  category?: PolicyCategory;
  createdAt: number;
  updatedAt: number;
  archivedAt?: number;
};

export type NewPolicyInput = {
  text: string;
  elaboration?: string;
  category?: PolicyCategory;
};

function normalizeCategory(value: unknown): PolicyCategory | undefined {
  return value === "value" || value === "priority" || value === "avoid" || value === "principle" || value === "other"
    ? value
    : undefined;
}

const policies: PolicyEntry[] = loadJSON<PolicyEntry[]>("policies.json", []);

function persist(): void {
  saveJSON("policies.json", policies);
}

export function listPolicies(): PolicyEntry[] {
  return [...policies].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function listActivePolicies(): PolicyEntry[] {
  return listPolicies().filter((p) => !p.archivedAt);
}

export function getPolicy(id: string): PolicyEntry | undefined {
  return policies.find((p) => p.id === id);
}

export async function addPolicy(input: NewPolicyInput): Promise<PolicyEntry> {
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

export async function updatePolicy(
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

export function removePolicy(id: string): boolean {
  const idx = policies.findIndex((p) => p.id === id);
  if (idx === -1) return false;
  const entry = policies[idx];
  policies.splice(idx, 1);
  persist();
  recordChangeEvent("org", entry.id, `Policyを削除しました: 「${entry.text}」`);
  return true;
}

export function toPolicyView(entry: PolicyEntry): PolicyEntry {
  return {
    ...entry,
    text: unmaskNames(entry.text),
    ...(entry.elaboration !== undefined ? { elaboration: unmaskNames(entry.elaboration) } : {}),
  };
}
