"use client";

import styles from "@/app/page.module.css";
import { IdLinkedText } from "@/components/IdLinkedText";
import { YIELD_KIND_META, type YieldKind } from "@/lib/types";
import type { YieldOption } from "@/components/RunDetail";
import { resolveYieldKind } from "./run-view-helpers";

// Yieldの選択UI（ラジオ風カード＋共通の確定/壁打ちボタン）。ExecutionStateから切り出し。
export function YieldBlock({
  yieldRequest,
  selectedOptionId,
  onSelectOption,
  onConfirmOption,
  onFocusChat,
  deciding,
}: {
  yieldRequest: { reason: string; options: YieldOption[]; kind?: YieldKind };
  selectedOptionId: string | null;
  onSelectOption: (id: string) => void;
  onConfirmOption: () => void;
  onFocusChat: () => void;
  deciding: boolean;
}) {
  const kind = resolveYieldKind(yieldRequest.kind, yieldRequest.options.length);
  const kindMeta = YIELD_KIND_META[kind];
  return (
    <div className={`${styles.yieldBlock} ${styles[kind]}`}>
      <strong>
        {kindMeta.icon} {kindMeta.label}: {kindMeta.description}
      </strong>
      <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 6 }}>
        <IdLinkedText text={yieldRequest.reason} />
      </p>

      {yieldRequest.options.map((opt) => (
        <div
          key={opt.id}
          className={`${styles.option} ${selectedOptionId === opt.id ? styles.optionSelected : ""}`}
          onClick={() => onSelectOption(opt.id)}
          role="radio"
          aria-checked={selectedOptionId === opt.id}
          tabIndex={0}
        >
          <strong>
            {selectedOptionId === opt.id ? "◉" : "○"} Option {opt.id}: <IdLinkedText text={opt.label} />
          </strong>
          {opt.detail && (
            <div>
              <IdLinkedText text={opt.detail} />
            </div>
          )}
          {opt.risk && (
            <div style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>
              ※Risk: <IdLinkedText text={opt.risk} />
            </div>
          )}
        </div>
      ))}

      <div className={styles.yieldActions}>
        <button className={styles.primaryBtn} style={{ width: "auto" }} disabled={!selectedOptionId || deciding} onClick={onConfirmOption}>
          選択してStateを更新
        </button>
        <button className={styles.btnOutline} onClick={onFocusChat}>
          別の案をチャットで壁打ち
        </button>
      </div>
    </div>
  );
}
