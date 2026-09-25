// Goalに向かう際に守りたい判断原則。OrgBackgroundEntryに近い自由記述リスト。

export type PolicyCategory = "value" | "priority" | "avoid" | "principle" | "other";

export type PolicyEntry = {
  id: string;
  text: string;
  /** 補足（解釈を閉じる説明・任意） */
  elaboration?: string;
  category?: PolicyCategory;
  /** 一覧の手動並び順（昇順）。 */
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
  archivedAt?: number;
};

export type NewPolicyInput = {
  text: string;
  elaboration?: string;
  category?: PolicyCategory;
};
