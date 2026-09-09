"use client";

import { use } from "react";
import Link from "next/link";
import styles from "@/app/page.module.css";
import { IssueDetailContent } from "@/components/IssueDetailContent";

// フルページ表示用（直接URLアクセス・リロード・「詳細画面で開く」の遷移先）。
export default function IssueDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <div className={styles.screen}>
      <Link href="/issues" className={styles.backLink}>
        ← Issue一覧に戻る
      </Link>
      <IssueDetailContent id={id} />
    </div>
  );
}
