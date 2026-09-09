"use client";

import { useRef, useState } from "react";
import styles from "@/app/page.module.css";

/**
 * 端末移行用: data+secure のバックアップ／復元／全削除。
 * CLI `emther backup` / `emther restore` と同形式。復元・リセット後はサーバーが停止する。
 */
export function DataMigrationPanel() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"backup" | "restore" | "reset" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restartRequired, setRestartRequired] = useState(false);
  const [restartReason, setRestartReason] = useState<"restore" | "reset" | null>(null);
  const [resetConfirm, setResetConfirm] = useState("");

  async function handleBackup() {
    setBusy("backup");
    setError(null);
    try {
      const res = await fetch("/api/settings/data/backup", { method: "POST" });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error || "バックアップに失敗しました");
      }
      const disposition = res.headers.get("Content-Disposition") || "";
      const match = /filename="([^"]+)"/.exec(disposition);
      const fileName = match?.[1] || "emther-state.tar.gz";
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function handleRestore(file: File) {
    if (!window.confirm(`「${file.name}」から復元しますか？\n現在のデータはすべて置き換わり、サーバーが停止します。`)) {
      return;
    }
    if (!window.confirm("本当に復元しますか？この操作は取り消せません。")) {
      return;
    }

    setBusy("restore");
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      const res = await fetch("/api/settings/data/restore", { method: "POST", body: form });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || "復元に失敗しました");
      setRestartReason("restore");
      setRestartRequired(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleReset() {
    if (resetConfirm !== "RESET") {
      setError('リセットするには下の欄に RESET と入力してください');
      return;
    }
    if (!window.confirm("全データ（業務データと実名対応表）を削除します。サーバーが停止します。よろしいですか？")) {
      return;
    }

    setBusy("reset");
    setError(null);
    try {
      const res = await fetch("/api/settings/data/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "RESET" }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || "リセットに失敗しました");
      setRestartReason("reset");
      setRestartRequired(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (restartRequired) {
    return (
      <div role="alert">
        <h3 style={{ fontSize: "0.8125rem", marginTop: 0, marginBottom: 8 }}>
          {restartReason === "reset" ? "リセットが完了しました" : "復元が完了しました"}
        </h3>
        <p className={styles.subtitle}>
          サーバーを停止しました。変更を反映するにはアプリを再起動してください。
        </p>
        <pre style={{ fontSize: "0.8125rem", padding: 12, overflow: "auto" }}>
          {`emther start\n# 開発時: npm run dev（web/ ディレクトリ）`}
        </pre>
        <p className={styles.subtitle} style={{ marginTop: 8 }}>
          再起動後、このページを再読み込みしてください。
        </p>
      </div>
    );
  }

  return (
    <>
      <h3 style={{ fontSize: "0.8125rem", marginTop: 0, marginBottom: 4 }}>端末移行・データ管理</h3>
      <p className={styles.subtitle} style={{ marginBottom: 12 }}>
        業務データ（Journal / Issue / 設定など）と実名対応表をまとめてバックアップ・復元・削除します。
        形式は CLI の <code>emther backup</code> / <code>emther restore</code> と同じ tar.gz です。
        アーカイブには個人情報が含まれます。Agent CLI の認証情報やモデルキャッシュは含まれません。
      </p>

      {error && <p className={styles.errorText} role="alert">{error}</p>}

      <section style={{ marginBottom: 24 }}>
        <h4 style={{ fontSize: "0.8125rem", margin: "0 0 8px" }}>バックアップ</h4>
        <p className={styles.subtitle} style={{ marginBottom: 8 }}>
          ダウンロードしたファイルを新しい端末へ移し、そちらで復元してください。サーバー側の
          backups ディレクトリにも同じファイルが残ります。
        </p>
        <button className={styles.primaryBtn} type="button" onClick={handleBackup} disabled={busy !== null}>
          {busy === "backup" ? "作成中…" : "バックアップをダウンロード"}
        </button>
      </section>

      <section style={{ marginBottom: 24 }}>
        <h4 style={{ fontSize: "0.8125rem", margin: "0 0 8px" }}>復元（インポート）</h4>
        <p className={styles.subtitle} style={{ marginBottom: 8 }}>
          現在の data / secure はすべて置き換わります。完了後サーバーは停止します。
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".tar.gz,.tgz,application/gzip"
          disabled={busy !== null}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleRestore(file);
          }}
        />
        {busy === "restore" && <p className={styles.subtitle}>復元中…</p>}
      </section>

      <section>
        <h4 style={{ fontSize: "0.8125rem", margin: "0 0 8px" }}>全データをリセット</h4>
        <p className={styles.subtitle} style={{ marginBottom: 8 }}>
          data と secure の中身をすべて削除します。取り消せません。確認のため下に{" "}
          <code>RESET</code> と入力してください。
        </p>
        <div className={styles.field} style={{ maxWidth: 240 }}>
          <label>
            確認入力
            <input
              type="text"
              value={resetConfirm}
              onChange={(e) => setResetConfirm(e.target.value)}
              placeholder="RESET"
              disabled={busy !== null}
              autoComplete="off"
            />
          </label>
        </div>
        <button
          className={styles.primaryBtn}
          type="button"
          onClick={handleReset}
          disabled={busy !== null || resetConfirm !== "RESET"}
        >
          {busy === "reset" ? "削除中…" : "全データを削除する"}
        </button>
      </section>
    </>
  );
}
