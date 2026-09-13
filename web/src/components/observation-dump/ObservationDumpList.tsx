"use client";

import styles from "@/app/page.module.css";
import type { ObservationDumpView } from "@/lib/observation-dump-types";
import { SOURCE_OPTIONS, STATUS_LABEL, formatWhen } from "./observation-dump-display";

type Props = {
  dumps: ObservationDumpView[];
  loaded: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
};

export function ObservationDumpList({ dumps, loaded, selectedId, onSelect }: Props) {
  const activeDumps = dumps.filter((d) => d.status !== "discarded");

  return (
    <div style={{ marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
      <h3 style={{ margin: "0 0 8px", fontSize: "0.875rem" }}>取り込み一覧</h3>
      {!loaded ? (
        <p className={styles.subtitle}>読み込み中…</p>
      ) : activeDumps.length === 0 ? (
        <p className={styles.subtitle}>まだ取り込みはありません。</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {activeDumps.map((d) => (
            <li key={d.id} style={{ marginBottom: 6 }}>
              <button
                type="button"
                className={styles.btnOutline}
                style={{
                  width: "100%",
                  textAlign: "left",
                  borderColor: d.id === selectedId ? "var(--accent, var(--border))" : undefined,
                }}
                onClick={() => onSelect(d.id)}
              >
                <strong>{d.title || "（無題）"}</strong>
                <span style={{ color: "var(--text-muted)", marginLeft: 8 }}>
                  {SOURCE_OPTIONS.find((o) => o.value === d.sourceType)?.label ?? d.sourceType}
                  {" · "}
                  {STATUS_LABEL[d.status] ?? d.status}
                  {" · "}
                  {formatWhen(d.createdAt)}
                  {d.chunkDrafts.length > 0
                    ? ` · ${d.chunkDrafts.filter((c) => !c.acceptedJournalId && c.disposition !== "drop").length}件未採用`
                    : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
