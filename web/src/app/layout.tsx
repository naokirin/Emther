import type { Metadata } from "next";
// 配布ビルドが Google Fonts へのネットワーク取得に依存しないよう、npm 同梱の
// @fontsource を使う（docs/packaging.md / ローカル実行前提）。
import "@fontsource/zen-kaku-gothic-new/japanese-400.css";
import "@fontsource/zen-kaku-gothic-new/japanese-500.css";
import "@fontsource/zen-kaku-gothic-new/japanese-700.css";
import "@fontsource/zen-kaku-gothic-new/japanese-900.css";
import "@fontsource/zen-kaku-gothic-new/latin-400.css";
import "@fontsource/zen-kaku-gothic-new/latin-500.css";
import "@fontsource/zen-kaku-gothic-new/latin-700.css";
import "@fontsource/zen-kaku-gothic-new/latin-900.css";
import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/jetbrains-mono/latin-600.css";
import "./globals.css";
import styles from "./page.module.css";
import { LocalModelDownloadBanner } from "@/components/LocalModelDownloadBanner";
import { AppShell, StoryBanner, TopNav } from "@/components/TopNav";

// デザイン見直し（frontend-design）対応。従来はnext/font/googleでGeistを読み込みながら
// globals.css側で参照しておらず、実際には素のOSシステムフォントのまま描画されていた
// （意図した書体が一つも無い状態）。EMが1日に何度も開く「組織トリアージの計器盤」という
// 主題に対し、Noto Sans JP的などこにでもある書体ではなく、UI向けに作られたZen Kaku Gothic
// Newを本文・見出し双方に採用する（display用に別書体は起こさず太さで差をつける）。
// 件数・比率・時刻など数値だけはJetBrains Monoの等幅数字にし、既存のエージェントログ
// コンソール（.terminal、SF Mono系）が持っていた「数字は等幅」という前提をアプリ全体の
// 数値表示に広げる（走査しやすさのための機能的な選択で、装飾目的の等幅化ではない）。

export const metadata: Metadata = {
  title: "EM Support System",
  description: "エージェント駆動型EMサポートシステム",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja">
      <body>
        {/* WCAG 2.2 2.4.1 Bypass Blocks対応。キーボード利用者がグローバルメニュー
            （7項目）＋サイドメニューを毎回タブ移動せずに本文へ飛べるようにする。
            通常は視覚的に隠し、フォーカス時だけ表示する。 */}
        <a href="#main-content" className={styles.skipLink}>
          本文へスキップ
        </a>
        <div className={styles.page}>
          <div className={styles.header}>
            <h1 className={styles.title}>EM Support System</h1>
            {/* docs/dashboard_ui_readability.md U2-1対応。全画面共通のタグラインが英語のみ
                だったため、他の見出しと揃えて日本語にする。 */}
            <p className={styles.subtitle}>組織のトリアージとAIエージェントの監督</p>
          </div>
          <TopNav />
          <StoryBanner />
          {/* 未キャッシュのローカルモデルがあるときだけ進捗を出す（キャッシュ済みなら何も出さない）。 */}
          <LocalModelDownloadBanner />
          {/* tabIndex={-1}: スキップリンクの遷移先としてプログラム的にフォーカスできる
              ようにする（アンカージャンプだけでは次のTabがbody先頭に戻ってしまうため）。 */}
          <main id="main-content" tabIndex={-1}>
            <AppShell>{children}</AppShell>
          </main>
        </div>
      </body>
    </html>
  );
}
