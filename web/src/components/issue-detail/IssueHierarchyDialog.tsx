"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "@/app/page.module.css";
import { Modal } from "@/components/Modal";
import type { FetchWithNameConfirm } from "./types";

type Props = {
  mode: "child" | "parent";
  issueId: string;
  onClose: () => void;
  fetchWithNameConfirm: FetchWithNameConfirm;
  refreshIssues: () => Promise<void>;
};

// docs/memo.md「K. ズームイン／ズームアウトの協働計画」対応。サブIssue作成／上位Issue
// 作成の共通モーダル。mode が変わると親側で unmount / mount されるため、入力欄の
// リセットは onClose のたびに個別に行わずコンポーネント再生成に任せてよい。
export function IssueHierarchyDialog({ mode, issueId, onClose, fetchWithNameConfirm, refreshIssues }: Props) {
  const router = useRouter();
  const [hTitle, setHTitle] = useState("");
  const [hWhy, setHWhy] = useState("");
  const [hWhat, setHWhat] = useState("");
  const [hHow, setHHow] = useState("");
  const [hSubmitting, setHSubmitting] = useState(false);
  const [hError, setHError] = useState<string | null>(null);

  async function handleCreateChild(e: React.FormEvent) {
    e.preventDefault();
    if (!hTitle.trim()) return;
    setHSubmitting(true);
    setHError(null);
    try {
      const { res, data } = await fetchWithNameConfirm(
        "/api/issues",
        {
          method: "POST",
          body: { title: hTitle, why: hWhy, what: hWhat, how: hHow, parentId: issueId },
        },
        "保存する",
      );
      if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? "サブIssueの作成に失敗しました");
      // 改修依頼「一覧と入力の分離によるアクション→一覧のフローの分断」対応。以前は
      // 作成直後に新しいサブIssue自身の詳細画面へ遷移しており、いま開いていた親Issueの
      // 「サブIssue（分解した子Issue）」一覧にそのまま反映される様子を見られなかった。
      // 遷移せずダイアログを閉じるだけにし、一覧側の更新を即座に反映する
      // （Why/What/Howを詰めたい場合は一覧からそのサブIssueへ改めて入れる）。
      onClose();
      await refreshIssues();
    } catch (err) {
      if ((err as Error).message !== "人名候補の確認をキャンセルしました") {
        setHError((err as Error).message);
      }
    } finally {
      setHSubmitting(false);
    }
  }

  async function handleCreateParent(e: React.FormEvent) {
    e.preventDefault();
    if (!hTitle.trim()) return;
    setHSubmitting(true);
    setHError(null);
    try {
      const { res, data } = await fetchWithNameConfirm(
        `/api/issues/${issueId}/parent`,
        { method: "POST", body: { title: hTitle, why: hWhy, what: hWhat, how: hHow } },
        "保存する",
      );
      if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? "上位Issueの作成に失敗しました");
      onClose();
      await refreshIssues();
      router.push(`/issues/${(data as { issue: { id: string } }).issue.id}`);
    } catch (err) {
      if ((err as Error).message !== "人名候補の確認をキャンセルしました") {
        setHError((err as Error).message);
      }
    } finally {
      setHSubmitting(false);
    }
  }

  return (
    <Modal
      title={mode === "child" ? "サブIssueを追加" : "上位Issueを作る"}
      size="wide"
      onClose={onClose}
    >
      <form onSubmit={mode === "child" ? handleCreateChild : handleCreateParent}>
        <div className={styles.field}>
          <label>タイトル
          <input type="text" autoFocus value={hTitle} onChange={(e) => setHTitle(e.target.value)} placeholder="例: 割り込みタスクの受け入れ基準を定める" /></label>
        </div>
        <div className={styles.field}>
          <label>Why（生む価値・誰のため・なぜ今か）
          <textarea rows={2} value={hWhy} onChange={(e) => setHWhy(e.target.value)} /></label>
        </div>
        <div className={styles.field}>
          <label>What（何を・どこまで・どのくらい・完了の定義）
          <textarea rows={2} value={hWhat} onChange={(e) => setHWhat(e.target.value)} /></label>
        </div>
        <div className={styles.field}>
          <label>How（どのように実現するか・前提や制約）
          <textarea rows={2} value={hHow} onChange={(e) => setHHow(e.target.value)} /></label>
        </div>
        {hError && <p className={styles.errorText} role="alert">{hError}</p>}
        <button className={styles.primaryBtn} type="submit" disabled={hSubmitting || !hTitle.trim()}>
          {mode === "child" ? "サブIssueを作成" : "上位Issueを作成"}
        </button>
      </form>
    </Modal>
  );
}
