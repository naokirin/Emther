import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import styles from "./page.module.css";
import { AppShell, StoryBanner, TopNav } from "@/components/TopNav";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "EM Support System",
  description: "エージェント駆動型EMサポートシステム",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className={`${geistSans.variable} ${geistMono.variable}`}>
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
