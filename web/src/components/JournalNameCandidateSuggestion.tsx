"use client";

import { useState } from "react";
import styles from "@/app/page.module.css";

// docs/memo.md「Journal入力時に自動で関係者名も設定してほしい」対応。既登録の人物名は
// 保存時に自動でJournalEntry.peopleへ紐付くが、未登録の人物名は「事前登録が正」の方針上
// 保存をブロックしてまで確認しない（誤登録対策）。代わりに、投稿直後だけ「人名らしいが
// 未登録」の語句をヒントとして出し、1クリックで関係者として登録・紐付けできるようにする。
// 保存はしない一度きりのヒントなので、ポーリングで一覧が更新されると消える
// （呼び出し側のローカルstateで保持する）。
// UIはHierarchyLinkSuggestPanelと同系の枠付き提案ブロックに揃え、detailToggleButton単体
// （負のmargin-left付き）のチップ並びで余白が崩れるのを避ける。
export function JournalNameCandidateSuggestion({
  entryId,
  people,
  candidates,
  onLinked,
}: {
  entryId: string;
  people: string[];
  candidates: string[];
  onLinked?: (name: string) => void;
}) {
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const visible = candidates.filter((c) => !dismissed.has(c));
  if (visible.length === 0) return null;

  async function handleAdd(name: string) {
    setSubmitting(name);
    setError(null);
    try {
      const res = await fetch(`/api/journal/${entryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ people: [...people, name] }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? "登録に失敗しました");
      setDismissed((prev) => new Set(prev).add(name));
      onLinked?.(name);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <div
      style={{
        marginTop: 12,
        padding: 10,
        border: "1px solid var(--border)",
        borderRadius: 8,
        fontSize: "0.875rem",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
        <strong>人名らしい語句が見つかりました</strong>
        <button
          type="button"
          className={styles.detailToggle}
          onClick={() => setDismissed(new Set(candidates))}
        >
          無視する
        </button>
      </div>
      <p className={styles.subtitle} style={{ margin: "4px 0 8px" }}>
        クリックで関係者として登録・紐付けします（名簿に無い名前の追加ヒント）
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        {visible.map((name) => (
          <button
            key={name}
            type="button"
            className={`${styles.btnOutline} ${styles.axisTooltip}`}
            style={{ fontSize: "0.75rem" }}
            disabled={submitting === name}
            onClick={() => void handleAdd(name)}
            data-tooltip={`「${name}」を関係者として登録する`}
          >
            {submitting === name ? `${name} 登録中…` : `＋ ${name}`}
          </button>
        ))}
      </div>
      {error && (
        <p className={styles.errorText} role="alert" style={{ margin: "8px 0 0" }}>
          {error}
        </p>
      )}
    </div>
  );
}
