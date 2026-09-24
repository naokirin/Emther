import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import styles from "../styles/page.module.css";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// 左端のハンドルを
// ドラッグ（またはキーボードの←→）して幅を変える。次回開いたときも同じ幅になるよう
// この端末のlocalStorageにだけ記憶する（他の閲覧者・他端末には共有されない軽量な設定）
const WIDTH_STORAGE_KEY = "em-slideover-width";
const DEFAULT_WIDTH = 560;
const MIN_WIDTH = 360;
const MAX_WIDTH_RATIO = 0.92;
const RESIZE_STEP = 24;

function maxWidth(): number {
  if (typeof window === "undefined") return DEFAULT_WIDTH;
  return Math.round(window.innerWidth * MAX_WIDTH_RATIO);
}

function clampWidth(w: number): number {
  return Math.min(Math.max(w, MIN_WIDTH), Math.max(MIN_WIDTH, maxWidth()));
}

function readStoredWidth(): number {
  if (typeof window === "undefined") return DEFAULT_WIDTH;
  try {
    const stored = Number(window.localStorage.getItem(WIDTH_STORAGE_KEY));
    return Number.isFinite(stored) && stored > 0 ? clampWidth(stored) : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

function persistWidth(w: number): void {
  try {
    window.localStorage.setItem(WIDTH_STORAGE_KEY, String(w));
  } catch {
    // localStorageが使えない環境でも、幅の記憶を諦めるだけで表示自体は妨げない
  }
}

// Modal.tsxと同じa11yパターン（フォーカストラップ・Escape・aria-modal・フォーカス復元）を
// 踏襲しつつ、レイアウトだけ右からのスライドインに変える。「しっかり確認したい場合」は
// detailHrefで独立ページへ遷移できるようにし、一覧⇄詳細の移動コストを状況に応じて選べるようにする
export function SlideOver({
  title,
  onClose,
  detailHref,
  children,
}: {
  title: string;
  onClose: () => void;
  // 「詳細画面で開く」導線の遷移先。省略時はリンクを出さない。
  detailHref?: string;
  children: ReactNode;
}) {
  const titleId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  // 以前はuseState(readStoredWidth)の遅延初期化子がSSR時にも呼ばれ、サーバー側は
  // window未定義でDEFAULT_WIDTHを返す一方、クライアント側の初回描画（hydration）では
  // 同じ初期化子がlocalStorageの保存値を読んでしまい、EMが一度でも幅を変更していると
  // サーバー/クライアントでstyle.widthが食い違っていた。SSRとhydration直後は必ず
  // DEFAULT_WIDTHで揃え、保存値の反映はマウント後のuseEffect（クライアント専用）に移す
  const [width, setWidth] = useState(DEFAULT_WIDTH);

  useEffect(() => {
    // SSR/hydration時のstyle不一致を避けるため意図的にDEFAULT_WIDTHで初回描画を揃え、
    // マウント後だけlocalStorageの保存値へ切り替える。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWidth(readStoredWidth());
  }, []);

  // ハンドルは左端（パネルは右端固定）にあるため、左へドラッグ＝マウスXが小さくなるほど
  // 幅は広がる。ドラッグ中はグローバルにmousemove/upを監視し、離した時点の幅だけ記憶する。
  function handleResizeStart(e: React.MouseEvent<HTMLDivElement>) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    let latest = startWidth;
    function onMove(ev: MouseEvent) {
      latest = clampWidth(startWidth + (startX - ev.clientX));
      setWidth(latest);
    }
    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      persistWidth(latest);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  function handleResizeKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const next = clampWidth(width + (e.key === "ArrowLeft" ? RESIZE_STEP : -RESIZE_STEP));
    setWidth(next);
    persistWidth(next);
  }

  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    boxRef.current?.focus();
    return () => {
      previouslyFocused.current?.focus?.();
    };
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !boxRef.current) return;
      const focusable = boxRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className={styles.slideOverOverlay} onClick={onClose}>
      <div
        ref={boxRef}
        className={styles.slideOverBox}
        style={{ width }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.slideOverHeader}>
          <h2 id={titleId} style={{ margin: 0 }}>
            {title}
          </h2>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {/* テキストリンクからアイコンボタンにし、アクセシブルな名前はaria-label/titleで維持する */}
            {detailHref && (
              <Link
                to={detailHref}
                className={`${styles.slideOverExpandLink} ${styles.axisTooltip} ${styles.axisTooltipDownCenter}`}
                aria-label="詳細画面で開く"
                data-tooltip="詳細画面で開く"
              >
                ⤢
              </Link>
            )}
            <button className={styles.modalClose} onClick={onClose} aria-label="閉じる">
              ×
            </button>
          </div>
        </div>
        <div className={styles.slideOverBody}>{children}</div>
        {/* DOM順は末尾に 置き、Tabキーの通常の巡回順（見出し→本文の操作）を邪魔しないようにする （見た目はCSSのposition: absoluteで左端に固定するのでDOM順に依存しない） */}
        <div
          className={styles.slideOverResizeHandle}
          role="separator"
          aria-orientation="vertical"
          aria-label="パネルの幅を変更"
          tabIndex={0}
          onMouseDown={handleResizeStart}
          onKeyDown={handleResizeKeyDown}
        />
      </div>
    </div>
  );
}
