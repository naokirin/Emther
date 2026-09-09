"use client";

import { use } from "react";
import Link from "next/link";
import styles from "@/app/page.module.css";
import { PersonDetailContent } from "@/components/PersonDetailContent";

// フルページ表示用（直接URLアクセス・リロード・「詳細画面で開く」の遷移先）。
export default function PersonDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <div className={styles.screen}>
      <div className={styles.panel}>
        <Link href="/people" className={styles.subtitle}>
          ← People一覧に戻る
        </Link>
        <div style={{ marginTop: 8 }}>
          <PersonDetailContent id={id} />
        </div>
      </div>
    </div>
  );
}
