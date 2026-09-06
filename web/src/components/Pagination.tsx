"use client";

import { useState } from "react";
import styles from "@/app/page.module.css";

// docs/memo.md TODO「リストにおける、フィルタ機能の拡充、ページネーションの追加を行う」への対応。
// 複数のリスト（Issues、Dashboardのジャーナル/Inbox）で同じページネーションUIを
// 使い回すための共通フック＋コンポーネント。フィルタ自体は各画面固有の条件で
// items配列を絞り込んでからこのフックへ渡す想定（フィルタロジックはここに含めない）。
export function usePagination<T>(items: T[], pageSize: number) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  // フィルタ変更で件数が減り、保持していたpageが範囲外になっても
  // 表示側では自動的に最終ページへ丸める（stateそのものは書き換えない）。
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * pageSize;
  const pageItems = items.slice(start, start + pageSize);

  return {
    page: currentPage,
    setPage,
    totalPages,
    pageItems,
    total: items.length,
    rangeStart: items.length === 0 ? 0 : start + 1,
    rangeEnd: Math.min(start + pageSize, items.length),
  };
}

export function PaginationControls({
  page,
  totalPages,
  total,
  rangeStart,
  rangeEnd,
  onChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  rangeStart: number;
  rangeEnd: number;
  onChange: (page: number) => void;
}) {
  if (total === 0 || totalPages <= 1) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, fontSize: 12, color: "var(--text-muted)" }}>
      <button className={styles.btnOutline} disabled={page <= 1} onClick={() => onChange(page - 1)}>
        ← 前へ
      </button>
      <span>
        {rangeStart}–{rangeEnd} / {total}件（{page} / {totalPages}ページ）
      </span>
      <button className={styles.btnOutline} disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
        次へ →
      </button>
    </div>
  );
}
