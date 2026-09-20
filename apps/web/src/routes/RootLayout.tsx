import { Link, Outlet, ScrollRestoration } from "react-router";
import styles from "../styles/page.module.css";
import { LocalModelDownloadBanner } from "../components/LocalModelDownloadBanner";
import { PersonQuickAdd } from "../components/PersonQuickAdd";
import { SuggestionPeekRoot } from "../components/SuggestionPeekRoot";
import { AppShell, TopNav } from "../components/TopNav";

// web/src/app/layout.tsx（Next.js版RootLayout）からの移植（フェーズ3.5、ルートシェル）。
// <html>/<body>はindex.htmlが担うため、この階層からは除いた。children propの代わりに
// react-routerのOutletを使う以外、DOM構造・a11y実装（スキップリンク・main#main-content）は
// 変更していない。
export function RootLayout() {
  return (
    <>
      {/* Next.js版はrouter.push/<Link>のデフォルト（scroll:trueに相当）で画面遷移のたびに
          トップへスクロールしていたが、react-routerのcreateBrowserRouterはこれを自動で
          行わない。<ScrollRestoration />で同等の挙動（遷移時はトップへ、戻る/進むでは
          位置を復元）を明示的に有効化する。サイドピーク開閉・相談履歴選択など「同じ画面内の
          クエリパラメータ更新」側はuseTypedSearchParams/ChatPageのpreventScrollReset:trueで
          個別にオプトアウトしている（旧実装のscroll:falseに対応）。 */}
      <ScrollRestoration />
      {/* WCAG 2.2 2.4.1 Bypass Blocks対応。キーボード利用者がグローバルメニュー
          （8項目）＋グループ内タブを毎回タブ移動せずに本文へ飛べるようにする。
          通常は視覚的に隠し、フォーカス時だけ表示する。 */}
      <a href="#main-content" className={styles.skipLink}>
        本文へスキップ
      </a>
      <div className={styles.page}>
        <div className={styles.header} style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div>
            <h1 className={styles.title}>Emther</h1>
            <p className={styles.subtitle}>EM Support System</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Link
              to="/help"
              className={`${styles.headerHelpLink} ${styles.axisTooltip} ${styles.axisTooltipDownCenter}`}
              data-tooltip="仕組み・用語の説明"
            >
              ヘルプ
            </Link>
            <PersonQuickAdd />
          </div>
        </div>
        <TopNav />
        {/* 未キャッシュのローカルモデルがあるときだけ進捗を出す（キャッシュ済みなら何も出さない）。 */}
        <LocalModelDownloadBanner />
        {/* tabIndex={-1}: スキップリンクの遷移先としてプログラム的にフォーカスできる
            ようにする（アンカージャンプだけでは次のTabがbody先頭に戻ってしまうため）。 */}
        <main id="main-content" tabIndex={-1}>
          <SuggestionPeekRoot>
            <AppShell>
              <Outlet />
            </AppShell>
          </SuggestionPeekRoot>
        </main>
      </div>
    </>
  );
}
