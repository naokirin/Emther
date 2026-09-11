"use client";

import { createContext, useCallback, useContext, useState, type MouseEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/Modal";
import { goHrefForIdFragment } from "@/lib/id-prefix";
import type { IdMatch, IdMatchKind } from "@/lib/id-resolve";
import styles from "@/app/page.module.css";

const KIND_LABEL: Record<IdMatchKind, string> = {
  issue: "Issue",
  journal: "Journal",
  run: "相談 / Agent Run",
};

type IdResolveContextValue = {
  /** サイドピーク内なら Issue をピークで開き直す。未指定時は通常のページ遷移。 */
  openIssueInPeek?: (id: string) => void;
};

const IdResolveContext = createContext<IdResolveContextValue>({});

export function IdResolveProvider({
  openIssueInPeek,
  children,
}: {
  openIssueInPeek?: (id: string) => void;
  children: ReactNode;
}) {
  return <IdResolveContext.Provider value={{ openIssueInPeek }}>{children}</IdResolveContext.Provider>;
}

function useIdResolveNav() {
  const router = useRouter();
  const { openIssueInPeek } = useContext(IdResolveContext);

  return useCallback(
    (match: IdMatch) => {
      if (match.kind === "issue" && openIssueInPeek) {
        openIssueInPeek(match.id);
        return;
      }
      router.push(match.href);
    },
    [openIssueInPeek, router],
  );
}

/** `/go/<fragment>` 相当。クリック時は API で解決し、サイドピーク内なら Issue をピークで開く。 */
export function IdFragmentLink({
  fragment,
  children,
  className,
}: {
  fragment: string;
  children: ReactNode;
  className?: string;
}) {
  const navigate = useIdResolveNav();
  const [busy, setBusy] = useState(false);
  const [candidates, setCandidates] = useState<IdMatch[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleClick(e: MouseEvent<HTMLAnchorElement>) {
    // 新しいタブ／ウィンドウや修飾キーはそのまま /go へ（サーバー解決）
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/id-resolve?q=${encodeURIComponent(fragment)}`);
      const data = (await res.json()) as { matches?: IdMatch[] };
      const matches = data.matches ?? [];
      if (matches.length === 1) {
        navigate(matches[0]);
        return;
      }
      if (matches.length > 1) {
        setCandidates(matches);
        return;
      }
      setError(`「${fragment}」に一致する Issue / Journal / 相談はありませんでした。`);
    } catch {
      setError("IDの解決に失敗しました。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <a href={goHrefForIdFragment(fragment)} className={className} onClick={handleClick}>
        {children}
      </a>
      {candidates && (
        <Modal title="候補が複数あります" onClose={() => setCandidates(null)}>
          <p className={styles.subtitle} style={{ marginBottom: 12 }}>
            プレフィックス <code>{fragment}</code> に一致する項目が {candidates.length} 件あります。
          </p>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {candidates.map((m) => (
              <li
                key={`${m.kind}:${m.id}`}
                style={{
                  marginBottom: 8,
                  padding: "8px 10px",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                }}
              >
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: 4 }}>
                  {KIND_LABEL[m.kind]} · <code>{m.id.slice(0, 8)}</code>
                </div>
                <button
                  type="button"
                  className={styles.tableRowLink}
                  style={{ display: "inline", width: "auto" }}
                  onClick={() => {
                    setCandidates(null);
                    navigate(m);
                  }}
                >
                  {m.label}
                </button>
              </li>
            ))}
          </ul>
        </Modal>
      )}
      {error && (
        <Modal title="一致する項目がありません" onClose={() => setError(null)}>
          <p className={styles.subtitle}>{error}</p>
          <button type="button" className={styles.primaryBtn} style={{ width: "auto", marginTop: 12 }} onClick={() => setError(null)}>
            閉じる
          </button>
        </Modal>
      )}
    </>
  );
}
