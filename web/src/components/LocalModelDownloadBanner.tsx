"use client";

import { useEffect, useState } from "react";
import styles from "@/app/page.module.css";
import type { ModelLoadSnapshot } from "@/lib/model-loader";

const EMPTY: ModelLoadSnapshot = {
  overall: "idle",
  models: [],
};

function formatBytes(n: number | null): string | null {
  if (n === null || !Number.isFinite(n) || n < 0) return null;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function shouldShowBanner(snap: ModelLoadSnapshot): boolean {
  if (snap.overall === "idle" || snap.overall === "ready") return false;
  // キャッシュ済みで即 ready になる場合は出さない。checking/downloading/error のみ。
  return true;
}

// 未キャッシュのローカルモデルがあるときだけ表示する全画面共通バナー。
// layout からマウントし、/api/models/status をポーリングして進捗を出す。
export function LocalModelDownloadBanner() {
  const [snap, setSnap] = useState<ModelLoadSnapshot>(EMPTY);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch("/api/models/status");
        const json = (await res.json()) as ModelLoadSnapshot;
        if (!cancelled) setSnap(json);
      } catch {
        // 次回ポーリングに任せる
      }
    }

    void poll();
    const interval = setInterval(() => {
      void poll();
    }, 800);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  async function handleRetry() {
    setRetrying(true);
    try {
      const res = await fetch("/api/models/status", { method: "POST" });
      const json = (await res.json()) as ModelLoadSnapshot;
      setSnap(json);
    } catch {
      // 次回ポーリングに任せる
    } finally {
      setRetrying(false);
    }
  }

  if (!shouldShowBanner(snap)) return null;

  const active = snap.models.filter((m) => m.phase === "downloading" || m.phase === "checking" || m.phase === "error");
  const title =
    snap.overall === "error"
      ? "ローカルモデルの取得に失敗しました"
      : snap.overall === "checking"
        ? "ローカルモデルを確認しています…"
        : "ローカルモデルをダウンロードしています…";

  return (
    <div className={styles.modelDownloadBanner} role="status" aria-live="polite">
      <div className={styles.modelDownloadBannerHead}>
        <strong>{title}</strong>
        <span className={styles.modelDownloadBannerNote}>
          機微情報は外部に送らず、このマシン内だけで使います。初回のみ数十秒かかることがあります。
        </span>
      </div>
      <ul className={styles.modelDownloadList}>
        {(active.length > 0 ? active : snap.models).map((m) => {
          const pct = Math.max(0, Math.min(100, Math.round(m.progress)));
          const loaded = formatBytes(m.loadedBytes);
          const total = formatBytes(m.totalBytes);
          const sizeLabel = loaded && total ? `${loaded} / ${total}` : null;
          return (
            <li key={m.key} className={styles.modelDownloadItem}>
              <div className={styles.modelDownloadItemMeta}>
                <span>
                  {m.label}
                  <span className={styles.modelDownloadModelId}>（{m.modelId}）</span>
                </span>
                <span className={styles.modelDownloadItemStatus}>
                  {m.phase === "error"
                    ? "失敗"
                    : m.phase === "checking"
                      ? "確認中"
                      : m.phase === "ready"
                        ? "完了"
                        : sizeLabel
                          ? `${pct}% · ${sizeLabel}`
                          : `${pct}%`}
                </span>
              </div>
              {m.phase !== "error" && m.phase !== "checking" && (
                <div
                  className={styles.progressBar}
                  role="progressbar"
                  aria-valuenow={pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${m.label}のダウンロード進捗`}
                >
                  <div className={styles.progressBarFill} style={{ width: `${pct}%` }} />
                </div>
              )}
              {m.error && <p className={styles.modelDownloadError}>{m.error}</p>}
            </li>
          );
        })}
      </ul>
      {snap.overall === "error" && (
        <div className={styles.modelDownloadActions}>
          <button type="button" className={styles.modelDownloadRetryBtn} onClick={() => void handleRetry()} disabled={retrying}>
            {retrying ? "再試行中…" : "再試行"}
          </button>
        </div>
      )}
    </div>
  );
}
