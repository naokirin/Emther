"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "@/app/page.module.css";

export const OPEN_PERSON_QUICK_ADD_EVENT = "emther:open-person-quick-add";
export const PERSON_REGISTERED_EVENT = "emther:person-registered";

export type OpenPersonQuickAddDetail = {
  name?: string;
  aliases?: string;
};

/** どの画面からでも人物クイック追加ダイアログを開く。 */
export function openPersonQuickAdd(detail: OpenPersonQuickAddDetail = {}): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPEN_PERSON_QUICK_ADD_EVENT, { detail }));
}

function parseAliases(raw: string): string[] {
  return [...new Set(raw.split(/[,、]/).map((s) => s.trim()).filter(Boolean))];
}

/**
 * ヘッダー常設の「＋人」ボタン＋ダイアログ。
 * 名簿事前登録が正である方針の前提条件（どの画面からでも追加・別名登録できる）。
 */
export function PersonQuickAdd() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [aliasesText, setAliasesText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const resetForm = useCallback((detail?: OpenPersonQuickAddDetail) => {
    setName(detail?.name?.trim() ?? "");
    setAliasesText(detail?.aliases?.trim() ?? "");
    setError(null);
    setSuccess(null);
  }, []);

  const openDialog = useCallback(
    (detail?: OpenPersonQuickAddDetail) => {
      resetForm(detail);
      setOpen(true);
    },
    [resetForm],
  );

  useEffect(() => {
    function onOpen(ev: Event) {
      const detail = (ev as CustomEvent<OpenPersonQuickAddDetail>).detail;
      openDialog(detail ?? {});
    }
    window.addEventListener(OPEN_PERSON_QUICK_ADD_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_PERSON_QUICK_ADD_EVENT, onOpen);
  }, [openDialog]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("正式名を入力してください");
      return;
    }
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/people", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, aliases: parseAliases(aliasesText) }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "登録に失敗しました");
      const personName = typeof data?.person?.name === "string" ? data.person.name : trimmed;
      const aliasCount = Array.isArray(data?.person?.aliases) ? data.person.aliases.length : 0;
      setSuccess(
        aliasCount > 0
          ? `「${personName}」を登録しました（別名 ${aliasCount} 件）`
          : `「${personName}」を登録しました`,
      );
      window.dispatchEvent(new CustomEvent(PERSON_REGISTERED_EVENT, { detail: data?.person }));
      setName("");
      setAliasesText("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className={styles.btnOutline}
        style={{ flexShrink: 0, fontSize: "0.8125rem", padding: "6px 10px" }}
        onClick={() => openDialog()}
        title="メンバーを追加・別名を登録（どの画面からでも）"
      >
        ＋ 人を追加
      </button>

      {open && (
        <div
          className={styles.modalOverlay}
          role="dialog"
          aria-modal="true"
          aria-labelledby="person-quick-add-title"
          onClick={(ev) => {
            if (ev.target === ev.currentTarget && !submitting) setOpen(false);
          }}
        >
          <div className={styles.modalBox}>
            <div className={styles.modalHeader}>
              <h3 id="person-quick-add-title" style={{ margin: 0, fontSize: "1.05rem" }}>
                人を追加・別名登録
              </h3>
              <button
                type="button"
                className={styles.modalClose}
                onClick={() => setOpen(false)}
                aria-label="閉じる"
                disabled={submitting}
              >
                ×
              </button>
            </div>

            <p style={{ margin: "0 0 12px", fontSize: "0.85rem", lineHeight: 1.5, color: "var(--text-muted)" }}>
              クラウドAIへ送る前にマスクする人名は、あらかじめここ（またはチーム名簿）で登録してください。
              既存の正式名を入れた場合は同じ人物として扱い、別名だけを足せます。
            </p>

            <form onSubmit={handleSubmit}>
              <div className={styles.field} style={{ marginBottom: 12 }}>
                <label>
                  正式名
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="例: 山田さん"
                    autoFocus
                    disabled={submitting}
                  />
                </label>
              </div>
              <div className={styles.field} style={{ marginBottom: 12 }}>
                <label>
                  別名（任意・カンマ区切り）
                  <input
                    type="text"
                    value={aliasesText}
                    onChange={(e) => setAliasesText(e.target.value)}
                    placeholder="例: 山田くん, Yamada"
                    disabled={submitting}
                  />
                </label>
              </div>

              {error && (
                <p className={styles.errorText} role="alert" style={{ marginBottom: 12 }}>
                  {error}
                </p>
              )}
              {success && (
                <p style={{ margin: "0 0 12px", fontSize: "0.85rem", color: "var(--green-fg, #0a7)" }} role="status">
                  {success}
                </p>
              )}

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                <button type="button" className={styles.btnOutline} onClick={() => setOpen(false)} disabled={submitting}>
                  閉じる
                </button>
                <button type="submit" className={styles.primaryBtn} disabled={submitting || !name.trim()}>
                  {submitting ? "登録中…" : "登録する"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
