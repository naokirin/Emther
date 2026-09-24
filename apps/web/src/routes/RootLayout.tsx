import { Link, Outlet, ScrollRestoration } from "react-router";
import styles from "../styles/page.module.css";
import { LocalModelDownloadBanner } from "../components/LocalModelDownloadBanner";
import { PersonQuickAdd } from "../components/PersonQuickAdd";
import { SuggestionPeekRoot } from "../components/SuggestionPeekRoot";
import { AppShell, TopNav } from "../components/TopNav";

// index.html が html/body を担う。Outlet で子ルートを描画（スキップリンク・main#main-content）。
export function RootLayout() {
  return (
    <>
      {/* Link 遷移時のスクロール位置を復元する（既定の top スクロールの代わり） */}
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
