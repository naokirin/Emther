import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import styles from "./page.module.css";
import { StoryBanner, TopNav } from "@/components/TopNav";

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
        <div className={styles.page}>
          <div className={styles.header}>
            <h1 className={styles.title}>EM Support System</h1>
            <p className={styles.subtitle}>Manager&apos;s Cockpit — Daily Triage &amp; Agent Oversight</p>
          </div>
          <TopNav />
          <StoryBanner />
          {children}
        </div>
      </body>
    </html>
  );
}
