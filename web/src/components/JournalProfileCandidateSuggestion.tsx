"use client";

import { useState } from "react";
import styles from "@/app/page.module.css";

// docs/memo.md「JournalのAIでの分析結果として、メンバーの長期プロファイルに入れるほうが
// 良いものがあれば、入れるようにする」対応。JournalNameCandidateSuggestionと同じ考え方:
// ローカル抽出の候補は保存をブロックせず、投稿直後だけ1クリックで長期プロファイル
// （POST /api/knowledge/interpretations、人物詳細の「長期プロファイル」と同じ実体）へ
// 採用できるヒントを出す。保存しない一度きりのヒントなので、ポーリングで一覧が
// 更新されると消える（呼び出し側のローカルstateで保持する）。
// UIはJournalNameCandidateSuggestion / HierarchyLinkSuggestPanelと同系の枠付き提案ブロックに揃える。
export function JournalProfileCandidateSuggestion({
  person,
  text,
}: {
  person: string;
  text: string;
}) {
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "dismissed">("idle");
  const [error, setError] = useState<string | null>(null);

  if (status === "done" || status === "dismissed") return null;

  async function handleAdopt() {
    setStatus("submitting");
    setError(null);
    try {
      const res = await fetch("/api/knowledge/interpretations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ person, text }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? "記録に失敗しました");
      setStatus("done");
    } catch (err) {
      setError((err as Error).message);
      setStatus("idle");
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
        <strong>長期プロファイル候補</strong>
        <button type="button" className={styles.detailToggle} onClick={() => setStatus("dismissed")}>
          無視する
        </button>
      </div>
      <p className={styles.subtitle} style={{ margin: "4px 0 8px" }}>
        「{text}」
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        <button
          type="button"
          className={`${styles.btnOutline} ${styles.axisTooltip}`}
          style={{ fontSize: "0.75rem" }}
          disabled={status === "submitting"}
          onClick={() => void handleAdopt()}
          data-tooltip={`${person}の長期プロファイルに追加する`}
        >
          {status === "submitting" ? "記録中…" : `＋ ${person}のプロファイルに追加`}
        </button>
      </div>
      {error && (
        <p className={styles.errorText} role="alert" style={{ margin: "8px 0 0" }}>
          {error}
        </p>
      )}
    </div>
  );
}
