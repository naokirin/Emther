"use client";

import { useState } from "react";
import styles from "@/app/page.module.css";
import { HelpLink } from "@/components/HelpLink";
import type { Issue } from "@/lib/types";
import type { FetchWithNameConfirm, RetryableError } from "./types";

type Props = {
  issue: Issue;
  refreshIssue: () => Promise<void>;
  refreshRuns: () => Promise<void>;
  fetchWithNameConfirm: FetchWithNameConfirm;
};

// ユーザー依頼「EMがIssueに対して考えたこと・取ったアクション・結果を反映する」対応。
// Action Items（やる/やった）とは別に、進行中いつでも書き足せる自由記述の経過ログ。
// 種別（考えたこと／アクション／結果）は分けず、EMが自由に書く。
export function IssueLogSection({ issue, refreshIssue, refreshRuns, fetchWithNameConfirm }: Props) {
  const [logText, setLogText] = useState("");
  const [logPending, setLogPending] = useState(false);
  const [logPendingError, setLogPendingError] = useState<RetryableError | null>(null);

  // Action Itemsと同じ「1件ずつ即追記」の作りだが、done等の状態は持たない自由記述ログ。
  // ローカルNER込みの保存は完了を待たず、入力欄を空けて裏で処理する。
  async function sendLogPatch(text: string, retry: () => void) {
    setLogPending(true);
    setLogPendingError(null);
    try {
      const { res, data } = await fetchWithNameConfirm(
        `/api/issues/${issue.id}/log`,
        { method: "POST", body: { text } },
        "保存する",
      );
      if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? "記録に失敗しました");
      await Promise.all([refreshIssue(), refreshRuns()]);
    } catch (err) {
      if ((err as Error).message !== "人名候補の確認をキャンセルしました") {
        setLogPendingError({ message: (err as Error).message, retry });
      }
    } finally {
      setLogPending(false);
    }
  }

  function handleAddLogEntry() {
    if (!logText.trim() || logPending) return;
    const text = logText.trim();
    setLogText("");
    const retry = () => {
      void sendLogPatch(text, retry);
    };
    void sendLogPatch(text, retry);
  }

  return (
    <div className={styles.panel}>
      <div className={styles.pageTitleWithHelp} style={{ marginBottom: 10 }}>
        <h2 style={{ margin: 0 }}>経過ログ</h2>
        <HelpLink anchor="issues" />
      </div>
      <div className={styles.journalInputRow}>
        <textarea
          value={logText}
          onChange={(e) => setLogText(e.target.value)}
          rows={3}
          placeholder="考えたこと・アクション・結果をひとこと（例: 割り込み受付を14〜15時に限定で合意）"
          disabled={logPending}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing && e.keyCode !== 229) {
              e.preventDefault();
              handleAddLogEntry();
            }
          }}
        />
        <button
          className={styles.primaryBtn}
          style={{ width: "auto" }}
          type="button"
          disabled={logPending || !logText.trim()}
          onClick={handleAddLogEntry}
        >
          記録
        </button>
      </div>
      {logPending && (
        <p className={styles.subtitle} style={{ marginTop: 8 }} role="status">
          <span className={styles.spinner} aria-hidden="true" />
          経過ログを保存中…
        </p>
      )}
      {logPendingError && (
        <div className={styles.tagRow} style={{ marginTop: 8 }}>
          <span className={styles.errorText} role="alert">
            ⚠️ 経過ログの保存に失敗しました: {logPendingError.message}
          </span>
          <button className={styles.btnOutline} onClick={logPendingError.retry}>
            再試行
          </button>
          <button className={styles.btnOutline} onClick={() => setLogPendingError(null)}>
            閉じる
          </button>
        </div>
      )}
      {issue.logEntries.length === 0 ? (
        <p className={styles.subtitle} style={{ marginTop: 10 }}>
          まだ記録がありません。
        </p>
      ) : (
        <ul style={{ listStyle: "none", marginTop: 10 }}>
          {[...issue.logEntries].reverse().map((entry) => (
            <li key={entry.id} className={styles.field} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: "0.8125rem" }}>{entry.text}</div>
              <div className={styles.subtitle}>{new Date(entry.createdAt).toLocaleString("ja-JP")}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
