"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "@/app/page.module.css";
import { useNameCandidateConfirm } from "@/lib/useNameCandidateConfirm";
import type { ObservationDumpView } from "@/lib/observation-dump-types";
import { ObservationDumpCreateForm } from "./observation-dump/ObservationDumpCreateForm";
import { ObservationDumpList } from "./observation-dump/ObservationDumpList";
import { ObservationDumpDetailPanel } from "./observation-dump/ObservationDumpDetailPanel";

type Props = {
  onAccepted?: () => void;
  /** `/journal?dump=` から深いリンク。あればセクションを開き当該 Dump を選択する */
  focusDumpId?: string | null;
};

export function ObservationDumpSection({ onAccepted, focusDumpId }: Props) {
  const { fetchWithNameConfirm, nameCandidateDialog } = useNameCandidateConfirm();
  const [open, setOpen] = useState(!!focusDumpId);
  const [dumps, setDumps] = useState<ObservationDumpView[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(focusDumpId ?? null);
  const [seenFocusDumpId, setSeenFocusDumpId] = useState(focusDumpId);

  const selected = dumps.find((d) => d.id === selectedId) ?? null;

  const reload = useCallback(async () => {
    const res = await fetch("/api/journal/dumps");
    const data = await res.json().catch(() => null);
    if (res.ok && data?.dumps) {
      setDumps(data.dumps as ObservationDumpView[]);
    }
    setLoaded(true);
  }, []);

  // focusDumpId が後から付いた／変わったとき、レンダー中に選択状態を合わせる（effect内setState回避）
  if (focusDumpId && focusDumpId !== seenFocusDumpId) {
    setSeenFocusDumpId(focusDumpId);
    setOpen(true);
    setSelectedId(focusDumpId);
    setLoaded(false);
  }

  useEffect(() => {
    if (!open || loaded) return;
    let cancelled = false;
    void (async () => {
      const res = await fetch("/api/journal/dumps");
      if (cancelled) return;
      const data = await res.json().catch(() => null);
      if (cancelled) return;
      if (res.ok && data?.dumps) {
        setDumps(data.dumps as ObservationDumpView[]);
      }
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, loaded]);

  return (
    <div className={styles.panel} style={{ marginBottom: 16 }}>
      <button
        type="button"
        className={`${styles.detailToggle} ${styles.detailToggleButton}`}
        onClick={() => setOpen(!open)}
      >
        📥 観測を取り込む（チャット / MTG / その他） {open ? "▲" : "▼"}
      </button>

      {open && (
        <div style={{ marginTop: 12 }}>
          <ObservationDumpCreateForm
            fetchWithNameConfirm={fetchWithNameConfirm}
            reload={reload}
            onCreated={setSelectedId}
          />

          <ObservationDumpList dumps={dumps} loaded={loaded} selectedId={selectedId} onSelect={setSelectedId} />

          {selected && (
            <ObservationDumpDetailPanel
              selected={selected}
              fetchWithNameConfirm={fetchWithNameConfirm}
              reload={reload}
              onAccepted={onAccepted}
              onDiscarded={() => setSelectedId(null)}
            />
          )}
        </div>
      )}
      {nameCandidateDialog}
    </div>
  );
}
