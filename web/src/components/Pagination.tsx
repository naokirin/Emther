"use client";

import { useState } from "react";
import styles from "@/app/page.module.css";

// docs/memo.md TODO「リストにおける、フィルタ機能の拡充、ページネーションの追加を行う」への対応。
// 複数のリスト（Issues、Dashboardのジャーナル/Inbox）で同じページネーションUIを
// 使い回すための共通フック＋コンポーネント。フィルタ自体は各画面固有の条件で
// items配列を絞り込んでからこのフックへ渡す想定（フィルタロジックはここに含めない）。

// ユーザー要望「一覧の全件取得をページネーション化したい」対応。Agent Run/Journal一覧は
// サーバー側でページ分割・件数集計するようになったため（クライアントは1ページ分の
// itemsとtotalしか持たない）、ページ番号・表示範囲の算出だけをusePaginationと共有する。
export function paginationMeta(total: number, page: number, pageSize: number) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  // 件数が減ってpageが範囲外になっても、表示側では自動的に最終ページへ丸める。
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const start = (currentPage - 1) * pageSize;
  return {
    page: currentPage,
    totalPages,
    total,
    rangeStart: total === 0 ? 0 : start + 1,
    rangeEnd: Math.min(start + pageSize, total),
  };
}

export function usePagination<T>(items: T[], pageSize: number) {
  const [page, setPage] = useState(1);
  const meta = paginationMeta(items.length, page, pageSize);
  const start = (meta.page - 1) * pageSize;
  const pageItems = items.slice(start, start + pageSize);

  return { ...meta, setPage, pageItems };
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
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, fontSize: "0.75rem", color: "var(--text-muted)" }}>
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
