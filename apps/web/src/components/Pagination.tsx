import styles from "../styles/page.module.css";

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
