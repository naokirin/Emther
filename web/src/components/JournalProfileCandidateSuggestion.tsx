"use client";

import { useState } from "react";
import styles from "@/app/page.module.css";

// docs/memo.md「JournalのAIでの分析結果として、メンバーの長期プロファイルに入れるほうが
// 良いものがあれば、入れるようにする」対応。JournalNameCandidateSuggestionと同じ考え方:
// ローカル抽出の候補は保存をブロックせず、投稿直後だけ1クリックで長期プロファイル
// （POST /api/knowledge/interpretations、人物詳細の「長期プロファイル」と同じ実体）へ
// 採用できるヒントを出す。保存しない一度きりのヒントなので、ポーリングで一覧が
// 更新されると消える（呼び出し側のローカルstateで保持する）。
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
    <p className={styles.subtitle} style={{ margin: "6px 0 0", display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
      💡 長期プロファイル候補: 「{text}」
      <button
        type="button"
        className={`${styles.detailToggleButton} ${styles.axisTooltip}`}
        disabled={status === "submitting"}
        onClick={() => void handleAdopt()}
        data-tooltip={`${person}の長期プロファイルに追加する`}
      >
        {status === "submitting" ? "記録中…" : `＋ ${person}のプロファイルに追加`}
      </button>
      <button type="button" className={styles.detailToggleButton} onClick={() => setStatus("dismissed")}>
        無視する
      </button>
      {error && <span className={styles.errorText}>{error}</span>}
    </p>
  );
}
