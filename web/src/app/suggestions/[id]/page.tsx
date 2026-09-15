"use client";

import { use } from "react";
import Link from "next/link";
import styles from "@/app/page.module.css";
import { SuggestionDetailContent } from "@/components/SuggestionDetailContent";

export default function SuggestionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <div className={styles.screen}>
      <Link href="/suggestions" className={styles.backLink}>
        ← 提案一覧に戻る
      </Link>
      <SuggestionDetailContent id={id} />
    </div>
  );
}
