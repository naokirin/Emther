import { useState } from "react";
import styles from "../../styles/page.module.css";
import { PageTitleRow } from "../HelpLink";
import type { useNameCandidateConfirm } from "../../lib/useNameCandidateConfirm";
import type { AgentRunMutationResponse } from "@emther/api-contract";

type Props = {
  initialTask: string;
  queryJournalId: string | null;
  consultIntent?: "theme";
  fetchWithNameConfirm: ReturnType<typeof useNameCandidateConfirm>["fetchWithNameConfirm"];
  onStarted: (runId: string) => void;
};

// 他タブへの遷移でアンマウントされ得るため、下書きをこの端末のlocalStorageにも退避する
// （SlideOverの幅記憶等と同じ軽量パターン）。他の閲覧者・他端末とは共有されない
const DRAFT_STORAGE_KEY = "em-chat-new-consult-draft";

function readStoredDraft(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(DRAFT_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeStoredDraft(value: string) {
  if (typeof window === "undefined") return;
  try {
    if (value) {
      window.localStorage.setItem(DRAFT_STORAGE_KEY, value);
    } else {
      window.localStorage.removeItem(DRAFT_STORAGE_KEY);
    }
  } catch {
    // localStorageが使えない環境でも、下書きの保持を諦めるだけで入力自体は妨げない
  }
}

// Quick Journalの@人物クリックや
// 「要注目Journal」カードから、相談内容を書いた状態でこの画面を開けるようにする
export function NewConsultForm({
  initialTask,
  queryJournalId,
  consultIntent,
  fetchWithNameConfirm,
  onStarted,
}: Props) {
  // 明示的なprefill（Journal等からの導線）が無いときだけ、退避していた下書きを初期値に使う。
  const [task, setTask] = useState(() => initialTask || readStoredDraft());
  const [requireExecConsult, setRequireExecConsult] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  function updateTask(value: string) {
    setTask(value);
    writeStoredDraft(value);
  }

  async function handleStartNew(e: React.FormEvent) {
    e.preventDefault();
    if (!task.trim()) return;
    setStarting(true);
    setStartError(null);
    try {
      const { res, data } = await fetchWithNameConfirm(
        "/api/agents",
        {
          method: "POST",
          body: {
            agentName: "Lead Agent",
            task,
            sourceJournalId: queryJournalId || undefined,
            consultIntent: consultIntent === "theme" ? "theme" : undefined,
            requireExecConsult: requireExecConsult || undefined,
          },
        },
        "送信する",
      );
      if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? "開始に失敗しました");
      updateTask("");
      setRequireExecConsult(false);
      onStarted((data as AgentRunMutationResponse).run.id);
    } catch (err) {
      if ((err as Error).message !== "人名候補の確認をキャンセルしました") {
        setStartError((err as Error).message);
      }
    } finally {
      setStarting(false);
    }
  }

  return (
    <>
      <PageTitleRow title="何でも相談" helpAnchor="chat" />
      <form onSubmit={handleStartNew}>
        <div className={styles.field}>
          <label>相談したいこと
          <textarea
            value={task}
            onChange={(e) => updateTask(e.target.value)}
            rows={3}
            placeholder="例: 最近チーム全体の元気度が心配。何を確認すればいい？"
          /></label>
        </div>
        <label
          className={styles.axisTooltip}
          style={{
            display: "flex",
            gap: 8,
            alignItems: "flex-start",
            fontSize: "0.875rem",
            marginBottom: 12,
            cursor: "pointer",
          }}
          data-tooltip="Leadが組織MVV・中長期コミットの視点でExec Agentへ必須相談します"
        >
          <input
            type="checkbox"
            checked={requireExecConsult}
            onChange={(e) => setRequireExecConsult(e.target.checked)}
            disabled={starting}
            style={{ marginTop: 3 }}
          />
          <span>経営／役員目線の厳しいレビューも聞く</span>
        </label>
        <button className={styles.primaryBtn} type="submit" disabled={starting || !task.trim()}>
          {starting ? "開始中…" : "相談を始める"}
        </button>
      </form>
      {startError && <p className={styles.errorText} role="alert">{startError}</p>}
    </>
  );
}
