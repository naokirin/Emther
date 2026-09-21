import { useCallback, useContext, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { IdResolveContext } from "./idResolveContext";
import { useNavigate } from "react-router";
import { Modal } from "./Modal";
import { goHrefForIdFragment } from "@emther/core/id-prefix";
import type { IdMatch, IdMatchKind } from "@emther/core/id-resolve";
import styles from "../styles/page.module.css";

const KIND_LABEL: Record<IdMatchKind, string> = {
  suggestion: "提案",
  journal: "Journal",
  run: "相談 / Agent Run",
};

export function IdResolveProvider({
  openSuggestionInPeek,
  suggestionPeekId,
  closeSuggestionPeek,
  children,
}: {
  openSuggestionInPeek?: (id: string) => void;
  suggestionPeekId?: string | null;
  closeSuggestionPeek?: () => void;
  children: ReactNode;
}) {
  return (
    <IdResolveContext.Provider value={{ openSuggestionInPeek, suggestionPeekId, closeSuggestionPeek }}>
      {children}
    </IdResolveContext.Provider>
  );
}

function useIdResolveNav() {
  const navigate = useNavigate();
  const { openSuggestionInPeek } = useContext(IdResolveContext);

  return useCallback(
    (match: IdMatch) => {
      if (match.kind === "suggestion" && openSuggestionInPeek) {
        openSuggestionInPeek(match.id);
        return;
      }
      navigate(match.href);
    },
    [openSuggestionInPeek, navigate],
  );
}

async function fetchIdMatches(fragment: string): Promise<IdMatch[]> {
  const res = await fetch(`/api/id-resolve?q=${encodeURIComponent(fragment)}`);
  const data = (await res.json()) as { matches?: IdMatch[] };
  return data.matches ?? [];
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

  // ユーザー指摘「提案やJournalのリンクに関して、カスタムUIのツールチップでタイトルだけ
  // 表示したい」対応。文中の#ID参照はこれまでID断片の文字列しか見えず、クリックして
  // 解決するまでリンク先の中身（提案・Journalのタイトル）が分からなかった。ネイティブ
  // titleではなく、既存の.axisTooltip（data-tooltip属性を読むCSSカスタムツールチップ）
  // に揃え、ホバー/フォーカス時にだけ/api/id-resolveへ問い合わせてタイトルを表示する
  // （クリック時と違い候補選択はしないため、複数候補があれば改行区切りで並べる）。
  // tooltipがnullの間は.axisTooltipクラス自体を付けない：CSSの::afterはmin-widthを
  // 持つため、data-tooltip未設定のままクラスだけ先に付けると、取得前に空の吹き出しの
  // 箱がhover時に一瞬見えてしまう。
  const [tooltip, setTooltip] = useState<string | null>(null);
  const tooltipFetchedRef = useRef(false);

  async function ensureTooltip() {
    if (tooltipFetchedRef.current) return;
    tooltipFetchedRef.current = true;
    setTooltip("読み込み中…");
    try {
      const matches = await fetchIdMatches(fragment);
      setTooltip(matches.length > 0 ? matches.map((m) => m.label).join("\n") : "該当する項目が見つかりませんでした");
    } catch {
      tooltipFetchedRef.current = false;
      setTooltip(null);
    }
  }

  async function handleClick(e: MouseEvent<HTMLAnchorElement>) {
    // 新しいタブ／ウィンドウや修飾キーはそのまま /go へ（サーバー解決）
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const matches = await fetchIdMatches(fragment);
      if (matches.length === 1) {
        navigate(matches[0]);
        return;
      }
      if (matches.length > 1) {
        setCandidates(matches);
        return;
      }
      setError(`「${fragment}」に一致する 提案 / Journal / 相談はありませんでした。`);
    } catch {
      setError("IDの解決に失敗しました。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <a
        href={goHrefForIdFragment(fragment)}
        className={`${className ?? ""} ${tooltip !== null ? styles.axisTooltip : ""}`.trim()}
        data-tooltip={tooltip ?? undefined}
        onClick={handleClick}
        onMouseEnter={ensureTooltip}
        onFocus={ensureTooltip}
      >
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
